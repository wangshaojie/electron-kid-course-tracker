/**
 * auth-otp —— 自建邮箱 OTP（用 Resend 发邮件）
 *
 * 路由（HTTP Function on port 9000）：
 *   POST /send            { email }                       → 生成 6 位码 + 存 PG + 调 Resend 发邮件
 *   POST /verify          { email, code }                 → 校验码 + 标记 consumed + 返回自签 JWT
 *   POST /login           { email, password }             → 密码登录（可选；未设密码返回统一错误防枚举）
 *   POST /set-password    { email, code, password }       → 验证码确认邮箱所有权后 设置/修改 密码
 *   POST /reset-password  { email, code, password }       → 忘记密码重置（与 set-password 同逻辑）
 *   GET  /health                                          → { ok: true }
 *
 * 环境变量（在 tcb 部署时通过 cloudbaserc.json envVariables 注入）：
 *   - RESEND_API_KEY    Resend 的 API key
 *   - MAIL_FROM         发件人（默认 onboarding@resend.dev）
 *   - MAIL_SUBJECT      邮件主题
 *   - JWT_SECRET        签 JWT 用的 secret（强随机串）
 *   - CLOUDBASE_APIKEY  CloudBase API key（有则优先）
 *   - TCB_SDK_SECRET_ID / TCB_SDK_SECRET_KEY   CloudBase SDK 凭据（CLOUDBASE_APIKEY 未设时用）
 *   - TCB_ENV_ID        CloudBase 环境 id
 *   - OTP_RATE_LIMIT_MS   send 同 IP/邮箱最小间隔（默认 60000ms，0 关闭）
 *   - OTP_EMAIL_HOUR_LIMIT  send 单邮箱每小时上限（默认 5，0 关闭）
 */

const http = require('http')
const crypto = require('crypto')
const { URL } = require('url')
const cloudbase = require('@cloudbase/node-sdk')
const { Resend } = require('resend')

const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS_BASE }

const RESEND_API_KEY = process.env.RESEND_API_KEY
const MAIL_FROM = process.env.MAIL_FROM || 'onboarding@resend.dev'
const MAIL_SUBJECT = process.env.MAIL_SUBJECT || '【一寸光阴】您的登录验证码'
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod-please-this-is-a-default'
const TCB_ENV_ID = process.env.TCB_ENV_ID

// 管理员邮箱白名单（逗号分隔），匹配（lowercase trim）则 JWT 拿 role: 'admin'
// 修改后老 JWT 在 30 天内仍有效——data-api 不信任 JWT role，每次现查 ADMIN_EMAILS
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const adminEmailSet = new Set(ADMIN_EMAILS)
function isAdminEmail(email) {
  return typeof email === 'string' && adminEmailSet.has(email.trim().toLowerCase())
}

if (!RESEND_API_KEY) console.error('[auth-otp] RESEND_API_KEY is not set')
if (!TCB_ENV_ID) console.error('[auth-otp] TCB_ENV_ID is not set')
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-in-prod-please-this-is-a-default') {
  console.error('[auth-otp] JWT_SECRET 未设置或仍是默认值！生产环境必须用强随机 secret')
}

// 单例 Resend 客户端
const resend = new Resend(RESEND_API_KEY)

// CloudBase SDK 单例（用环境变量凭据直连）
const initConfig = {
  env: TCB_ENV_ID,
}
if (process.env.CLOUDBASE_APIKEY) {
  initConfig.accessKey = process.env.CLOUDBASE_APIKEY
} else if (process.env.TCB_SDK_SECRET_ID && process.env.TCB_SDK_SECRET_KEY) {
  initConfig.secretId = process.env.TCB_SDK_SECRET_ID
  initConfig.secretKey = process.env.TCB_SDK_SECRET_KEY
}
console.log('[auth-otp] init config keys:', Object.keys(initConfig).join(','))
const app = cloudbase.init(initConfig)
const rdb = () => app.rdb({ database: 'public' })

