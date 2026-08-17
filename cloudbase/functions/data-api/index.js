/**
 * data-api —— 管理员后台 + 业务数据 API（业务收口版）
 *
 * 路由（scf_bootstrap 启 http.createServer.listen(9000) 内部分发）：
 *   GET  /health           健康检查（无需鉴权）
 *   GET  /admin/stats      管理员面板统计（需要 admin role）
 *   GET  /admin/users      注册用户表（需要 admin role）
 *   GET/POST/PATCH/DELETE  /b/:table[/:id]   业务 CRUD（登录即可）
 *        GET    /b/:table          列表（select / eq 过滤 / date 范围 / order）
 *        GET    /b/:table/:id      单条
 *        POST   /b/:table          新增（返回单条）
 *        PATCH  /b/:table/:id      更新（返回单条）
 *        PATCH  /b/:table          按 owner_id upsert（user_prefs 用）
 *        DELETE /b/:table/:id      删除
 *
 * 鉴权（两道）：
 *   1. Authorization: Bearer <jwt>  → 用 JWT_SECRET 验签（所有非 /health 路由）
 *   2. /admin/* 额外要求 email ∈ ADMIN_EMAILS（重新查 env，不信任 JWT 里的 role）
 *
 * 业务安全（数据收口的关键）：
 *   - 前端不再直连 PostgREST（anon policy 已删），业务读写全部走本函数
 *   - owner_id 永远从 JWT 注入，前端传的 owner_id 一律忽略 → 跨账号读写不可能
 *   - 表名 / 写入列 / 过滤列 / 排序列全部白名单，防止任意 SQL 注入面
 *   - 本函数用 service role（CLOUDBASE_APIKEY）访问 PG，角色 BYPASSRLS，
 *     不受 RLS / anon policy 影响
 *
 * env 变量（cloudbaserc.json 注入）：
 *   - TCB_ENV_ID          CloudBase 环境 id
 *   - CLOUDBASE_APIKEY    CloudBase API key（service role）
 *   - TCB_SDK_SECRET_ID / TCB_SDK_SECRET_KEY  备选凭据
 *   - JWT_SECRET          与 auth-otp 共享的签 secret
 *   - ADMIN_EMAILS        逗号分隔的管理员邮箱
 *
 * ⚠️ SCF WEB_SCF 模式下，scf_bootstrap 启的 `node index.js` 模块顶层
 * 也会执行 `require.main === module` 块（SCF 下也成立），所以 listen 9000
 * 是必须的——SCF 把 9000 当 fastcgi 端口接 HTTP 请求。**不要删除**这段。
 */

const http = require('http')
const crypto = require('crypto')
const cloudbase = require('@cloudbase/node-sdk')
const jwt = require('jsonwebtoken')

const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS_BASE }

const JWT_SECRET = process.env.JWT_SECRET || ''
const TCB_ENV_ID = process.env.TCB_ENV_ID
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const adminEmailSet = new Set(ADMIN_EMAILS)

if (!JWT_SECRET) console.error('[data-api] JWT_SECRET is not set')
if (!TCB_ENV_ID) console.error('[data-api] TCB_ENV_ID is not set')
if (ADMIN_EMAILS.length === 0) console.error('[data-api] ADMIN_EMAILS is empty — no one can access /admin/*')

// CloudBase SDK 懒加载（避免模块顶层 throw 让 SCF 冷启动失败）
let _app = null
let _rdb = null
function getRdb() {
  if (!_rdb) {
    const initConfig = { env: TCB_ENV_ID }
    if (process.env.CLOUDBASE_APIKEY) {
      initConfig.accessKey = process.env.CLOUDBASE_APIKEY
    } else if (process.env.TCB_SDK_SECRET_ID && process.env.TCB_SDK_SECRET_KEY) {
      initConfig.secretId = process.env.TCB_SDK_SECRET_ID
      initConfig.secretKey = process.env.TCB_SDK_SECRET_KEY
    }
    _app = cloudbase.init(initConfig)
    _rdb = () => _app.rdb({ database: 'public' })
  }
  return _rdb()
}

