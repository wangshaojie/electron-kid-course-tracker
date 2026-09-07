#!/usr/bin/env node
/**
 * CloudBase PG → Neon 数据迁移脚本
 * --------------------------------------------------------------
 * 1) 读 CloudBase envId + API key
 * 2) 用 @cloudbase/node-sdk 的 rdb 全表 SELECT
 * 3) 用 @neondatabase/serverless 的 neon INSERT 到 Neon
 * 4) 按外键依赖顺序：children → courses → checkins → user_prefs → user_passwords → email_otps
 *    backups 表跳过（pg-backup 函数专属，Neon 上重做）
 *
 * 幂等：
 *   - children / courses / checkins / user_prefs / user_passwords / email_otps 都用 ON CONFLICT
 *     DO NOTHING（按 PK 或 unique 约束），重复跑不会复制
 *
 * 使用：
 *   node scripts/migrate-cloudbase-to-neon.mjs
 *   （需要环境变量：CLOUDBASE_APIKEY / TCB_SDK_SECRET_ID / TCB_SDK_SECRET_KEY / TCB_ENV_ID / DATABASE_URL）
 *
 * ⚠️ 必须先在 Neon 端跑 cloudbase/migrations/_neon_combined.sql 建好表
 */

import cloudbase from '@cloudbase/node-sdk'
import { neon } from '@neondatabase/serverless'

const TABLES = [
  'children',
  'courses',
  'checkins',
  'user_prefs',
  'user_passwords',
  'email_otps',
  // backups 表不迁（pg-backup 会在 Neon 侧自己重生）
]

const TABLES_USE_STRINGIFY = new Set(['email_otps']) // 大字段，注意 JSON 化

function initCloudBase() {
  const env = process.env.TCB_ENV_ID
  if (!env) throw new Error('TCB_ENV_ID not set')
  const cfg = { env }
  if (process.env.CLOUDBASE_APIKEY) cfg.accessKey = process.env.CLOUDBASE_APIKEY
  else if (process.env.TCB_SDK_SECRET_ID && process.env.TCB_SDK_SECRET_KEY) {
    cfg.secretId = process.env.TCB_SDK_SECRET_ID
    cfg.secretKey = process.env.TCB_SDK_SECRET_KEY
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

function toNeonValue(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  return v
}

async function insertBatch(sql, table, rows) {
  if (rows.length === 0) return 0
  // 用 raw query + ON CONFLICT DO NOTHING 走幂等
  // 注意：表名固定在白名单内，col 名也来自 rows[0] 的 keys，安全
  const cols = Object.keys(rows[0])
  const placeholders = cols.map((_, c) => `$${c + 1}`).join(', ')
  let inserted = 0
  for (const row of rows) {
    const values = cols.map((c) => toNeonValue(row[c]))
    try {
      await sql.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values,
      )
      inserted += 1
    } catch (e) {
      console.error(`[${table}] insert failed:`, e.message, 'row id =', row.id || row.email || row.owner_id)
    }
  }
  return inserted
}

async function main() {
  console.log('[migrate] CloudBase → Neon 开始')

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set (Neon connection string)')

  const app = initCloudBase()
  const sql = neon(process.env.DATABASE_URL)

  for (const table of TABLES) {
    console.log(`[migrate] ${table} ...`)
    const rows = await selectAll(app, table)
    console.log(`[migrate]   fetched ${rows.length} rows from CloudBase`)
    if (rows.length === 0) continue
    const inserted = await insertBatch(sql, table, rows)
    console.log(`[migrate]   inserted ${inserted} rows into Neon (others skipped/conflict)`)
  }

  console.log('[migrate] done')
}

main().catch((e) => {
  console.error('[migrate] FAILED:', e)
  process.exit(1)
})
