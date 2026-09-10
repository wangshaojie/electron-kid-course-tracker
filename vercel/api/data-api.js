/**
 * /api/data-api  单文件函数
 * --------------------------------------------------------------
 * 子路径经 vercel.json rewrites 以 ?path= 传入，如：
 *   /api/data-api/health        → ?path=health
 *   /api/data-api/admin/users   → ?path=admin/users
 *   /api/data-api/admin/active  → ?path=admin/active
 *   /api/data-api/admin/leaderboard → ?path=admin/leaderboard
 *   /api/data-api/admin/logins  → ?path=admin/logins
 *   /api/data-api/b/children    → ?path=b/children
 * 函数从 req.query.path / req.url 解析子路径再分发。
 *
 * 路由：
 *   GET  /health                              → 健康检查
 *   GET  /admin/users                         → 注册用户表（带搜索/筛选）
 *   GET  /admin/active                        → 活跃度 + 留存 + 登录事件流
 *   GET  /admin/leaderboard                   → 课程名/机构 热度榜
 *   GET  /admin/logins                        → 登录设备 / IP 审计
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
 *   - ADMIN_EMAILS    逗号分隔管理员邮箱（小写）
 */

import { getSql } from '../lib/db.js'
import { requireAuthAsync, requireAdminAsync, sendJson, readJsonBody, preflight } from '../lib/auth.js'

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

// ============== 通用：admin handler 模板 ==============
/**
 * 探测 login_events 表是否存在；返回 { available, probe }
 *  - 用 to_regclass，不抛错；表不存在时返 null
 */
async function probeLoginEvents(sql) {
  try {
    const exist = await sql`SELECT to_regclass('public.login_events') AS r`
    return { available: !!exist?.[0]?.r, probe: exist?.[0]?.r || null }
  } catch (e) {
    console.error('[admin] to_regclass error:', e?.message || e)
    return { available: false, probe: null, error: e?.message || String(e) }
  }
}

// ============== /admin/users —— 注册用户表（带搜索/筛选/排序）==============
/**
 * Query:
 *   q           模糊匹配 email（子串，不区分大小写）或 uid（前缀）
 *   method      登录方式筛选：otp-verify / password-login / register
 *   since_days  最近 N 天内有登录（基于 login_events.created_at）
 *   order       first_seen_at | last_login_at | child_count | course_count | checkin_count
 *   asc         true/false（默认按 order 倒序：false）
 *   limit       默认 500，最大 10000
 *
 * Response:
 *   { ok, total, users, meta }
 */
const ADMIN_USERS_SCAN_LIMIT = 10000

