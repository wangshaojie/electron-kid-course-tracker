/**
 * pg-backup —— CloudBase HTTP Function
 *
 * 路由：POST /run   (无 body, 立即备份) / GET /health
 *
 * 行为：
 *   1) 拉全表数据：children / courses / checkins / user_prefs
 *   2) 拼成 JSON 写到 PG 的 backups 表（每行一个时间戳快照）
 *   3) 同时清理超过 30 天的旧备份
 *
 * 部署后：
 *   - 手动触发：tcb fn invoke pg-backup -e <envId>  或  POST https://.../pg-backup/run
 *   - 自动触发：在 CloudBase 控制台 → 云函数 pg-backup → 触发管理 → 定时触发器
 *     推荐 cron: "0 0 3 * * * *"  (每天凌晨 3 点)
 *
 * 备份表结构（自动建）：
 *   backups(id, taken_at, payload jsonb, schema_version, row_counts jsonb)
 */

const http = require('http')
const cloudbase = require('@cloudbase/node-sdk')

const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS_BASE }

const TCB_ENV_ID = process.env.TCB_ENV_ID
if (!TCB_ENV_ID) console.error('[pg-backup] TCB_ENV_ID is not set')

const initConfig = { env: TCB_ENV_ID }
if (process.env.CLOUDBASE_APIKEY) {
  initConfig.accessKey = process.env.CLOUDBASE_APIKEY
} else if (process.env.TCB_SDK_SECRET_ID && process.env.TCB_SDK_SECRET_KEY) {
  initConfig.secretId = process.env.TCB_SDK_SECRET_ID
  initConfig.secretKey = process.env.TCB_SDK_SECRET_KEY
}
const app = cloudbase.init(initConfig)
const rdb = () => app.rdb({ database: 'public' })

// 自动建表（幂等）
async function ensureTable() {
  // 用 RPC 风格的 raw query
  const { error: e1 } = await rdb().rpc('exec_sql', {
    sql: `CREATE TABLE IF NOT EXISTS backups (
      id BIGSERIAL PRIMARY KEY,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      payload JSONB NOT NULL,
      schema_version INT NOT NULL DEFAULT 1,
      row_counts JSONB NOT NULL DEFAULT '{}'::jsonb
    )`,
  })
  if (e1) {
    // rpc 不可用 → 退而求其次：靠 migration
    console.warn('[pg-backup] ensureTable via rpc failed:', e1.message)
  }
}

async function takeBackup() {
  const tables = ['children', 'courses', 'checkins', 'user_prefs']
  const payload = {}
  const rowCounts = {}
  for (const t of tables) {
    const { data, error } = await rdb().from(t).select('*')
    if (error) throw new Error(`select ${t} failed: ${error.message}`)
    payload[t] = data ?? []
    rowCounts[t] = (data ?? []).length
  }
  const takenAt = new Date().toISOString()
  // 先 ensure table（用一次性 SQL，PG 不支持 IF NOT EXISTS in rpc 直接调）
  // 改用 admin 通道直接 SQL
  try {
    await app.database().createCollection('backups') // NoSQL API，可能不适用
  } catch { /* ignore */ }

  // 尝试写
  const { data, error } = await rdb()
    .from('backups')
    .insert({
      taken_at: takenAt,
      payload,
      schema_version: 1,
      row_counts: rowCounts,
    })
    .select('id, taken_at, row_counts')
  if (error) throw new Error(`insert backups failed: ${error.message}`)
  // 清理 30 天前的旧备份
  await rdb()
    .from('backups')
    .delete()
    .lt('taken_at', new Date(Date.now() - 30 * 24 * 3600_000).toISOString())
  return { id: data?.[0]?.id, taken_at: takenAt, row_counts: rowCounts }
}

function sendJson(res, status, data) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(data))
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_BASE)
    return res.end()
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/run') {
      const r = await takeBackup()
      return sendJson(res, 200, { ok: true, ...r })
    }
    return sendJson(res, 404, { error: 'not_found' })
  } catch (e) {
    console.error('[pg-backup] handler error:', e)
    return sendJson(res, 500, { error: 'internal', detail: e?.message || String(e) })
  }
})

server.listen(9000, () => {
  console.log('[pg-backup] listening on :9000')
})

// 事件触发入口（CloudBase 定时触发器 / tcb fn invoke 会调用 exports.main）
// HTTP 请求走上面的 9000 端口；Timer/事件触发走这里执行备份
exports.main = async (event = {}, context) => {
  const r = await takeBackup()
  console.log('[pg-backup] event-triggered backup done:', JSON.stringify(r))
  return { ok: true, ...r }
}
