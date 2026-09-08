/**
 * Supabase Postgres 客户端
 * --------------------------------------------------------------
 * 所有云函数（auth-otp / data-api）通过这个工具直连 Supabase PG。
 * 用 postgres.js（与 Neon serverless driver 同源的通用 PG 驱动），
 * 因此函数里的 `sql`tag / ${sql('table')} 片段 / sql.query() 三种用法
 * 与迁 Neon 版完全兼容，业务函数零改动。
 *
 * ⚠️ 安全模型（沿用 CloudBase / Neon 版）：
 *   - 这里用 Supabase 连接串里的 postgres 角色（superuser / BYPASSRLS）直连。
 *   - owner_id 由各 handler 从 JWT 强制注入，data-api 表名/列名走白名单。
 *   - 数据库侧 RLS 已开 + FORCE + anon/authenticated 权限已 revoke
 *     （见 supabase/migrations/20260908000002_harden_security.sql），
 *     即使 anon key 泄露直连 PostgREST 也拿不到数据。
 *
 * env:
 *   - DATABASE_URL  Supabase pooled connection string（必填）
 *                   例：postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
 *   - PGSSL         'disable' 可关 TLS（仅本地调试用，生产勿开）
 */

import postgres from 'postgres'

let _sql = null

/**
 * 取 SQL 函数（懒加载 + 模块级缓存，Vercel 冷启动后复用连接）
 *  - max: 1          每个 Function 实例只保持 1 条连接，够用且省连接数
 *  - prepare: false  Supabase 事务模式 pooler(:6543) 不支持服务端 prepared statement
 *  - ssl: require    池化连接强制 TLS（Supabase 要求）
 */
export function getSql() {
  if (_sql) return _sql
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set (Supabase connection string)')
  }
  const ssl = process.env.PGSSL === 'disable' ? false : 'require'
  _sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl,
    connection: { application_name: 'kid-course-tracker' },
    // ⚠️ 类型对齐 CloudBase(PostgREST) 输出，避免桌面端回归：
    //  - numeric(OID 1700)：PostgREST 给 JSON number；postgres.js 默认给 string，
    //    会破坏前端 `reduce((s, c) => s + c.total_amount, 0)` 这类加法（变字符串拼接）
    //  - date(OID 1082)：PostgREST 给 'YYYY-MM-DD'；postgres.js 默认给 Date 且按服务器
    //    时区解释，JSON 化后可能日期错位 → 保持原样字符串
    //  - timestamptz/timestamp 保持默认 Date，JSON 序列化为 ISO 串，与 PostgREST 等价
    types: {
      numeric: { to: 0, from: [1700], parse: Number, serialize: (v) => String(v) },
      date: {
        to: 0,
        from: [1082],
        parse: (v) => v,
        serialize: (v) =>
          typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10),
      },
    },
  })

  // 兼容旧调用：Neon driver 的 sql.query(text, params) → postgres.js unsafe()
  // postgres.js.unsafe() 返回与 tag 相同的行数组（对象数组）
  _sql.query = (text, params) => _sql.unsafe(text, params)

  return _sql
}

/**
 * 一次性执行多条 SQL（用于 schema 初始化等原始 SQL）
 * 注意：表名/列名不允许来自外部拼接（防注入），只用于预写的 DDL。
 */
export async function execRaw(rawSql) {
  const sql = getSql()
  return sql.unsafe(rawSql)
}