// 工具函数
function sendJson(res, status, data, _req) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(data))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function genCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
}

function genSalt() {
  return crypto.randomBytes(16).toString('hex')
}

function hashCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex')
}

// ============ 密码（可选登录方式，与验证码并存）============
// 哈希：Node 内置 crypto.scryptSync（零新依赖），存储格式 scrypt$N$r$p$salt$hash，
// 参数内嵌在串里，将来要升级强度可直接重哈希
const PASSWORD_MIN_LEN = 8
const LOGIN_FAIL_LIMIT = 5 // 连续失败 5 次锁 15 分钟（内存 Map，冷启动重置可接受）
const LOGIN_LOCK_MS = 15 * 60 * 1000
const loginFails = new Map() // email -> { count, lockedAt }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const N = 16384
  const r = 8
  const p = 1
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p })
  return `scrypt$${N}$${r}$${p}$${salt}$${hash.toString('hex')}`
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$')
    if (parts[0] !== 'scrypt' || parts.length !== 6) return false
    const [, N, r, p, salt, hashHex] = parts
    const expected = Buffer.from(hashHex, 'hex')
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    })
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// 密码规则：≥ 8 位，至少含字母 + 数字（前端 + 服务端双重校验）
function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= PASSWORD_MIN_LEN && /[A-Za-z]/.test(pw) && /\d/.test(pw)
}

// 校验邮箱的 6 位 OTP 并标记 consumed（/verify 与 /set-password 共用）
// 返回 { ok: true } | { ok: false, status, error }
async function verifyOtpAndConsume(email, code) {
  const now = new Date().toISOString()
  let q
  try {
    q = await rdb()
      .from('email_otps')
      .select('*')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(10)
  } catch (e) {
    console.error('[otp] rdb.select threw:', e)
    return { ok: false, status: 500, error: 'db_error' }
  }
  if (q && q.error) {
    console.error('[otp] rdb.select error:', JSON.stringify(q.error))
    return { ok: false, status: 500, error: 'db_error' }
  }
  const all = Array.isArray(q.data) ? q.data : q.data ? [q.data] : []
  const list = all.filter((r) => r.consumed_at == null && new Date(r.expires_at).getTime() >= Date.now())
  if (list.length === 0) {
    return { ok: false, status: 401, error: 'no_active_code' }
  }
  const row = list[0]

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, error: 'code_expired' }
  }
  if ((row.attempts || 0) >= 5) {
    return { ok: false, status: 401, error: 'too_many_attempts' }
  }

  const codeHash = hashCode(code, row.salt)
  if (codeHash !== row.code_hash) {
    try {
      await rdb()
        .from('email_otps')
        .update({ attempts: (row.attempts || 0) + 1 })
        .eq('id', row.id)
    } catch (e) {
      console.error('[otp] attempts update failed:', e)
    }
    return { ok: false, status: 401, error: 'code_mismatch' }
  }

  try {
    await rdb()
      .from('email_otps')
      .update({ consumed_at: now })
      .eq('id', row.id)
  } catch (e) {
    console.error('[otp] consumed update failed:', e)
    return { ok: false, status: 500, error: 'db_error' }
  }
  return { ok: true }
}