async function handleAdminUsers(req, res) {
  const auth = await requireAdminAsync(req, res)
  if (!auth) return
  const sql = getSql()
  const degraded = []

  const safeQuery = async (key, label, query) => {
    try {
      const rows = await query()
      return { key, ok: true, rows: Array.isArray(rows) ? rows : [] }
    } catch (e) {
      console.error(`[admin/users:${key}] error:`, e?.message || e)
      degraded.push({ key, label, error: e?.message || String(e) })
      return { key, ok: false, rows: [] }
    }
  }

  const sp = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams.entries())
  const q = (sp.q || '').trim()
  const method = (sp.method || '').trim()
  const sinceDays = Number.parseInt(sp.since_days || '0', 10) || 0
  const order = sp.order || 'first_seen_at'
  const asc = sp.asc === 'true' || sp.asc === '1'
  const limit = Math.min(Math.max(Number.parseInt(sp.limit || '500', 10) || 500, 1), ADMIN_USERS_SCAN_LIMIT)

  const loginProbe = await probeLoginEvents(sql)
  if (!loginProbe.available) {
    degraded.push({ key: 'login_events', label: '登录事件表', error: 'table_missing_or_not_accessible' })
  }

  // 5 段独立可降级
  const [childR, courseR, checkinR, otpR, loginR] = await Promise.all([
    safeQuery('children', '宝贝', () =>
      sql.query(`SELECT owner_id, created_at FROM children LIMIT ${ADMIN_USERS_SCAN_LIMIT}`, []),
    ),
    safeQuery('courses', '课程', () =>
      sql.query(`SELECT owner_id FROM courses LIMIT ${ADMIN_USERS_SCAN_LIMIT}`, []),
    ),
    safeQuery('checkins', '打卡', () =>
      sql.query(`SELECT owner_id FROM checkins LIMIT ${ADMIN_USERS_SCAN_LIMIT}`, []),
    ),
    safeQuery('email_otps', '邮箱反查', () =>
      sql.query(
        `SELECT email, consumed_at FROM email_otps WHERE consumed_at IS NOT NULL LIMIT ${ADMIN_USERS_SCAN_LIMIT}`,
        [],
      ),
    ),
    loginProbe.available
      ? safeQuery('login_events', '最近登录', () =>
          sql.query(
            `SELECT owner_id, email, ip, os, arch, client, app_version, electron_ver, user_agent, auth_method, created_at
               FROM login_events
              ORDER BY created_at DESC
              LIMIT ${ADMIN_USERS_SCAN_LIMIT}`,
            [],
          ),
        )
      : Promise.resolve({ key: 'login_events', ok: false, rows: [] }),
  ])

  // 聚合 owner_id 维度
  const map = new Map()
  for (const r of childR.rows) {
    const uid = cleanUid(r.owner_id)
    if (!uid) continue
    const cur = map.get(uid) || {
      childCount: 0,
      firstSeenAt: null,
      courseCount: 0,
      checkinCount: 0,
    }
    cur.childCount += 1
    if (r.created_at && (!cur.firstSeenAt || r.created_at < cur.firstSeenAt)) {
      cur.firstSeenAt = r.created_at
    }
    map.set(uid, cur)
  }
  for (const r of courseR.rows) {
    const uid = cleanUid(r.owner_id)
    if (!uid) continue
    const cur = map.get(uid) || {
      childCount: 0,
      firstSeenAt: null,
      courseCount: 0,
      checkinCount: 0,
    }
    cur.courseCount += 1
    map.set(uid, cur)
  }
  for (const r of checkinR.rows) {
    const uid = cleanUid(r.owner_id)
    if (!uid) continue
    const cur = map.get(uid) || {
      childCount: 0,
      firstSeenAt: null,
      courseCount: 0,
      checkinCount: 0,
    }
    cur.checkinCount += 1
    map.set(uid, cur)
  }

  const emailToUid = new Map()
  for (const r of otpR.rows) {
    if (!r.email) continue
    const key = String(r.email).toLowerCase()
    if (!emailToUid.has(key)) emailToUid.set(key, key)
  }

  // 登录事件聚合：每用户去重 ip / device 集合
  const ipByUser = new Map()
  const deviceByUser = new Map()
  const appByUser = new Map()
  const lastSeen = new Map()
  for (const r of loginR.rows) {
    const uid = cleanUid(r.owner_id)
    if (!uid) continue
    if (!lastSeen.has(uid)) {
      lastSeen.set(uid, {
        ip: r.ip || null,
        os: r.os || null,
        arch: r.arch || null,
        client: r.client || null,
        appVersion: r.app_version || null,
        electronVersion: r.electron_ver || null,
        userAgent: r.user_agent || null,
        authMethod: r.auth_method || null,
        lastLoginAt: r.created_at || null,
      })
    }
    if (r.ip) {
      const set = ipByUser.get(uid) || new Set()
      set.add(r.ip)
      ipByUser.set(uid, set)
    }
    if (r.os || r.arch) {
      const set = deviceByUser.get(uid) || new Set()
      set.add(`${r.os || '?'} / ${r.arch || '?'}`)
      deviceByUser.set(uid, set)
    }
    if (r.app_version) {
      const set = appByUser.get(uid) || new Set()
      set.add(r.app_version)
      appByUser.set(uid, set)
    }
  }

  // 构造用户列表
  let users = []
  for (const [ownerId, agg] of map.entries()) {
    const last = lastSeen.get(ownerId)
    users.push({
      uid: ownerId,
      email: emailToUid.get(ownerId) || null,
      firstSeenAt: agg.firstSeenAt,
      childCount: agg.childCount,
      courseCount: agg.courseCount,
      checkinCount: agg.checkinCount,
      lastIp: last?.ip ?? null,
      lastOs: last?.os ?? null,
      lastArch: last?.arch ?? null,
      lastClient: last?.client ?? null,
      lastAppVersion: last?.appVersion ?? null,
      lastElectronVersion: last?.electronVersion ?? null,
      lastUserAgent: last?.userAgent ?? null,
      lastAuthMethod: last?.authMethod ?? null,
      lastLoginAt: last?.lastLoginAt ?? null,
      distinctIpCount: ipByUser.get(ownerId)?.size || 0,
      distinctDeviceCount: deviceByUser.get(ownerId)?.size || 0,
      distinctAppCount: appByUser.get(ownerId)?.size || 0,
    })
  }

  // 搜索 / 筛选
  if (q) {
    const qLower = q.toLowerCase()
    users = users.filter((u) => {
      if (u.email && u.email.toLowerCase().includes(qLower)) return true
      if (u.uid.startsWith(q)) return true
      return false
    })
  }
  if (method) {
    users = users.filter((u) => u.lastAuthMethod === method)
  }
  if (sinceDays > 0) {
    const cutoff = Date.now() - sinceDays * 86400_000
    users = users.filter((u) => u.lastLoginAt && new Date(u.lastLoginAt).getTime() >= cutoff)
  }

  // 排序
  const cmp = (col) => (a, b) => {
    const va = a[col]
    const vb = b[col]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return asc ? va - vb : vb - va
    return asc
      ? new Date(va).getTime() - new Date(vb).getTime()
      : new Date(vb).getTime() - new Date(va).getTime()
  }
  if (order === 'child_count') users.sort(cmp('childCount'))
  else if (order === 'course_count') users.sort(cmp('courseCount'))
  else if (order === 'checkin_count') users.sort(cmp('checkinCount'))
  else if (order === 'last_login_at') users.sort(cmp('lastLoginAt'))
  else users.sort(cmp('firstSeenAt'))

  const sliced = users.slice(0, limit)
  return sendJson(res, 200, {
    ok: true,
    total: users.length,
    users: sliced,
    meta: {
      degraded: degraded.length > 0,
      degradedKeys: degraded.map((d) => d.key),
      loginEventsAvailable: loginProbe.available,
      loginEventCount: loginR.rows.length,
      fetchedAt: new Date().toISOString(),
    },
  })
}

