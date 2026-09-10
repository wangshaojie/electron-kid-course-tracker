/**
 * /api/data-api  单文件函数
 * --------------------------------------------------------------
 * 子路径经 vercel.json rewrites 以 ?path= 传入，如：
 *   /api/data-api/health        → ?path=health
 *   /api/data-api/b/children    → ?path=b/children
 * 函数从 req.query.path / req.url 解析子路径再分发。
 *
 * 路由：
 *   GET  /health                              → 健康检查
 *   GET    /b/:table                          → 列表
 *   GET    /b/:table/:id                      → 单条
 *   POST   /b/:table                          → 新增
 *   PATCH  /b/:table/:id                      → 更新
 *   PATCH  /b/:table                          → 按 owner_id upsert
 *   DELETE /b/:table/:id                      → 删除
 *
 * env:
 *   - DATABASE_URL    Supabase pooled connection string
 *   - JWT_SECRET      与 auth-otp 共享
 */

import { getSql } from '../lib/db.js'
import { requireAuthAsync, sendJson, readJsonBody, preflight } from '../lib/auth.js'

// 业务表白名单（与 CloudBase 版完全一致：select/write/filters/orders/dateRange）
const BUSINESS_TABLES = {
  children: {
    select: ['id', 'owner_id', 'name', 'emoji', 'color', 'sort_order', 'created_at'],
    write: ['name', 'emoji', 'color', 'sort_order'],
    filters: [],
    orders: ['sort_order', 'created_at'],
  },
  courses: {
    select: [
      'id',
      'owner_id',
      'child_id',
      'name',
      'institution',
      'total_amount',
      'total_hours',
      'paid_at',
      'expires_at',
      'tags',
      'note',
      'created_at',
      'updated_at',
    ],
    write: ['child_id', 'name', 'institution', 'total_amount', 'total_hours', 'paid_at', 'expires_at', 'tags', 'note'],
    filters: ['child_id'],
    orders: ['paid_at', 'created_at'],
  },
  checkins: {
    select: ['id', 'owner_id', 'child_id', 'course_id', 'date', 'hours', 'feedback', 'created_at'],
    write: ['child_id', 'course_id', 'date', 'hours', 'feedback'],
    filters: ['child_id', 'course_id'],
    orders: ['date', 'created_at'],
    dateRange: true,
  },
  user_prefs: {
    select: ['owner_id', 'active_child_id', 'created_at', 'updated_at'],
    write: ['active_child_id', 'updated_at'],
    filters: [],
    orders: ['updated_at'],
  },
}

function pickWriteFields(body, def) {
  const out = {}
  for (const k of def.write) {
    if (body[k] !== undefined) out[k] = body[k]
  }
  return out
}

const cleanUid = (v) => (typeof v === 'string' ? v.replace(/^"+|"+$/g, '') : v)