// 简单自签 JWT（HS256）
function signJwt({ email, uid, role }, ttlSec = 60 * 60 * 24 * 30) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { email, uid, role: role || 'user', iat: now, exp: now + ttlSec }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64(header)}.${b64(payload)}`
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const isValidEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e.trim())

// ============ 限流（防被刷）============
// 三层防护：1) IP 限流  2) Email 限流  3) attempts 锁
const RATE_LIMIT_MS = Number.parseInt(process.env.OTP_RATE_LIMIT_MS ?? '60000', 10)
const EMAIL_HOUR_LIMIT = Number.parseInt(process.env.OTP_EMAIL_HOUR_LIMIT ?? '5', 10)

const lastSendByIp = new Map()
const lastSendByEmail = new Map()
function rateLimitIp(ip) {
  if (!RATE_LIMIT_MS || RATE_LIMIT_MS <= 0) return true
  const now = Date.now()
  const last = lastSendByIp.get(ip) || 0
  if (now - last < RATE_LIMIT_MS) return false
  lastSendByIp.set(ip, now)
  return true
}
function rateLimitEmail(email) {
  if (!RATE_LIMIT_MS || RATE_LIMIT_MS <= 0) return true
  const now = Date.now()
  const rec = lastSendByEmail.get(email) || { ts: 0, hourStart: 0, hourCount: 0 }
  if (now - rec.ts < RATE_LIMIT_MS) return false
  if (now - rec.hourStart >= 60 * 60 * 1000) {
    rec.hourStart = now
    rec.hourCount = 0
  }
  if (rec.hourCount >= EMAIL_HOUR_LIMIT) return false
  rec.ts = now
  rec.hourCount += 1
  lastSendByEmail.set(email, rec)
  return true
}

// ============== Handlers ==============

async function handleSend(req, res, body) {
  const email = (body.email || '').trim().toLowerCase()
  if (!isValidEmail(email)) {
    return sendJson(res, 400, { error: 'invalid_email' }, req)
  }
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
  if (ip && !rateLimitIp(ip)) {
    return sendJson(res, 429, { error: 'too_many_requests_ip' }, req)
  }
  if (!rateLimitEmail(email)) {
    return sendJson(res, 429, { error: 'too_many_requests_email' }, req)
  }

  const code = genCode()
  const salt = genSalt()
  const codeHash = hashCode(code, salt)
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

  try {
    const ins = await rdb()
      .from('email_otps')
      .insert({
        email,
        code_hash: codeHash,
        salt,
        expires_at: expiresAt,
        attempts: 0,
        ip,
        created_at: new Date().toISOString(),
      })
    if (ins && ins.error) {
      console.error('[send] rdb.insert error:', JSON.stringify(ins.error))
      return sendJson(res, 500, { error: 'db_error', detail: ins.error.message || JSON.stringify(ins.error) }, req)
    }
  } catch (e) {
    console.error('[send] rdb.insert threw:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e.message || String(e) }, req)
  }

  try {
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;max-width:480px;margin:auto;padding:24px">
        <h2 style="color:#3FB87A;margin:0 0 16px">一寸光阴</h2>
        <p style="color:#1f2937;font-size:16px">您的登录验证码：</p>
        <div style="background:#F0FDF4;border:1px dashed #3FB87A;border-radius:8px;padding:24px;text-align:center;margin:16px 0">
          <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1f2937">${code}</span>
        </div>
        <p style="color:#6b7280;font-size:14px">验证码 10 分钟内有效。如非本人操作，请忽略此邮件。</p>
      </div>
    `
    const { data, error } = await resend.emails.send({
      from: MAIL_FROM,
      to: email,
      subject: MAIL_SUBJECT,
      html,
    })
    if (error) {
      console.error('[send] resend error:', error)
      return sendJson(res, 502, { error: 'mail_send_failed', detail: error.message || String(error) }, req)
    }
    return sendJson(res, 200, { ok: true, id: data?.id }, req)
  } catch (e) {
    console.error('[send] resend threw:', e)
    return sendJson(res, 500, { error: 'mail_send_failed', detail: e?.message || String(e) }, req)
  }
}

async function handleVerify(req, res, body) {
  const email = (body.email || '').trim().toLowerCase()
  const code = String(body.code || '').trim()
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid_email' }, req)
  if (!/^\d{6}$/.test(code)) return sendJson(res, 400, { error: 'invalid_code' }, req)

  const r = await verifyOtpAndConsume(email, code)
  if (!r.ok) return sendJson(res, r.status, { error: r.error }, req)

  const uid = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32)
  const role = isAdminEmail(email) ? 'admin' : 'user'
  const token = signJwt({ email, uid, role })

  return sendJson(res, 200, { ok: true, token, uid, email, role }, req)
}