// ============== /admin/active —— 用户活跃度 + 留存 + 登录事件流 ==============
/**
 * Query:
 *   days        趋势窗口（默认 30，最大 90）
 *   bucket      day | week | month（默认 day）
 *   event_limit 登录事件流条数（默认 200，最大 1000）
 *
 * Response:
 *   {
 *     ok, summary, trend: [{ bucket, activeUsers, newUsers, logins }],
 *     recent: [...], // 登录事件流（最新在前）
 *     retention: { d1, d7, d30 }, // 粗略 1/7/30 日留存率
 *     meta
 *   }
 */
async function handleAdminActive(req, res) {
  const auth = await requireAdminAsync(req, res)
  if (!auth) return
  const sql = getSql()
  const degraded = []

  const safeQuery = async (key, label, query) => {
    try {
      const rows = await query()
      return { key, ok: true, rows: Array.isArray(rows) ? rows : [] }
    } catch (e) {
      console.error(`[admin/active:${key}] error:`, e?.message || e)
      degraded.push({ key, label, error: e?.message || String(e) })
      return { key, ok: false, rows: [] }
    }
  }

  const sp = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams.entries())
  const days = Math.min(Math.max(Number.parseInt(sp.days || '30', 10) || 30, 1), 90)
  const bucket = ['day', 'week', 'month'].includes(sp.bucket) ? sp.bucket : 'day'
  const eventLimit = Math.min(Math.max(Number.parseInt(sp.event_limit || '200', 10) || 200, 1), 1000)

  const loginProbe = await probeLoginEvents(sql)
  if (!loginProbe.available) {
    degraded.push({ key: 'login_events', label: '登录事件表', error: 'table_missing_or_not_accessible' })
  }

  const cutoffIso = new Date(Date.now() - days * 86400_000).toISOString()

  const [childrenR, loginRecentR, loginAllR] = await Promise.all([
    safeQuery('children', '宝贝（首次出现）', () =>
      sql.query(
        `SELECT owner_id, created_at FROM children WHERE created_at >= $1 LIMIT ${ADMIN_USERS_SCAN_LIMIT}`,
        [cutoffIso],
      ),
    ),
    loginProbe.available
      ? safeQuery('login_events_recent', '登录事件流', () =>
          sql.query(
            `SELECT id, owner_id, email, ip, os, arch, client, app_version, electron_ver, user_agent, auth_method, created_at
               FROM login_events
              ORDER BY created_at DESC
              LIMIT ${eventLimit}`,
            [],
          ),
        )
      : Promise.resolve({ key: 'login_events', ok: false, rows: [] }),
    // 留存 / 趋势要用：窗口内所有登录
    loginProbe.available
      ? safeQuery('login_events_window', '登录事件（窗口）', () =>
          sql.query(
            `SELECT owner_id, created_at FROM login_events WHERE created_at >= $1 LIMIT ${ADMIN_USERS_SCAN_LIMIT}`,
            [cutoffIso],
          ),
        )
      : Promise.resolve({ key: 'login_events', ok: false, rows: [] }),
  ])

  // ---- 趋势分桶 ----
  const dateTrunc = bucket === 'week' ? 'week' : bucket === 'month' ? 'month' : 'day'
  // 客户端按 created_at 字符串分桶（避免 date_trunc 时区坑）
  const bucketKey = (iso) => {
    const d = new Date(iso)
    if (bucket === 'day') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    if (bucket === 'month') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    // week: 周一首桶
    const day = d.getDay() || 7
    const mon = new Date(d)
    mon.setDate(d.getDate() - (day - 1))
    return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
  }
  const trendMap = new Map() // bucket -> { activeUsers:Set, newUsers:Set, logins:number }
  for (const r of loginAllR.rows) {
    const uid = cleanUid(r.owner_id)
    if (!uid || !r.created_at) continue
    const k = bucketKey(r.created_at)
    const cur = trendMap.get(k) || { activeUsers: new Set(), newUsers: new Set(), logins: 0 }
    cur.activeUsers.add(uid)
    cur.logins += 1
    trendMap.set(k, cur)
  }
  for (const r of childrenR.rows) {
    const uid = cleanUid(r.owner_id)
    if (!uid || !r.created_at) continue
    const k = bucketKey(r.created_at)
    const cur = trendMap.get(k) || { activeUsers: new Set(), newUsers: new Set(), logins: 0 }
    cur.newUsers.add(uid)
    trendMap.set(k, cur)
  }
  const trend = Array.from(trendMap.entries())
    .map(([k, v]) => ({
      bucket: k,
      activeUsers: v.activeUsers.size,
      newUsers: v.newUsers.size,
      logins: v.logins,
    }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0))

  // ---- 留存（粗略版：登录过的用户里，最近一次登录距今 ≤ 1/7/30 天的占比）----
  //  严格留存要 join 注册日 + 第 N 日回访；这里走"近 N 日回访率"代理，可读性足够。
  const now = Date.now()
  const lastLoginByUser = new Map()
  for (const r of loginAllR.rows) {
    const uid = cleanUid(r.owner_id)
    if (!uid || !r.created_at) continue
    const t = new Date(r.created_at).getTime()
    const cur = lastLoginByUser.get(uid) || 0
    if (t > cur) lastLoginByUser.set(uid, t)
  }
  const totalActive = lastLoginByUser.size
  const retention = { d1: 0, d7: 0, d30: 0 }
  if (totalActive > 0) {
    let d1 = 0, d7 = 0, d30 = 0
    for (const t of lastLoginByUser.values()) {
      const age = now - t
      if (age <= 86400_000) d1 += 1
      if (age <= 7 * 86400_000) d7 += 1
      if (age <= 30 * 86400_000) d30 += 1
    }
    retention.d1 = Number((d1 / totalActive).toFixed(4))
    retention.d7 = Number((d7 / totalActive).toFixed(4))
    retention.d30 = Number((d30 / totalActive).toFixed(4))
  }

  // ---- 登录事件流 ----
  const recent = loginRecentR.rows.map((r) => ({
    id: r.id,
    ownerId: cleanUid(r.owner_id),
    email: r.email,
    ip: r.ip,
    os: r.os,
    arch: r.arch,
    client: r.client,
    appVersion: r.app_version,
    electronVersion: r.electron_ver,
    userAgent: r.user_agent,
    authMethod: r.auth_method,
    createdAt: r.created_at,
  }))

  return sendJson(res, 200, {
    ok: true,
    summary: {
      windowDays: days,
      bucket: dateTrunc,
      totalActiveInWindow: totalActive,
      totalLoginsInWindow: loginAllR.rows.length,
      newUsersInWindow: childrenR.rows.length,
    },
    trend,
    recent,
    retention,
    meta: {
      degraded: degraded.length > 0,
      degradedKeys: degraded.map((d) => d.key),
      loginEventsAvailable: loginProbe.available,
      fetchedAt: new Date().toISOString(),
    },
  })
}