// ============== helpers ==============
function sendJson(res, status, data) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(data))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(new Error('Invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

/**
 * 解析 Bearer token
 *  - 缺 token / 验签失败 → { ok: false, error }
 *  - role 不在 jwt 里也允许（老 token），后续 admin 路由再过白名单
 */
function verifyBearer(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || ''
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  if (!m) return { ok: false, error: 'missing_authorization' }
  const token = m[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    return { ok: true, payload }
  } catch (e) {
    return { ok: false, error: 'invalid_token', detail: e.message }
  }
}

/** 登录即可访问（验签通过），返回 { email, uid }；失败已写 401 */
function requireAuth(req, res) {
  const v = verifyBearer(req)
  if (!v.ok) {
    sendJson(res, 401, { error: v.error, detail: v.detail })
    return null
  }
  const uid = typeof v.payload.uid === 'string' ? v.payload.uid : ''
  if (!uid) {
    sendJson(res, 401, { error: 'invalid_token', detail: 'missing uid in JWT' })
    return null
  }
  return { email: (v.payload.email || '').toLowerCase(), uid }
}

/** admin 路由：登录 + 现查 ADMIN_EMAILS 白名单（不信任 JWT 里的 role） */
function requireAdmin(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return null
  if (!auth.email || !adminEmailSet.has(auth.email)) {
    sendJson(res, 403, { error: 'forbidden', message: 'not in ADMIN_EMAILS' })
    return null
  }
  return auth
}

// 兼容历史脏数据：owner_id 可能是 JSON 字符串（含 " 包裹），统一 trim
const cleanUid = (v) => typeof v === 'string' ? v.replace(/^"+|"+$/g, '') : v

// ============== 业务表白名单（数据收口核心） ==============
// select: 可查询的列（含 select= 指定子集）
// write:  可写入/更新的列（owner_id 由服务端注入，不在此列）
// filters: URL 上可作为 eq 条件的列
// orders:  可排序的列
// dateRange: 是否支持 date_gte / date_lte（checkins.date 范围过滤）
const BUSINESS_TABLES = {
  children: {
    select: ['id', 'owner_id', 'name', 'emoji', 'color', 'sort_order', 'created_at'],
    write: ['name', 'emoji', 'color', 'sort_order'],
    filters: [],
    orders: ['sort_order', 'created_at'],
  },
  courses: {
    select: ['id', 'owner_id', 'child_id', 'name', 'institution', 'total_amount', 'total_hours', 'paid_at', 'expires_at', 'tags', 'note', 'created_at', 'updated_at'],
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

/** 只挑白名单内的写入字段（owner_id 一律忽略，由服务端注入） */
function pickWriteFields(body, def) {
  const out = {}
  for (const k of def.write) {
    if (body[k] !== undefined) out[k] = body[k]
  }
  return out
}

/** 解析列表查询参数 → { select, eq:[[col,val]], dateGte, dateLte, order, asc } */
function parseBusinessQuery(sp, def) {
  const out = { select: '*', eq: [], dateGte: null, dateLte: null, order: null, asc: true }
  const sel = sp.get('select')
  if (sel) {
    const cols = sel.split(',').map((s) => s.trim()).filter(Boolean)
    for (const c of cols) {
      if (!def.select.includes(c)) throw new Error(`invalid select column: ${c}`)
    }
    out.select = cols.join(',')
  }
  const order = sp.get('order')
  if (order) {
    if (!def.orders.includes(order)) throw new Error(`invalid order column: ${order}`)
    out.order = order
    const asc = sp.get('asc')
    out.asc = !(asc === 'false' || asc === '0')
  }
  if (def.dateRange) {
    const gte = sp.get('date_gte')
    if (gte) out.dateGte = gte
    const lte = sp.get('date_lte')
    if (lte) out.dateLte = lte
  }
  const reserved = new Set(['select', 'order', 'asc', 'date_gte', 'date_lte'])
  for (const [k, v] of sp.entries()) {
    if (reserved.has(k)) continue
    if (!def.filters.includes(k)) continue
    if (v === '') continue
    out.eq.push([k, v])
  }
  return out
}

/**
 * 业务 CRUD handler
 *  - owner_id 从 JWT 取，所有查询强制 .eq('owner_id', uid)
 *  - 表名 / 列名走白名单，不存在则 404 / 400
 */
async function handleBusiness(req, res, url) {
  const auth = requireAuth(req, res)
  if (!auth) return
  const uid = auth.uid

  const m = url.pathname.match(/^\/b\/([a-z_]+)(?:\/([a-zA-Z0-9-]+))?$/)
  if (!m) return sendJson(res, 404, { error: 'not_found' })
  const table = m[1]
  const id = m[2] || null
  const def = BUSINESS_TABLES[table]
  if (!def) return sendJson(res, 404, { error: 'unknown_table', detail: table })

  const rdb = getRdb()
  const base = rdb.from(table)
  // ⚠️ node-sdk 的 from() 返回 PostgrestQueryBuilder，本身没有 .eq()；
  //    必须先 .select()/.insert()/.update()/.delete() 拿到 FilterBuilder 再链过滤。
  //    所有业务查询都以 .select('*') 起步，并强制 .eq('owner_id', uid)。

  try {
    // ---------- 查询 ----------
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await base
          .select('*')
          .eq('owner_id', uid)
          .eq('id', id)
          .maybeSingle()
        if (error) return sendJson(res, 500, { error: 'db_error', detail: error.message || JSON.stringify(error) })
        if (!data) return sendJson(res, 404, { error: 'not_found', detail: `${table}/${id}` })
        return sendJson(res, 200, { ok: true, data })
      }
      let q
      try {
        q = parseBusinessQuery(url.searchParams, def)
      } catch (e) {
        return sendJson(res, 400, { error: 'bad_query', detail: e.message })
      }
      let query = base.select(q.select).eq('owner_id', uid)
      for (const [col, val] of q.eq) query = query.eq(col, val)
      if (q.dateGte) query = query.gte('date', q.dateGte)
      if (q.dateLte) query = query.lte('date', q.dateLte)
      if (q.order) query = query.order(q.order, { ascending: q.asc })
      const { data, error } = await query
      if (error) return sendJson(res, 500, { error: 'db_error', detail: error.message || JSON.stringify(error) })
      return sendJson(res, 200, { ok: true, data: data || [] })
    }

    const body = await readJsonBody(req)

    // ---------- 新增 ----------
    if (req.method === 'POST') {
      const payload = pickWriteFields(body, def)
      payload.owner_id = uid
      const { data, error } = await base.insert(payload).select('*').single()
      if (error) return sendJson(res, 400, { error: 'db_error', detail: error.message || JSON.stringify(error) })
      return sendJson(res, 200, { ok: true, data })
    }

    // ---------- 更新 / upsert ----------
    if (req.method === 'PATCH') {
      const payload = pickWriteFields(body, def)
      if (id) {
        const { data, error } = await base
          .update(payload)
          .eq('owner_id', uid)
          .eq('id', id)
          .select('*')
          .maybeSingle()
        if (error) return sendJson(res, 400, { error: 'db_error', detail: error.message || JSON.stringify(error) })
        if (!data) return sendJson(res, 404, { error: 'not_found', detail: `${table}/${id}` })
        return sendJson(res, 200, { ok: true, data })
      }
      // 无 id 的 PATCH = 按 owner_id upsert（user_prefs：一个账号一行）
      const { data: existing, error: getErr } = await base.select('*').eq('owner_id', uid).maybeSingle()
      if (getErr) return sendJson(res, 500, { error: 'db_error', detail: getErr.message || JSON.stringify(getErr) })
      if (existing) {
        // update 不带 owner_id（PK 不变）
        const { data, error } = await base.update(payload).eq('owner_id', uid).select('*').maybeSingle()
        if (error) return sendJson(res, 400, { error: 'db_error', detail: error.message || JSON.stringify(error) })
        return sendJson(res, 200, { ok: true, data })
      }
      const { data, error } = await base.insert({ ...payload, owner_id: uid }).select('*').single()
      if (error) return sendJson(res, 400, { error: 'db_error', detail: error.message || JSON.stringify(error) })
      return sendJson(res, 200, { ok: true, data })
    }

    // ---------- 删除 ----------
    if (req.method === 'DELETE' && id) {
      const { data, error } = await base.delete().eq('owner_id', uid).eq('id', id)
      if (error) return sendJson(res, 400, { error: 'db_error', detail: error.message || JSON.stringify(error) })
      return sendJson(res, 200, { ok: true, deleted: Array.isArray(data) ? data.length : (data ? 1 : 0) })
    }

    return sendJson(res, 405, { error: 'method_not_allowed', detail: req.method })
  } catch (e) {
    console.error('[business] handler error:', e)
    return sendJson(res, 500, { error: 'internal', detail: e?.message || String(e) })
  }
}

// ============== handlers ==============

/**
 * GET /health —— 健康检查
 */
async function handleHealth(req, res) {
  return sendJson(res, 200, {
    ok: true,
    adminCount: ADMIN_EMAILS.length,
    ts: new Date().toISOString(),
  })
}

/**
 * GET /admin/stats
 * 返：
 *  - totalUsers        跨 4 表 owner_id 去重数
 *  - usersWithChildren children 表去重 owner_id
 *  - childCoverageRate usersWithChildren / totalUsers
 *  - totalChildren / totalCourses / totalCheckins 业务行数
 */
async function handleAdminStats(req, res) {
  const auth = requireAdmin(req, res)
  if (!auth) return

  try {
    const [childrenOwners, coursesOwners, checkinsOwners, prefsOwners] = await Promise.all([
      getRdb().from('children').select('owner_id'),
      getRdb().from('courses').select('owner_id'),
      getRdb().from('checkins').select('owner_id'),
      getRdb().from('user_prefs').select('owner_id'),
    ])

    for (const [name, r] of [
      ['children', childrenOwners],
      ['courses', coursesOwners],
      ['checkins', checkinsOwners],
      ['user_prefs', prefsOwners],
    ]) {
      if (r && r.error) {
        console.error('[admin/stats] %s error:', name, r.error)
        return sendJson(res, 500, { error: 'db_error', source: name, detail: r.error.message || JSON.stringify(r.error) })
      }
    }

    const allOwners = new Set()
    for (const r of [childrenOwners, coursesOwners, checkinsOwners, prefsOwners]) {
      for (const row of r.data || []) {
        if (row && row.owner_id) allOwners.add(cleanUid(row.owner_id))
      }
    }
    const totalUsers = allOwners.size

    const childOwnersSet = new Set(
      (childrenOwners.data || []).map((r) => cleanUid(r.owner_id)).filter(Boolean),
    )
    const usersWithChildren = childOwnersSet.size
    const childCoverageRate = totalUsers > 0 ? usersWithChildren / totalUsers : 0

    return sendJson(res, 200, {
      ok: true,
      totalUsers,
      usersWithChildren,
      childCoverageRate: Number(childCoverageRate.toFixed(4)),
      totalChildren: (childrenOwners.data || []).length,
      totalCourses: (coursesOwners.data || []).length,
      totalCheckins: (checkinsOwners.data || []).length,
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[admin/stats] error:', e)
    return sendJson(res, 500, { error: 'internal', detail: e?.message || String(e) })
  }
}

/**
 * GET /admin/users
 * 返注册用户表（owner_id 维度）：uid / email（反查） / 首次创建 / 孩子 / 课程 / 打卡
 */
async function handleAdminUsers(req, res) {
  const auth = requireAdmin(req, res)
  if (!auth) return

  try {
    const [childRows, courseRows, checkinRows, otpRows] = await Promise.all([
      getRdb().from('children').select('owner_id, created_at'),
      getRdb().from('courses').select('owner_id'),
      getRdb().from('checkins').select('owner_id'),
      getRdb().from('email_otps').select('email, consumed_at').not('consumed_at', 'is', null),
    ])

    if (childRows.error) {
      console.error('[admin/users] children error:', childRows.error)
      return sendJson(res, 500, { error: 'db_error', detail: childRows.error.message })
    }

    const map = new Map()
    for (const r of childRows.data || []) {
      const uid = cleanUid(r.owner_id)
      if (!uid) continue
      const cur = map.get(uid) || { childCount: 0, firstSeenAt: null, courseCount: 0, checkinCount: 0 }
      cur.childCount += 1
      const ca = r.created_at
      if (ca && (!cur.firstSeenAt || ca < cur.firstSeenAt)) cur.firstSeenAt = ca
      map.set(uid, cur)
    }
    for (const r of courseRows.data || []) {
      const uid = cleanUid(r.owner_id)
      if (!uid) continue
      const cur = map.get(uid) || { childCount: 0, firstSeenAt: null, courseCount: 0, checkinCount: 0 }
      cur.courseCount += 1
      map.set(uid, cur)
    }
    for (const r of checkinRows.data || []) {
      const uid = cleanUid(r.owner_id)
      if (!uid) continue
      const cur = map.get(uid) || { childCount: 0, firstSeenAt: null, courseCount: 0, checkinCount: 0 }
      cur.checkinCount += 1
      map.set(uid, cur)
    }

    const emailToUid = new Map()
    for (const r of otpRows.data || []) {
      if (!r.email) continue
      const uid = crypto.createHash('sha256').update(r.email.toLowerCase()).digest('hex').slice(0, 32)
      emailToUid.set(uid, r.email.toLowerCase())
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
    return sendJson(res, 500, { error: 'internal', detail: e?.message || String(e) })
  }
}

// ============== SCF Web 模式入口（scf_bootstrap 启 node index.js）=============
// SCF WEB_SCF 模式下，scf_bootstrap 启的 `node index.js` 模块顶层会执行本块。
// SCF 把 9000 端口当 fastcgi 端口接 HTTP 请求，**必须 listen 9000**。
// 旧 SCF Event 模式（exports.main）在这套环境不再被调用。

if (require.main === module) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_BASE)
      return res.end()
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return await handleHealth(req, res)
      }
      if (req.method === 'GET' && url.pathname === '/admin/stats') {
        return await handleAdminStats(req, res)
      }
      if (req.method === 'GET' && url.pathname === '/admin/users') {
        return await handleAdminUsers(req, res)
      }
      // 业务 CRUD：/b/:table 或 /b/:table/:id
      if (/^\/b\/[a-z_]+\/?$/.test(url.pathname) || /^\/b\/[a-z_]+\/[a-zA-Z0-9-]+$/.test(url.pathname)) {
        return await handleBusiness(req, res, url)
      }
      return sendJson(res, 404, { error: 'not_found' })
    } catch (e) {
      console.error('[server] handler error:', e)
      return sendJson(res, 500, { error: 'internal', detail: e?.message || String(e) })
    }
  })
  server.listen(9000, () => console.log('[data-api] listening on :9000'))
}

// 仍保留 exports.main 兼容老 SCF Event 触发器（不影响）
exports.main = async (event, _context) => {
  const method = (event.httpMethod || 'GET').toUpperCase()
  const rawPath = (event.path || '/').split('?')[0]
  const segs = rawPath.split('/').filter(Boolean)
  const subPath = '/' + (segs[segs.length - 1] || '')
  return {
    statusCode: 404,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: 'event_mode_not_supported', path: rawPath, subPath, method }),
  }
}
