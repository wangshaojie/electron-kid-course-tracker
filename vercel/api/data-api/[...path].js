/**
 * /api/data-api/[...path]
 * --------------------------------------------------------------
 * 取代 CloudBase data-api HTTP Function。
 *
 * 路由：
 *   GET  /health                 → 健康检查
 *   GET  /admin/stats            → 管理员面板统计（需 admin）
 *   GET  /admin/users            → 注册用户表（需 admin）
 *   GET    /b/:table             → 列表（owner_id 强制过滤 + 业务白名单过滤/排序）
 *   GET    /b/:table/:id         → 单条
 *   POST   /b/:table             → 新增（owner_id 服务端注入）
 *   PATCH  /b/:table/:id         → 更新
 *   PATCH  /b/:table             → 按 owner_id upsert（user_prefs 用）
 *   DELETE /b/:table/:id         → 删除
 *
 * env:
 *   - DATABASE_URL    Supabase pooled connection string
 *   - JWT_SECRET      与 auth-otp 共享
 *   - ADMIN_EMAILS    逗号分隔管理员邮箱（小写）
 */

import { createHash } from 'node:crypto'
import { getSql } from '../../lib/db.js'
import { requireAuthAsync, requireAdminAsync, sendJson, readJsonBody } from '../../lib/auth.js'

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

      // 注意：Neon serverless tag template 不支持动态表名/列名拼接。
      // 这里只允许白名单的 4 张表，硬编码 4 条 SELECT 路径。
      // 为简单，列表只走最常见的 owner_id + 几个 eq 过滤；order / dateRange 用 Neon 友好的 raw query。
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

// 管理员统计
async function handleAdminStats(req, res) {
  const auth = await requireAdminAsync(req, res)
  if (!auth) return
  try {
    const sql = getSql()
    const [children, courses, checkins, prefs] = await Promise.all([
      sql`SELECT owner_id FROM children`,
      sql`SELECT owner_id FROM courses`,
      sql`SELECT owner_id FROM checkins`,
      sql`SELECT owner_id FROM user_prefs`,
    ])
    const allOwners = new Set()
    const childOwnersSet = new Set()
    for (const r of children) {
      const u = cleanUid(r.owner_id)
      if (u) {
        allOwners.add(u)
        childOwnersSet.add(u)
      }
    }
    for (const r of courses) {
      const u = cleanUid(r.owner_id)
      if (u) allOwners.add(u)
    }
    for (const r of checkins) {
      const u = cleanUid(r.owner_id)
      if (u) allOwners.add(u)
    }
    for (const r of prefs) {
      const u = cleanUid(r.owner_id)
      if (u) allOwners.add(u)
    }
    const totalUsers = allOwners.size
    const usersWithChildren = childOwnersSet.size
    const childCoverageRate = totalUsers > 0 ? usersWithChildren / totalUsers : 0
    return sendJson(res, 200, {
      ok: true,
      totalUsers,
      usersWithChildren,
      childCoverageRate: Number(childCoverageRate.toFixed(4)),
      totalChildren: children.length,
      totalCourses: courses.length,
      totalCheckins: checkins.length,
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[admin/stats] error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }
}

// 注册用户表
async function handleAdminUsers(req, res) {
  const auth = await requireAdminAsync(req, res)
  if (!auth) return
  try {
    const sql = getSql()
    const [childRows, courseRows, checkinRows, otpRows] = await Promise.all([
      sql`SELECT owner_id, created_at FROM children`,
      sql`SELECT owner_id FROM courses`,
      sql`SELECT owner_id FROM checkins`,
      sql`SELECT email, consumed_at FROM email_otps WHERE consumed_at IS NOT NULL`,
    ])

    const map = new Map()
    for (const r of childRows) {
      const uid = cleanUid(r.owner_id)
      if (!uid) continue
      const cur = map.get(uid) || { childCount: 0, firstSeenAt: null, courseCount: 0, checkinCount: 0 }
      cur.childCount += 1
      if (r.created_at && (!cur.firstSeenAt || r.created_at < cur.firstSeenAt)) cur.firstSeenAt = r.created_at
      map.set(uid, cur)
    }
    for (const r of courseRows) {
      const uid = cleanUid(r.owner_id)
      if (!uid) continue
      const cur = map.get(uid) || { childCount: 0, firstSeenAt: null, courseCount: 0, checkinCount: 0 }
      cur.courseCount += 1
      map.set(uid, cur)
    }
    for (const r of checkinRows) {
      const uid = cleanUid(r.owner_id)
      if (!uid) continue
      const cur = map.get(uid) || { childCount: 0, firstSeenAt: null, courseCount: 0, checkinCount: 0 }
      cur.checkinCount += 1
      map.set(uid, cur)
    }

    const emailToUid = new Map()
    for (const r of otpRows) {
      if (!r.email) continue
      const uid = createHash('sha256').update(String(r.email).toLowerCase()).digest('hex').slice(0, 32)
      emailToUid.set(uid, String(r.email).toLowerCase())
    }

    const users = []
    for (const [ownerId, agg] of map.entries()) {
      users.push({
        uid: ownerId,
        email: emailToUid.get(ownerId) || null,
        firstSeenAt: agg.firstSeenAt,
        childCount: agg.childCount,
        courseCount: agg.courseCount,
        checkinCount: agg.checkinCount,
      })
    }
    users.sort((a, b) => {
      const ta = a.firstSeenAt ? new Date(a.firstSeenAt).getTime() : 0
      const tb = b.firstSeenAt ? new Date(b.firstSeenAt).getTime() : 0
      return tb - ta
    })

    return sendJson(res, 200, {
      ok: true,
      total: users.length,
      users: users.slice(0, 500),
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[admin/users] error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }
}

function handleHealth(req, res) {
  return sendJson(res, 200, {
    ok: true,
    adminCount: String(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean).length,
    ts: new Date().toISOString(),
  })
}

// 入口
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  // Vercel catch-all [...path] 把 path 放在 req.query.path，可能是 string 或 string[]
  const rawPath = req.query.path
  const path = (Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath || '')).toLowerCase()
  try {
    // /api/data-api/health
    if (path === 'health' && req.method === 'GET') return handleHealth(req, res)

    // /api/data-api/admin/stats | /admin/users
    if (path === 'admin/stats' && req.method === 'GET') return await handleAdminStats(req, res)
    if (path === 'admin/users' && req.method === 'GET') return await handleAdminUsers(req, res)

    // /api/data-api/b/:table[/:id]
    const m = path.match(/^b\/([a-z_]+)(?:\/([a-z0-9-]+))?$/)
    if (m) {
      const table = m[1]
      const id = m[2] || null
      // Vercel 把查询串塞到 req.query 里（已 parse 成 object）
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