// ============== /admin/leaderboard —— 课程/机构 热度榜 ==============
/**
 * Query:
 *   limit   TOP N（默认 20，最大 200）
 *   by      course | institution（默认 course）
 *
 * Response:
 *   { ok, by, total, items: [{ name, ownerCount, count, totalAmount, totalHours }], meta }
 */
async function handleAdminLeaderboard(req, res) {
  const auth = await requireAdminAsync(req, res)
  if (!auth) return
  const sql = getSql()
  const degraded = []

  const safeQuery = async (key, label, query) => {
    try {
      const rows = await query()
      return { key, ok: true, rows: Array.isArray(rows) ? rows : [] }
    } catch (e) {
      console.error(`[admin/leaderboard:${key}] error:`, e?.message || e)
      degraded.push({ key, label, error: e?.message || String(e) })
      return { key, ok: false, rows: [] }
    }
  }

  const sp = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams.entries())
  const limit = Math.min(Math.max(Number.parseInt(sp.limit || '20', 10) || 20, 1), 200)
  const by = sp.by === 'institution' ? 'institution' : 'course'

  const [courseR, checkinR] = await Promise.all([
    safeQuery('courses', '课程聚合', () =>
      sql.query(
        `SELECT name, institution, owner_id, total_amount, total_hours
           FROM courses
          LIMIT ${ADMIN_USERS_SCAN_LIMIT}`,
        [],
      ),
    ),
    safeQuery('checkins', '打卡聚合', () =>
      sql.query(
        `SELECT course_id, hours FROM checkins LIMIT ${ADMIN_USERS_SCAN_LIMIT}`,
        [],
      ),
    ),
  ])

  // course name → { ownerSet, count, totalAmount, totalHours, usedHours }
  const byName = new Map()
  for (const r of courseR.rows) {
    const name = (r.name || '').trim()
    if (!name) continue
    const cur = byName.get(name) || {
      name,
      ownerSet: new Set(),
      count: 0,
      totalAmount: 0,
      totalHours: 0,
      courseIds: new Set(),
    }
    const owner = cleanUid(r.owner_id)
    if (owner) cur.ownerSet.add(owner)
    cur.count += 1
    cur.totalAmount += Number(r.total_amount) || 0
    cur.totalHours += Number(r.total_hours) || 0
    byName.set(name, cur)
  }
  // 机构聚合：按 owner 算 ownerCount（避免同一用户多课叠加）
  const byInstitution = new Map()
  for (const r of courseR.rows) {
    const inst = (r.institution || '').trim()
    if (!inst) continue
    const cur = byInstitution.get(inst) || {
      name: inst,
      ownerSet: new Set(),
      count: 0,
      totalAmount: 0,
      totalHours: 0,
    }
    const owner = cleanUid(r.owner_id)
    if (owner) cur.ownerSet.add(owner)
    cur.count += 1
    cur.totalAmount += Number(r.total_amount) || 0
    cur.totalHours += Number(r.total_hours) || 0
    byInstitution.set(inst, cur)
  }
  // 把 usedHours 通过 course_id 关联
  const usedByCourse = new Map()
  for (const r of checkinR.rows) {
    usedByCourse.set(r.course_id, (usedByCourse.get(r.course_id) || 0) + Number(r.hours || 0))
  }

  const source = by === 'institution' ? byInstitution : byName
  const items = Array.from(source.entries())
    .map(([k, v]) => ({
      name: k,
      ownerCount: v.ownerSet.size,
      count: v.count,
      totalAmount: Math.round(v.totalAmount * 100) / 100,
      totalHours: Math.round(v.totalHours * 100) / 100,
    }))
    .sort((a, b) => {
      if (b.ownerCount !== a.ownerCount) return b.ownerCount - a.ownerCount
      if (b.count !== a.count) return b.count - a.count
      return b.totalAmount - a.totalAmount
    })
    .slice(0, limit)

  return sendJson(res, 200, {
    ok: true,
    by,
    total: items.length,
    items,
    meta: {
      degraded: degraded.length > 0,
      degradedKeys: degraded.map((d) => d.key),
      fetchedAt: new Date().toISOString(),
    },
  })
}

