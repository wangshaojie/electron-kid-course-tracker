#!/usr/bin/env node
/**
 * 应用一个 SQL migration 文件到 Supabase Postgres
 * --------------------------------------------------------------
 * 用法：
 *   node scripts/apply-migration.cjs supabase/migrations/20261023153000_enforce_course_hours_limit.sql
 *
 * 连接串来源（优先级）：
 *   1. 环境变量 DATABASE_URL
 *   2. vercel/.env.local 里的 DATABASE_URL=...
 *
 * ⚠️ 为什么不用 PowerShell 管道喂 SQL：
 *    多行 SQL 经 Get-Content -Raw 走管道时，PowerShell 会把 `$` 当变量插值
 *    （比如 scrypt$16384$... 被截断成 scrypt），文件必须原样读取。
 *    本脚本用 fs.readFileSync(file, 'utf8') 直接读，不经过 shell。
 *
 * ⚠️ 为什么不在显式事务里跑：
 *    连接串是事务模式 pooler（:6543），DDL 走显式事务容易踩 pooler 的坑。
 *    这里用 autocommit（每条语句自带事务），配合 migration 文件里
 *    CREATE OR REPLACE / DROP ... IF EXISTS 的幂等写法。
 */

const fs = require('node:fs')
const path = require('node:path')
const postgres = require('postgres')

const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, 'vercel', '.env.local')

/** 读 dotenv 文件（只取 KEY=VALUE，忽略注释/空行） */
function loadEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

/** 连接串打码：密码 → ***，project-ref → 前 4 位 + *** */
function redact(u) {
  try {
    const p = new URL(u)
    const user = p.username || ''
    const ref = user.includes('.') ? `${user.split('.')[0]}.${user.split('.')[1].slice(0, 4)}***` : user
    return `${p.protocol}//${ref}:${p.password ? '***' : '(无密码)'}@${p.host}${p.pathname}`
  } catch {
    return '(解析失败)'
  }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('用法: node scripts/apply-migration.cjs <migration.sql>')
    process.exit(1)
  }
  const abs = path.resolve(process.cwd(), file)
  if (!fs.existsSync(abs)) {
    console.error(`✗ 找不到文件: ${file}`)
    process.exit(1)
  }

  const env = loadEnvFile(ENV_FILE)
  const url = String(process.env.DATABASE_URL || env.DATABASE_URL || '')
    .replace(/^\uFEFF+/, '')
    .trim()
  if (!url) {
    console.error('✗ 没找到 DATABASE_URL（环境变量或 vercel/.env.local）')
    process.exit(1)
  }

  const sqlText = fs.readFileSync(abs, 'utf8')
  console.log('=== 应用 migration ===')
  console.log(`文件     : ${path.relative(ROOT, abs)}`)
  console.log(`连接     : ${redact(url)}`)
  console.log(`语句数   : ${sqlText.split(';').length - 1}`)

  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: 'require',
    connect_timeout: 20,
    connection: { application_name: 'kid-course-tracker-migrate' },
  })

  try {
    await sql.unsafe(sqlText)
    console.log(`\n✓ 已应用: ${path.relative(ROOT, abs)}`)
  } catch (e) {
    console.error(`\n✗ 应用失败: ${e?.message || e}`)
    if (e?.code) console.error(`  SQLSTATE: ${e.code}`)
    try { await sql.end() } catch { /* ignore */ }
    process.exit(1)
  }
  try { await sql.end() } catch { /* ignore */ }
}

main()