// 密码登录：查 user_passwords → scrypt 比对 → 成功签与 /verify 完全相同的 JWT
// 安全点：未设密码 / 密码错 统一返回 invalid_credentials（防邮箱枚举）；失败 5 次锁 15 分钟
async function handleLogin(req, res, body) {
  const email = (body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid_email' }, req)
  if (!password) return sendJson(res, 400, { error: 'invalid_password' }, req)

  // 锁频检查（内存 Map；冷启动重置可接受）
  const lock = loginFails.get(email)
  if (lock && Date.now() - lock.lockedAt < LOGIN_LOCK_MS) {
    const retryAfterSec = Math.ceil((LOGIN_LOCK_MS - (Date.now() - lock.lockedAt)) / 1000)
    return sendJson(res, 429, { error: 'too_many_login_attempts', retryAfterSec }, req)
  }
  if (lock) loginFails.delete(email)

  let row = null
  try {
    const q = await rdb().from('user_passwords').select('*').eq('email', email).limit(1)
    if (q && q.error) throw new Error(q.error.message || JSON.stringify(q.error))
    row = Array.isArray(q.data) ? q.data[0] : q.data
  } catch (e) {
    console.error('[login] rdb.select error:', e)
    return sendJson(res, 500, { error: 'db_error' }, req)
  }

  const ok = !!row && verifyPassword(password, row.password_hash)
  if (!ok) {
    const cur = loginFails.get(email) || { count: 0, lockedAt: 0 }
    cur.count += 1
    if (cur.count >= LOGIN_FAIL_LIMIT) {
      cur.count = 0
      cur.lockedAt = Date.now()
    }
    loginFails.set(email, cur)
    return sendJson(res, 401, { error: 'invalid_credentials' }, req)
  }
  loginFails.delete(email)

  const uid = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32)
  const role = isAdminEmail(email) ? 'admin' : 'user'
  const token = signJwt({ email, uid, role })
  return sendJson(res, 200, { ok: true, token, uid, email, role }, req)
}

// 设置 / 修改 / 重置密码：必须先用 6 位验证码确认邮箱所有权（复用 OTP 限流）
// /set-password 与 /reset-password 共用（前端文案不同）
async function handleSetPassword(req, res, body) {
  const email = (body.email || '').trim().toLowerCase()
  const code = String(body.code || '').trim()
  const password = String(body.password || '')
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid_email' }, req)
  if (!/^\d{6}$/.test(code)) return sendJson(res, 400, { error: 'invalid_code' }, req)
  if (!isValidPassword(password)) return sendJson(res, 400, { error: 'weak_password' }, req)

  const r = await verifyOtpAndConsume(email, code)
  if (!r.ok) return sendJson(res, r.status, { error: r.error }, req)

  const hash = hashPassword(password)
  const now = new Date().toISOString()
  try {
    const q = await rdb().from('user_passwords').select('email').eq('email', email).limit(1)
    const exists = !!q && !q.error && (Array.isArray(q.data) ? q.data.length > 0 : !!q.data)
    if (exists) {
      const u = await rdb().from('user_passwords').update({ password_hash: hash, updated_at: now }).eq('email', email)
      if (u && u.error) throw new Error(u.error.message || JSON.stringify(u.error))
    } else {
      const ins = await rdb().from('user_passwords').insert({ email, password_hash: hash, created_at: now, updated_at: now })
      if (ins && ins.error) throw new Error(ins.error.message || JSON.stringify(ins.error))
    }
  } catch (e) {
    console.error('[set-password] rdb error:', e)
    return sendJson(res, 500, { error: 'db_error' }, req)
  }
  return sendJson(res, 200, { ok: true }, req)
}