// ============== /admin/logins —— 登录设备 / IP 审计 ==============
/**
 * Query:
 *   since_days 窗口（默认 30，最大 90）
 *   limit      详情条数（默认 200，最大 1000）
 *
 * Response:
 *   { ok, summary: { totalLogins, distinctUsers, distinctIps, distinctOs, distinctVersions },
 *     topIps: [...], topOs: [...], topVersions: [...],
 *     recent: [...] , meta }
 */
async function handleAdminLogins(req, res) {
  const auth = await requireAdminAsync(req, res)
  if (!auth) return
  const sql = getSql()
  const degraded = []

  const safeQuery = async (key, label, query) => {
    try {
      const rows = await query()
      return { key, ok: true, rows: Array.isArray(rows) ? rows : [] }
    } catch (e) {
      console.error(`[admin/logins:${key}] error:`, e?.message || e)
      degraded.push({ key, label, error: e?.message || String(e) })
      return { key, ok: false, rows: [] }
    }
  }

  const sp = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams.entries())
  const sinceDays = Math.min(Math.max(Number.parseInt(sp.since_days || '30', 10) || 30, 1), 90)
  const limit = Math.min(Math.max(Number.parseInt(sp.limit || '200', 10) || 200, 1), 1000)
  const cutoffIso = new Date(Date.now() - sinceDays * 86400_000).toISOString()

  const loginProbe = await probeLoginEvents(sql)
  if (!loginProbe.available) {
    degraded.push({ key: 'login_events', label: '登录事件表', error: 'table_missing_or_not_accessible' })
    return sendJson(res, 200, {
      ok: true,
      summary: { totalLogins: 0, distinctUsers: 0, distinctIps: 0, distinctOs: 0, distinctVersions: 0 },
      topIps: [],
      topOs: [],
      topVersions: [],
      recent: [],
      meta: {
        degraded: true,
        degradedKeys: ['login_events'],
        loginEventsAvailable: false,
        fetchedAt: new Date().toISOString(),
      },
    })
  }

  const [windowR, recentR] = await Promise.all([
    safeQuery('login_events_window', '窗口内登录', () =>
      sql.query(
        `SELECT owner_id, email, ip, os, arch, client, app_version, auth_method, created_at
           FROM login_events
          WHERE created_at >= $1
          LIMIT ${ADMIN_USERS_SCAN_LIMIT}`,
        [cutoffIso],
      ),
    ),
    safeQuery('login_events_recent', '最近登录流', () =>
      sql.query(
        `SELECT id, owner_id, email, ip, os, arch, client, app_version, electron_ver, user_agent, auth_method, created_at
           FROM login_events
          ORDER BY created_at DESC
          LIMIT ${limit}`,
        [],
      ),
    ),
  ])

  const userSet = new Set()
  const ipSet = new Set()
  const osSet = new Set()
  const versionSet = new Set()
  const ipCount = new Map()
  const osCount = new Map()
  const versionCount = new Map()
  for (const r of windowR.rows) {
    const owner = cleanUid(r.owner_id)
    if (owner) userSet.add(owner)
    if (r.ip) {
      ipSet.add(r.ip)
      ipCount.set(r.ip, (ipCount.get(r.ip) || 0) + 1)
    }
    const osKey = r.os ? `${r.os}${r.arch ? ' / ' + r.arch : ''}` : null
    if (osKey) {
      osSet.add(osKey)
      osCount.set(osKey, (osCount.get(osKey) || 0) + 1)
    }
    if (r.app_version) {
      versionSet.add(r.app_version)
      versionCount.set(r.app_version, (versionCount.get(r.app_version) || 0) + 1)
    }
  }

  const top = (m) =>
    Array.from(m.entries())
      .map(([k, v]) => ({ name: k, count: v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

  const recent = recentR.rows.map((r) => ({
    id: r.id,
    ownerId: cleanUid(r.owner_id),
    email: r.email,
    ip: r.ip,
    os: r.os,
    arch: r.arch,
    client: r.client,
    appVersion: r.app_version,
    electronVersion: r.electron_ver,
    userAgent: r.user_agent,
    authMethod: r.auth_method,
    createdAt: r.created_at,
  }))

  return sendJson(res, 200, {
    ok: true,
    summary: {
      totalLogins: windowR.rows.length,
      distinctUsers: userSet.size,
      distinctIps: ipSet.size,
      distinctOs: osSet.size,
      distinctVersions: versionSet.size,
      sinceDays,
    },
    topIps: top(ipCount),
    topOs: top(osCount),
    topVersions: top(versionCount),
    recent,
    meta: {
      degraded: degraded.length > 0,
      degradedKeys: degraded.map((d) => d.key),
      loginEventsAvailable: loginProbe.available,
      fetchedAt: new Date().toISOString(),
    },
  })
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

// 从请求里提取 data-api 之后的路径段。
// Vercel 平台对 catch-all 的注入不总是可靠（实测 req.query.path 可能为空、多段甚至不进函数），
// 因此优先取 req.query.path，其次从 req.url 兜底解析，保证 health/admin/b 路由可用。
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

    // admin/* 路由（全部 GET，全部需 admin）
    if (path === 'admin/users' && req.method === 'GET') return await handleAdminUsers(req, res)
    if (path === 'admin/active' && req.method === 'GET') return await handleAdminActive(req, res)
    if (path === 'admin/leaderboard' && req.method === 'GET') return await handleAdminLeaderboard(req, res)
    if (path === 'admin/logins' && req.method === 'GET') return await handleAdminLogins(req, res)

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
