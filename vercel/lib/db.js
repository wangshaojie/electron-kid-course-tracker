/**
 * Neon Postgres 客户端
 * --------------------------------------------------------------
 * 迁 Neon 后，所有云函数（auth-otp / data-api）通过这个工具直连 Neon。
 * 用 Neon 官方 serverless driver（HTTP-based，适配 Vercel Edge/Serverless）。
 *
 * ⚠️ 现状安全模型（沿用 CloudBase 版）：
 *   - Neon 没有"service role"概念，这里直接用 Neon connection string 里的 owner 账号（超级用户）。
 *   - owner_id 由各 handler 从 JWT 强制注入，data-api 表名/列名走白名单。
 *   - 不依赖 RLS（也建议别开 RLS——少一层复杂度，只要注入逻辑严谨就够）。
 *
 * env:
 *   - DATABASE_URL  Neon pooled connection string（必填，运行时缺失直接抛）
 *                    例：postgresql://neondb_owner:xxx@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
 */

import { neon } from '@neondatabase/serverless'

let _sql = null

/**
 * 取 SQL 函数（懒加载，第一次访问时建立）
 *  - Vercel Functions 每个请求可能冷启动，所以用 lazy + 缓存避免重复建立
 *  - neon() 返回的是一个 tag function: `sql\`select * from x where id = ${id}\``
 */
export function getSql() {
  if (_sql) return _sql
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set (Neon connection string)')
  }
  // 用 Neon serverless HTTP driver，Vercel Functions 上不需要 ws（fetchConnectionCache）
  _sql = neon(url)
  return _sql
}

/**
 * 一次性执行多条 SQL（用于 schema 初始化、数据迁移脚本）
 * 注意：tag template 内部不能用占位符做表名/列名（防 SQL 注入）。
 *       这里用 sql.query(rawString) 跑预先准备好的 DDL。
 */
export async function execRaw(rawSql) {
  const sql = getSql()
  return sql.query(rawSql)
}
