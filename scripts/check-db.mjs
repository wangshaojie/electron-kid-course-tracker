#!/usr/bin/env node
/**
 * 数据库连接自检
 * --------------------------------------------------------------
 * 用途：数据库密码轮换 / 换连接串 / 排查"连不上"时，一条命令确认
 *       「本地 .env.local → Supabase PG → 业务表」这条链路是否通。
 *
 * 用法：
 *   node scripts/check-db.mjs
 *
 * 行为：
 *   - 读取 vercel/.env.local（dotenv 格式），也接受环境变量 DATABASE_URL 覆盖
 *   - 复用 vercel/lib/db.js 的 getSql()（与线上函数走同一套连接参数）
 *   - 打印连接串时**密码与 project-ref 一律打码**，绝不输出明文
 *   - 检查业务表是否齐全、user_prefs.theme 列是否在
 *   - 打印各表行数
 *
 * 退出码：0 = 全通；1 = 有问题
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, 'vercel', '.env.local')

// ---- 1. 读取连接串 ----
function parseEnvFile(file) {
  try {
    const raw = readFileSync(file, 'utf8')
    const out = {}
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      out[key] = val
    }
    return out
  } catch {
    return {}
  }
}

const fileEnv = parseEnvFile(ENV_FILE)
const url = String(process.env.DATABASE_URL || fileEnv.DATABASE_URL || '')
  .replace(/^\uFEFF+/, '')
  .trim()

/** 连接串打码：密码 → ***，project-ref → 前4位+*** */
function redact(u) {
  if (!u) return '(未配置)'
  try {
    const parsed = new URL(u)
    const user = parsed.username || ''
    const ref = user.includes('.') ? `${user.split('.')[0]}.${user.split('.')[1].slice(0, 4)}***` : user
    const pass = parsed.password ? '***' : '(无密码)'
    return `${parsed.protocol}//${ref}:${pass}@${parsed.host}${parsed.pathname}${parsed.search}`
  } catch {
    return '(解析失败)'
  }
}

console.log('=== 数据库连接自检 ===')
console.log(`连接串来源 : ${process.env.DATABASE_URL ? '环境变量 DATABASE_URL' : `文件 ${path.relative(ROOT, ENV_FILE)}`}`)
console.log(`连接串     : ${redact(url)}`)

if (!url) {
  console.log('\n✗ 没找到 DATABASE_URL')
  console.log(`  请在 ${path.relative(ROOT, ENV_FILE)} 里配置：DATABASE_URL=postgresql://...`)
  process.exit(1)
}

// ---- 2. 连库 ----
process.env.DATABASE_URL = url
const { getSql } = await import('../vercel/lib/db.js')
const sql = getSql()

let ok = true
try {
  const [one] = await sql`select 1 as ok`
  if (one?.ok !== 1) throw new Error('select 1 返回异常')

  const [info] = await sql`
    select current_user as usr, current_database() as db,
           version() as ver, inet_server_addr()::text as host
  `
  console.log(`\n✓ 连接成功`)
  console.log(`  当前用户 : ${info.usr}`)
  console.log(`  数据库   : ${info.db}`)
  console.log(`  服务地址 : ${info.host || '(未返回)'}`)
  console.log(`  版本     : ${String(info.ver).split(' on ')[0]}`)
} catch (e) {
  const msg = String(e?.message || e)
  console.log(`\n✗ 连接失败：${msg}`)
  if (/password authentication failed|ECONNREFUSED|timeout|ENOTFOUND|getaddrinfo/i.test(msg)) {
    console.log('  排查建议：')
    console.log('   · 如果你刚在 Supabase 后台轮换过密码 → 本地 .env.local 与 Vercel 环境变量都要同步更新')
    console.log('   · 确认用的是事务模式 pooler（端口 6543）而不是直连端口 5432')
  }
  try { await sql.end() } catch { /* ignore */ }
  process.exit(1)
}

// ---- 3. 表结构 ----
const REQUIRED = ['children', 'courses', 'checkins', 'user_prefs', 'user_passwords', 'email_otps']
console.log('\n=== 业务表 ===')
// ⚠️ 不要用 `= any(${sql([...])})`：postgres.js 会把数组渲染成标识符列表
//    （"a","b"）而不是数组参数 → SQL 语法错。这里查全表再在 JS 里过滤。
const found = await sql`
  select table_name from information_schema.tables where table_schema = 'public'
`
const have = new Set(found.map((r) => r.table_name))
for (const t of REQUIRED) {
  if (!have.has(t)) {
    console.log(`  ✗ ${t} 缺失`)
    ok = false
  }
}

const cols = await sql`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'user_prefs'
`
const colNames = new Set(cols.map((c) => c.column_name))
if (!colNames.has('theme')) {
  console.log('  ✗ user_prefs.theme 列缺失（多设备主题同步会失效）')
  ok = false
}

if (ok) {
  console.log('  ✓ 表齐全' + (colNames.has('theme') ? '，user_prefs.theme 存在' : ''))
}

// ---- 4. 行数 ----
console.log('\n=== 各表行数 ===')
for (const t of REQUIRED) {
  if (!have.has(t)) continue
  const rows = await sql.unsafe(`select count(*)::int as n from ${t}`)
  console.log(`  ${t.padEnd(16)} ${rows[0].n}`)
}

try { await sql.end() } catch { /* ignore */ }

console.log(`\n${ok ? '✓ 自检通过' : '✗ 自检发现问题（见上面标记）'}`)
process.exit(ok ? 0 : 1)