// 业务 CRUD handler
async function handleBusiness(req, res, table, id, searchParams) {
  const auth = await requireAuthAsync(req, res)
  if (!auth) return
  const uid = auth.uid

  const def = BUSINESS_TABLES[table]
  if (!def) return sendJson(res, 404, { error: 'unknown_table', detail: table })

  const sql = getSql()
  try {
    // ---- 查询 ----
    if (req.method === 'GET') {
      if (id) {
        const rows = await sql`
          SELECT * FROM ${sql(table)} WHERE owner_id = ${uid} AND id = ${id} LIMIT 1
        `
        if (!rows.length) return sendJson(res, 404, { error: 'not_found', detail: `${table}/${id}` })
        return sendJson(res, 200, { ok: true, data: rows[0] })
      }

      // 列表：解析查询参数
      const sp = Object.fromEntries(searchParams.entries())
      const order = sp.order
      if (order && !def.orders.includes(order)) {
        return sendJson(res, 400, { error: 'bad_query', detail: `invalid order column: ${order}` })
      }
      const asc = !(sp.asc === 'false' || sp.asc === '0')
      const eqFilters = []
      for (const [k, v] of Object.entries(sp)) {
        if (['select', 'order', 'asc', 'date_gte', 'date_lte'].includes(k)) continue
        if (!def.filters.includes(k)) continue
        if (v === '') continue
        eqFilters.push([k, v])
      }

      const whereClauses = ['owner_id = $1']
      const params = [uid]
      let i = 2
      for (const [col, val] of eqFilters) {
        whereClauses.push(`${col} = $${i++}`)
        params.push(val)
      }
      if (def.dateRange) {
        if (sp.date_gte) {
          whereClauses.push(`date >= $${i++}`)
          params.push(sp.date_gte)
        }
        if (sp.date_lte) {
          whereClauses.push(`date <= $${i++}`)
          params.push(sp.date_lte)
        }
      }
      const orderSql = order ? `ORDER BY ${order} ${asc ? 'ASC' : 'DESC'}` : ''

      const rows = await sql.query(
        `SELECT * FROM ${table} WHERE ${whereClauses.join(' AND ')} ${orderSql}`,
        params,
      )
      return sendJson(res, 200, { ok: true, data: rows })
    }

    const body = await readJsonBody(req)

    // ---- 新增 ----
    if (req.method === 'POST') {
      const payload = pickWriteFields(body, def)
      payload.owner_id = uid
      const cols = Object.keys(payload)
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ')
      const values = cols.map((k) => payload[k])
      const rows = await sql.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values,
      )
      return sendJson(res, 200, { ok: true, data: rows[0] })
    }

    // ---- 更新 / upsert ----
    if (req.method === 'PATCH') {
      const payload = pickWriteFields(body, def)
      if (id) {
        const setClauses = Object.keys(payload).map((k, idx) => `${k} = $${idx + 1}`).join(', ')
        const values = [...Object.values(payload), uid, id]
        const rows = await sql.query(
          `UPDATE ${table} SET ${setClauses} WHERE owner_id = $${values.length - 1} AND id = $${values.length} RETURNING *`,
          values,
        )
        if (!rows.length) return sendJson(res, 404, { error: 'not_found', detail: `${table}/${id}` })
        return sendJson(res, 200, { ok: true, data: rows[0] })
      }
      // 无 id = 按 owner_id upsert（user_prefs）
      const existing = await sql`SELECT * FROM ${sql(table)} WHERE owner_id = ${uid} LIMIT 1`
      if (existing.length) {
        const setClauses = Object.keys(payload).map((k, idx) => `${k} = $${idx + 1}`).join(', ')
        const values = [...Object.values(payload), uid]
        const rows = await sql.query(
          `UPDATE ${table} SET ${setClauses} WHERE owner_id = $${values.length} RETURNING *`,
          values,
        )
        return sendJson(res, 200, { ok: true, data: rows[0] })
      }
      const insertPayload = { ...payload, owner_id: uid }
      const cols = Object.keys(insertPayload)
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ')
      const values = cols.map((k) => insertPayload[k])
      const rows = await sql.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values,
      )
      return sendJson(res, 200, { ok: true, data: rows[0] })
    }

    // ---- 删除 ----
    if (req.method === 'DELETE' && id) {
      const rows = await sql`DELETE FROM ${sql(table)} WHERE owner_id = ${uid} AND id = ${id} RETURNING id`
      return sendJson(res, 200, { ok: true, deleted: rows.length })
    }

    return sendJson(res, 405, { error: 'method_not_allowed', detail: req.method })
  } catch (e) {
    console.error('[business] handler error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }
}

function handleHealth(req, res) {
  return sendJson(res, 200, {
    ok: true,
    ts: new Date().toISOString(),
  })
}

// 从请求里提取 data-api 之后的路径段。
// Vercel 平台对 catch-all 的注入不总是可靠（实测 req.query.path 可能为空、多段甚至不进函数），
// 因此优先取 req.query.path，其次从 req.url 兜底解析，保证 health / b 路由可用。
function extractPath(req) {
  const rawPath = req.query.path
  if (Array.isArray(rawPath)) return rawPath.join('/')
  if (typeof rawPath === 'string' && rawPath) return rawPath
  try {
    const url = new URL(req.url, 'http://localhost')
    const segs = url.pathname.split('/').filter(Boolean)
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === 'data-api') return segs.slice(i + 1).join('/')
    }
  } catch {
    /* ignore */
  }
  return ''
}

// 入口
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    preflight(res)
    return
  }
  const path = extractPath(req).toLowerCase()
  try {
    if (path === 'health' && req.method === 'GET') return handleHealth(req, res)

    // /api/data-api/b/:table[/:id]
    const m = path.match(/^b\/([a-z_]+)(?:\/([a-z0-9-]+))?$/)
    if (m) {
      const table = m[1]
      const id = m[2] || null
      const sp = new URLSearchParams()
      for (const [k, v] of Object.entries(req.query || {})) {
        if (k === 'path') continue
        if (Array.isArray(v)) v.forEach((x) => sp.append(k, x))
        else sp.append(k, String(v))
      }
      return await handleBusiness(req, res, table, id, sp)
    }

    return sendJson(res, 404, { error: 'not_found', detail: path })
  } catch (e) {
    console.error('[data-api] uncaught error:', e)
    return sendJson(res, 500, { error: 'internal', detail: e?.message || String(e) })
  }
}
