#!/usr/bin/env node
/**
 * CloudBase PG → Supabase 数据迁移脚本
 * --------------------------------------------------------------
 * 1) 读 CloudBase envId + API key（env 优先，缺省从 ../cloudbaserc.json 兜底）
 * 2) 用 @cloudbase/node-sdk 的 rdb 全表 SELECT（分页取，每页 1000）
 * 3) 用 postgres.js 直连 Supabase pooled connection string，逐行 INSERT
 * 4) 顺序：children → courses → checkins → user_prefs → user_passwords → email_otps
 *    backups 表不迁（Supabase 上由 pg_cron 每日备份自己重生）
 *
 * 幂等：
 *   - 每张表都按主键 ON CONFLICT ... DO NOTHING，重复跑不会复制
 *
 * 兼容处理：
 *   - owner_id 历史脏数据（曾被 JSON 序列化包双引号）做 btrim('"') 清洗
 *     （与 data-api 服务端 cleanUid 一致，防止迁完 auth 对不上）
 *
 * 使用：
 *   先装依赖（只需一次）：
 *     cd scripts && npm i
 *   环境变量：
 *     SUPABASE_DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
 *     TCB_ENV_ID=kid-course-tracker-xxxxxx          （缺省读 ../cloudbaserc.json）
 *     CLOUDBASE_APIKEY=...  或  TCB_SDK_SECRET_ID + TCB_SDK_SECRET_KEY（缺省读 ../cloudbaserc.json）
 *   运行：
 *     node scripts/migrate-cloudbase-to-supabase.mjs            # 正式迁移
 *     node scripts/migrate-cloudbase-to-supabase.mjs --dry-run  # 只读 CloudBase，打印行数，不写 Supabase
 *
 * ⚠️ 先执行 supabase/migrations/20260908000001_init_schema.sql 建好表
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import cloudbase from '@cloudbase/node-sdk'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DRY_RUN = process.argv.includes('--dry-run')

const TABLES = [
  { name: 'children',     conflict: 'id' },
  { name: 'courses',      conflict: 'id' },
  { name: 'checkins',     conflict: 'id' },
  { name: 'user_prefs',   conflict: 'owner_id' },
  { name: 'user_passwords', conflict: 'email' },
  { name: 'email_otps',   conflict: 'id' },
]

function loadCloudBaseConfig() {
  // 允许 ../cloudbaserc.json（gitignored，含真实密钥）兜底，省去每次 export
  try {
    const p = join(__dirname, '..', 'cloudbaserc.json')
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, 'utf8'))
      const fn = cfg.functions?.find?.((f) => f.name === 'auth-otp')
      const env = fn?.envVariables ?? {}
      return {
        envId: cfg.envId,
        apiKey: env.CLOUDBASE_APIKEY || null,
        secretId: env.TCB_SDK_SECRET_ID || null,
        secretKey: env.TCB_SDK_SECRET_KEY || null,
      }
    }
  } catch {
    /* ignore */
  }
  return { envId: null, apiKey: null, secretId: null, secretKey: null }
}

function initCloudBase() {
  const fallback = loadCloudBaseConfig()
  const env = process.env.TCB_ENV_ID || fallback.envId
  if (!env) throw new Error('TCB_ENV_ID not set (或 cloudbaserc.json 缺失)')
  const cfg = { env }
  const apiKey = process.env.CLOUDBASE_APIKEY || fallback.apiKey
  const secretId = process.env.TCB_SDK_SECRET_ID || fallback.secretId
  const secretKey = process.env.TCB_SDK_SECRET_KEY || fallback.secretKey
  if (apiKey) cfg.accessKey = apiKey
  else if (secretId && secretKey) {
    cfg.secretId = secretId
    cfg.secretKey = secretKey
  } else {
    throw new Error('CLOUDBASE_APIKEY or TCB_SDK_SECRET_ID/KEY required')
  }
  return cloudbase.init(cfg)
}

async function selectAll(app, table) {
  // CloudBase rdb 单次最多返 1000 行；>1000 要分页
  const rdb = () => app.rdb({ database: 'public' })
  const all = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const q = await rdb().from(table).select('*').range(offset, offset + pageSize - 1)
    if (q && q.error) throw new Error(`CloudBase ${table} select error: ${JSON.stringify(q.error)}`)
    const data = Array.isArray(q.data) ? q.data : q.data ? [q.data] : []
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

/** 行清洗：owner_id 去历史双引号；null 字段去掉；Date → ISO */
function normalizeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue
    if (k === 'owner_id' && typeof v === 'string') {
      out[k] = v.replace(/^"+|"+$/g, '')
      continue
    }
    if (v instanceof Date) {
      out[k] = v.toISOString()
      continue
    }
    out[k] = v
  }
  return out
}

async function insertBatch(sql, table, conflictCol, rows) {
  if (rows.length === 0) return 0
  const cols = Object.keys(rows[0])
  const placeholders = cols.map((_, c) => `$${c + 1}`).join(', ')
  let inserted = 0
  for (const raw of rows) {
    const row = normalizeRow(raw)
    const values = cols.map((c) => row[c])
    try {
      await sql.unsafe(
        `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
          `ON CONFLICT (${conflictCol}) DO NOTHING`,
        values,
      )
      inserted += 1
    } catch (e) {
      console.error(`[${table}] insert failed:`, e.message, 'key =', row.id || row.email || row.owner_id)
    }
  }
  return inserted
}

async function main() {
  console.log(`[migrate] CloudBase → Supabase ${DRY_RUN ? '（DRY-RUN 只读模式）' : '开始'}`)

  const url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL
  if (!DRY_RUN && !url) {
    throw new Error('SUPABASE_DATABASE_URL not set (Supabase pooled connection string)')
  }

  const app = initCloudBase()
  const sql = DRY_RUN ? null : postgres(url, { max: 2, prepare: false, ssl: 'require' })

  try {
    for (const { name: table, conflict } of TABLES) {
      console.log(`[migrate] ${table} ...`)
      const rows = await selectAll(app, table)
      console.log(`[migrate]   CloudBase 行数: ${rows.length}`)
      if (DRY_RUN || rows.length === 0) continue
      const inserted = await insertBatch(sql, table, conflict, rows)
      console.log(`[migrate]   写入 Supabase: ${inserted}（其余为重复冲突跳过）`)
    }
    console.log('[migrate] done')
  } finally {
    if (sql) await sql.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('[migrate] FAILED:', e)
  process.exit(1)
})