// ============== SCF Event 入口（API 网关 SCF 类型路由）=============
//
// API 网关把 HTTP 请求以 { httpMethod, path, headers, body, queryString } 形式作为事件传入
// SCF Event 模式调 exports.main(event, context)
// 返回 { statusCode, headers, body } 给 API 网关作为 HTTP 响应
//
// 路由：API 网关(SCF) -> exports.main -> handle* 内部函数
//   /auth-otp/send   -> exports.main -> handleSend
//   /auth-otp/verify -> exports.main -> handleVerify
//   /auth-otp/health -> exports.main -> { ok: true }
//   /auth-otp (no sub) -> 404 not_found
exports.main = async (event, _context) => {
  const method = (event.httpMethod || 'GET').toUpperCase()
  // API 网关 SCF 路由 + enablePathTransmission: event.path 是完整路径（如 /auth-otp/send）
  // 不开透传: event.path 是 /auth-otp（被网关 strip 过的）
  const rawPath = (event.path || '/').split('?')[0]
  const segs = rawPath.split('/').filter(Boolean)
  // segs 可能是 ['auth-otp', 'send'] 或 ['auth-otp']
  // subPath 是子路径的最后一段
  const subPath = '/' + (segs[segs.length - 1] || '')

  // 解析 body
  let body = {}
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    try { body = raw ? JSON.parse(raw) : {} } catch { body = {} }
  }

  // 构造 fake req 让 handle* 内部函数能跑
  const headers = event.headers || {}
  const fakeReq = {
    headers: {
      ...headers,
      'x-forwarded-for': (headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '').split(',')[0].trim(),
    },
    socket: { remoteAddress: '' },
  }
  // 捕获 handle* 内部对 res 的写
  const captured = { status: 200, headers: JSON_HEADERS, body: '' }
  const fakeRes = {
    writeHead(s, h) { captured.status = s; if (h) captured.headers = { ...captured.headers, ...h } },
    end(b) { captured.body = b ?? '' },
  }
  const reply = (status, data) => ({ statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(data) })

  try {
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: CORS_BASE, body: '' }
    }

    if (subPath === '/health') {
      return reply(200, { ok: true, path: rawPath, subPath, method })
    }

    if (method === 'POST' && subPath === '/send') {
      await handleSend(fakeReq, fakeRes, body)
      return { statusCode: captured.status, headers: captured.headers, body: captured.body }
    }

    if (method === 'POST' && subPath === '/verify') {
      await handleVerify(fakeReq, fakeRes, body)
      return { statusCode: captured.status, headers: captured.headers, body: captured.body }
    }

    if (method === 'POST' && subPath === '/login') {
      await handleLogin(fakeReq, fakeRes, body)
      return { statusCode: captured.status, headers: captured.headers, body: captured.body }
    }

    if (method === 'POST' && (subPath === '/set-password' || subPath === '/reset-password')) {
      await handleSetPassword(fakeReq, fakeRes, body)
      return { statusCode: captured.status, headers: captured.headers, body: captured.body }
    }

    return reply(404, { error: 'not_found', path: rawPath, subPath, method })
  } catch (e) {
    console.error('[main] error:', e)
    return reply(500, { error: 'internal', detail: e?.message || String(e) })
  }
}

// 本地 tcb fn run 调试入口
if (require.main === module) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_BASE)
      return res.end()
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    try {
      if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true }, req)
      const body = await readJsonBody(req)
      if (req.method === 'POST' && url.pathname === '/send') return await handleSend(req, res, body)
      if (req.method === 'POST' && url.pathname === '/verify') return await handleVerify(req, res, body)
      if (req.method === 'POST' && url.pathname === '/login') return await handleLogin(req, res, body)
      if (req.method === 'POST' && (url.pathname === '/set-password' || url.pathname === '/reset-password')) {
        return await handleSetPassword(req, res, body)
      }
      return sendJson(res, 404, { error: 'not_found' }, req)
    } catch (e) {
      console.error('[server] handler error:', e)
      return sendJson(res, 500, { error: 'internal', detail: e?.message || String(e) }, req)
    }
  })
  server.listen(9000, () => console.log('[auth-otp] local dev on :9000'))
}
