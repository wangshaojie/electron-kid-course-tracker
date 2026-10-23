/**
 * /api/auth-otp/[action]
 * --------------------------------------------------------------
 * 取代 CloudBase auth-otp HTTP Function。
 *
 * 路由（Vercel Function 动态路由 [action].js）：
 *   POST  send              { email }                          → 生成 6 位码 + 写 PG + 调 Resend
 *   POST  verify            { email, code }                    → 校验 + 消耗 + 签 JWT
 *   POST  login             { email, password }                → 密码登录（scrypt 比对）
 *   POST  register          { email, code, password }          → 注册即设密（OTP 确认邮箱所有权）
 *   POST  set-password      { email, code, password }          → OTP 确认后 设置/修改 密码
 *   POST  reset-password    { email, code, password }          → 忘记密码重置（同 set-password 逻辑）
 *   POST  change-password   { old_password, new_password }     → 已登录用户改密（需 Bearer JWT）
 *   GET   password-status                                    → 查询密码状态（需 Bearer JWT）
 *   GET   health                                             → { ok: true }
 *
 * env:
 *   - DATABASE_URL          Supabase pooled connection string
 *   - JWT_SECRET            与 CloudBase auth-otp 完全一致
 *   - RESEND_API_KEY        Resend
 *   - MAIL_FROM             发件人（默认 onboarding@resend.dev）
 *   - MAIL_SUBJECT          邮件主题
 *   - OTP_RATE_LIMIT_MS     send 同 IP/邮箱最小间隔（默认 60000）
 *   - OTP_EMAIL_HOUR_LIMIT  send 单邮箱每小时上限（默认 5）
 */

import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { Resend } from 'resend'
import { getSql } from '../../lib/db.js'
import { signJwt, uidOf, verifyJwt } from '../../lib/jwt.js'
import { requireAuthAsync, sendJson, readJsonBody, preflight } from '../../lib/auth.js'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const MAIL_FROM = process.env.MAIL_FROM || 'onboarding@resend.dev'
const MAIL_SUBJECT = process.env.MAIL_SUBJECT || '【一寸光阴】您的登录验证码'

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null

// ============== 通用 ==============
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const isValidEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e.trim())

const PASSWORD_MIN_LEN = 8
const isValidPassword = (pw) =>
  typeof pw === 'string' && pw.length >= PASSWORD_MIN_LEN && /[A-Za-z]/.test(pw) && /\d/.test(pw)

const LOGIN_FAIL_LIMIT = 5
const LOGIN_LOCK_MS = 15 * 60 * 1000
// Vercel Function 进程级 Map：每个 cold start 重置，跨实例不共享（与 CloudBase 现状一致）
const loginFails = new Map()

// ============== 验证码校验（/verify）限流 ==============
// ⚠️ 之前 /verify 完全没有限流，后果有两层：
//   1. 5 次错码会把该邮箱**所有**未过期码的 attempts 一起 +1
//      → 连用户自己刚收到的那封验证码也判 too_many_attempts
//      → 等于远程把验证码通道烧死，用户只能干等（叠加 /send 的 60 秒限流，
//        实际体验是"登录/找回密码彻底不可用"）。
//   2. 没有任何 IP / 邮箱维度的节流 → 6 位码可被无限次在线爆破。
// 现在：邮箱级失败计数 + 锁定（防烧死）+ IP 级频次限制（防单机爆破）。
const VERIFY_FAIL_LIMIT = 5
const VERIFY_LOCK_MS = 15 * 60 * 1000
const VERIFY_IP_LIMIT = 30
const VERIFY_IP_WINDOW_MS = 10 * 60 * 1000
const verifyFails = new Map() // email → { count, lockedAt, lastAt }
const verifyIpHits = new Map() // ip → { count, windowStart }

function genCode() {
  // ⚠️ 不能用 Math.random()：不是密码学安全随机数，OTP 的安全性依赖它
  // crypto.randomInt 是 CSPRNG，且没有 modulo bias
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}
function genSalt() {
  return crypto.randomBytes(16).toString('hex')
}
function hashCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex')
}

/**
 * scrypt 哈希 / 校验（**异步**）
 * --------------------------------------------------------------
 * ⚠️ 之前用 crypto.scryptSync：N=16384 单次约 50-100ms 纯 CPU 占用，
 *    同步调用会把整个 Vercel 实例的事件循环卡死 —— 并发登录时
 *    health 检查、其它请求全部排队，看起来像"服务卡了"。
 *    改用 crypto.scrypt（线程池里跑），事件循环不被阻塞。
 *
 * ⚠️ 参数（N/r/p/长度）与老版本必须完全一致，否则老账号的哈希校验会失败。
 */
const scryptAsync = promisify(crypto.scrypt)

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const N = 16384
  const r = 8
  const p = 1
  const hash = await scryptAsync(password, salt, 64, { N, r, p })
  return `scrypt$${N}$${r}$${p}$${salt}$${hash.toString('hex')}`
}
async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$')
    if (parts[0] !== 'scrypt' || parts.length !== 6) return false
    const [, N, r, p, salt, hashHex] = parts
    const expected = Buffer.from(hashHex, 'hex')
    const actual = await scryptAsync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    })
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// 限流（同 CloudBase 现状：进程内 Map，cold start 重置可接受）
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

/**
 * 取客户端 IP
 * Vercel 平台会覆盖 X-Forwarded-For，外部无法伪造（已实测）
 */
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '')
    .split(',')[0]
    .trim()
}

/**
 * 密码猜测锁：检查当前是否处于锁定期
 * --------------------------------------------------------------
 * ⚠️ 原来的 bug（本次修复）：
 *   const lock = loginFails.get(email)
 *   if (lock && Date.now() - lock.lockedAt < LOGIN_LOCK_MS) { ...判锁... }
 *   if (lock) loginFails.delete(email)     ←←← 这里把计数一起删了
 * lockedAt=0（只是累计失败次数、从未锁定）时，Date.now()-0 远超 15 分钟
 * → 永远不判锁 → 接着把计数删掉 → count 永远停在 1，够不到 5 次
 * → "连续 5 次锁 15 分钟"完全失效，密码可无限次在线猜测（改密的旧密码同理）。
 *
 * 现在的语义：
 *   - lockedAt 有值且未过期 → 锁定中
 *   - lockedAt 有值但已过期 → 整条作废，重新开始
 *   - lockedAt 为 0（只是计数）→ 保留计数，继续累计
 */
function checkPasswordLock(email) {
  const rec = loginFails.get(email)
  if (!rec) return { locked: false }
  if (rec.lockedAt) {
    const elapsed = Date.now() - rec.lockedAt
    if (elapsed < LOGIN_LOCK_MS) {
      return { locked: true, retryAfterSec: Math.ceil((LOGIN_LOCK_MS - elapsed) / 1000) }
    }
    // 锁期已过 → 整条记录作废，重新计数
    loginFails.delete(email)
    return { locked: false }
  }
  return { locked: false }
}

/** 记录一次密码错误；达到上限则进入锁定期 */
function recordPasswordFailure(email) {
  const cur = loginFails.get(email) || { count: 0, lockedAt: 0, lastAt: 0 }
  cur.count += 1
  cur.lastAt = Date.now()
  if (cur.count >= LOGIN_FAIL_LIMIT) cur.lockedAt = Date.now()
  loginFails.set(email, cur)
}

/** 验证码失败锁（语义同 checkPasswordLock） */
function checkVerifyLock(email) {
  const rec = verifyFails.get(email)
  if (!rec) return { locked: false }
  if (rec.lockedAt) {
    const elapsed = Date.now() - rec.lockedAt
    if (elapsed < VERIFY_LOCK_MS) {
      return { locked: true, retryAfterSec: Math.ceil((VERIFY_LOCK_MS - elapsed) / 1000) }
    }
    verifyFails.delete(email)
    return { locked: false }
  }
  return { locked: false }
}

/** 记录一次验证码错误；达到上限则锁定该邮箱 15 分钟 */
function recordVerifyFailure(email) {
  const cur = verifyFails.get(email) || { count: 0, lockedAt: 0, lastAt: 0 }
  cur.count += 1
  cur.lastAt = Date.now()
  if (cur.count >= VERIFY_FAIL_LIMIT) cur.lockedAt = Date.now()
  verifyFails.set(email, cur)
}

/**
 * IP 级频次限制：窗口内超过上限 → 直接 429
 * 用来挡住"单机高频爆破"；邮箱级锁挡住"分布式针对某个账号"。
 */
function checkVerifyIp(ip) {
  if (!ip) return { blocked: false }
  const now = Date.now()
  const rec = verifyIpHits.get(ip) || { count: 0, windowStart: now }
  if (now - rec.windowStart >= VERIFY_IP_WINDOW_MS) {
    rec.count = 0
    rec.windowStart = now
  }
  rec.count += 1
  verifyIpHits.set(ip, rec)
  if (rec.count > VERIFY_IP_LIMIT) {
    return {
      blocked: true,
      retryAfterSec: Math.ceil((VERIFY_IP_WINDOW_MS - (now - rec.windowStart)) / 1000),
    }
  }
  return { blocked: false }
}

/**
 * 清理进程内 Map 的过期条目
 * --------------------------------------------------------------
 * lastSendByIp / lastSendByEmail / loginFails / verifyFails / verifyIpHits
 * 都是进程级 Map，原来只有"命中上限"才写、从不删除 → 长期运行的实例会无限膨胀。
 * 每次发码/登录/校验时顺手扫一遍，开销可忽略。
 */
function sweepInMemoryMaps() {
  const now = Date.now()
  // IP 限流：60 秒窗口外的条目没用了
  const ipCutoff = now - Math.max(RATE_LIMIT_MS, 60_000)
  for (const [ip, ts] of lastSendByIp) {
    if (ts < ipCutoff) lastSendByIp.delete(ip)
  }
  // 邮箱限流：小时窗口已过 + 60 秒间隔已过 → 条目可删（删掉等价于重置计数）
  for (const [email, rec] of lastSendByEmail) {
    if (now - rec.hourStart >= 60 * 60 * 1000 && now - rec.ts >= RATE_LIMIT_MS) {
      lastSendByEmail.delete(email)
    }
  }
  // 登录失败锁：锁定期已过 → 条目可删；
  // 只累计过次数、没锁定，且很久没动静 → 也可删（否则永远不清）
  for (const [email, rec] of loginFails) {
    if (rec.lockedAt && now - rec.lockedAt >= LOGIN_LOCK_MS) loginFails.delete(email)
    else if (!rec.lockedAt && rec.lastAt && now - rec.lastAt >= 60 * 60 * 1000) loginFails.delete(email)
  }
  // 验证码失败锁：同上
  for (const [email, rec] of verifyFails) {
    if (rec.lockedAt && now - rec.lockedAt >= VERIFY_LOCK_MS) verifyFails.delete(email)
    else if (!rec.lockedAt && rec.lastAt && now - rec.lastAt >= 60 * 60 * 1000) verifyFails.delete(email)
  }
  // IP 频次窗口过期 → 条目可删
  for (const [ip, rec] of verifyIpHits) {
    if (now - rec.windowStart >= VERIFY_IP_WINDOW_MS) verifyIpHits.delete(ip)
  }
}

// ============== 核心业务函数 ==============
async function verifyOtpAndConsume(email, code) {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT id, code_hash, salt, expires_at, attempts
        FROM email_otps
       WHERE email = ${email}
         AND consumed_at IS NULL
         AND expires_at >= now()
       ORDER BY created_at DESC
       LIMIT 10
    `
    if (!rows.length) return { ok: false, status: 401, error: 'no_active_code' }

    // 还有剩余尝试次数的码
    const usable = rows.filter((r) => (r.attempts || 0) < 5)
    if (!usable.length) return { ok: false, status: 401, error: 'too_many_attempts' }

    // ⚠️ 原来只比对最新一条（rows[0]）：用户拿到的是较早那封邮件的验证码
    //    （未过期、未使用）时也会报"验证码错误" → 改成遍历所有仍有效的码逐个比对。
    for (const row of usable) {
      if (hashCode(code, row.salt) === row.code_hash) {
        await sql`UPDATE email_otps SET consumed_at = now() WHERE id = ${row.id}`
        return { ok: true }
      }
    }

    // 全部不匹配 → 只给**最新那个码**的失败次数 +1
    // ⚠️ 原来是把该邮箱所有有效码一起 +1（WHERE id IN (...)）：
    //    用户手滑输错一次，就把自己所有还没用的验证码全部烧死
    //    （连用户自己刚收到的那封都判 too_many_attempts）。
    //    现在只惩罚最新码：更早那封仍可用（上面已支持多码比对），
    //    防爆破的主闸交给 handleVerify 的邮箱级失败计数。
    await sql`UPDATE email_otps SET attempts = attempts + 1 WHERE id = ${usable[0].id}`
    return { ok: false, status: 401, error: 'code_mismatch' }
  } catch (e) {
    console.error('[otp] db error:', e)
    return { ok: false, status: 500, error: 'db_error', detail: e?.message || String(e) }
  }
}

// ============== handlers ==============
async function handleSend(req, res, body) {
  const email = String(body.email || '').trim().toLowerCase()
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid_email' })
  sweepInMemoryMaps()
  const ip = clientIp(req)
  if (ip && !rateLimitIp(ip)) return sendJson(res, 429, { error: 'too_many_requests_ip' })
  if (!rateLimitEmail(email)) return sendJson(res, 429, { error: 'too_many_requests_email' })

  const code = genCode()
  const salt = genSalt()
  const codeHash = hashCode(code, salt)
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

  try {
    const sql = getSql()
    await sql`
      INSERT INTO email_otps (email, code_hash, salt, expires_at, attempts, ip, created_at)
      VALUES (${email}, ${codeHash}, ${salt}, ${expiresAt}, 0, ${ip || null}, now())
    `
  } catch (e) {
    console.error('[send] insert error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }

  // 清理过期/已消费的旧码：email_otps 表没有清理任务，不清会无限膨胀
  // （单次最多删 500 行，避免大表全表扫描拖慢请求）
  // ⚠️ 清理失败**不能**影响发码：码已经入库了，此时返回 500 会让用户收不到邮件，
  //    且留下一条无人知晓的有效码（还能被 verify 用掉）。所以单独兜住，失败只记日志。
  try {
    const sql = getSql()
    await sql`
      DELETE FROM email_otps
       WHERE id IN (
         SELECT id FROM email_otps
          WHERE expires_at < now() - interval '1 day'
          LIMIT 500
       )
    `
  } catch (e) {
    console.warn('[send] cleanup old otps failed (ignored):', e?.message || String(e))
  }

  if (!resend) {
    return sendJson(res, 500, { error: 'mail_not_configured', detail: 'RESEND_API_KEY not set' })
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
      return sendJson(res, 502, { error: 'mail_send_failed', detail: error.message || String(error) })
    }
    return sendJson(res, 200, { ok: true, id: data?.id })
  } catch (e) {
    console.error('[send] resend threw:', e)
    return sendJson(res, 500, { error: 'mail_send_failed', detail: e?.message || String(e) })
  }
}

async function handleVerify(req, res, body) {
  const email = String(body.email || '').trim().toLowerCase()
  const code = String(body.code || '').trim()
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid_email' })
  if (!/^\d{6}$/.test(code)) return sendJson(res, 400, { error: 'invalid_code' })
  sweepInMemoryMaps()

  // IP 级：挡单机高频爆破
  const ipCheck = checkVerifyIp(clientIp(req))
  if (ipCheck.blocked) {
    return sendJson(res, 429, {
      error: 'too_many_verify_attempts',
      retryAfterSec: ipCheck.retryAfterSec,
    })
  }
  // 邮箱级：挡分布式针对某个账号的爆破，同时防止"远程烧死验证码通道"
  const lock = checkVerifyLock(email)
  if (lock.locked) {
    return sendJson(res, 429, {
      error: 'too_many_verify_attempts',
      retryAfterSec: lock.retryAfterSec,
    })
  }

  const r = await verifyOtpAndConsume(email, code)
  if (!r.ok) {
    // 错码 / 没有有效码都计一次失败：
    //   code_mismatch    → 防止 6 位码被爆破
    //   no_active_code   → 防止拿 /verify 探测"某邮箱有没有在等验证码"
    if (r.error === 'code_mismatch' || r.error === 'no_active_code') {
      recordVerifyFailure(email)
    }
    return sendJson(res, r.status, { error: r.error, detail: r.detail })
  }
  // 验证成功 → 清空该邮箱的失败计数
  verifyFails.delete(email)

  const uid = uidOf(email)
  const token = await signJwt({ email, uid })
  return sendJson(res, 200, { ok: true, token, uid, email })
}

async function handleLogin(req, res, body) {
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid_email' })
  if (!password) return sendJson(res, 400, { error: 'invalid_password' })
  sweepInMemoryMaps()

  const lock = checkPasswordLock(email)
  if (lock.locked) {
    return sendJson(res, 429, { error: 'too_many_login_attempts', retryAfterSec: lock.retryAfterSec })
  }

  let row = null
  try {
    const sql = getSql()
    const rows = await sql`SELECT password_hash FROM user_passwords WHERE email = ${email} LIMIT 1`
    row = rows[0] || null
  } catch (e) {
    console.error('[login] select error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }

  const ok = !!row && (await verifyPassword(password, row.password_hash))
  if (!ok) {
    recordPasswordFailure(email)
    return sendJson(res, 401, { error: 'invalid_credentials' })
  }
  loginFails.delete(email)

  const uid = uidOf(email)
  const token = await signJwt({ email, uid })
  return sendJson(res, 200, { ok: true, token, uid, email })
}

async function handleRegister(req, res, body) {
  const email = String(body.email || '').trim().toLowerCase()
  const code = String(body.code || '').trim()
  const password = String(body.password || '')
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid_email' })
  if (!/^\d{6}$/.test(code)) return sendJson(res, 400, { error: 'invalid_code' })
  if (!isValidPassword(password)) return sendJson(res, 400, { error: 'weak_password' })

  // 1) 校验 OTP
  const r = await verifyOtpAndConsume(email, code)
  if (!r.ok) return sendJson(res, r.status, { error: r.error, detail: r.detail })

  // 2) 邮箱是否已注册
  const sql = getSql()
  try {
    const existing = await sql`SELECT email FROM user_passwords WHERE email = ${email} LIMIT 1`
    if (existing.length) {
      return sendJson(res, 409, { error: 'email_already_registered' })
    }
  } catch (e) {
    console.error('[register] select error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }

  // 3) 写密码
  const hash = await hashPassword(password)
  try {
    await sql`
      INSERT INTO user_passwords (email, password_hash, created_at, updated_at)
      VALUES (${email}, ${hash}, now(), now())
    `
  } catch (e) {
    console.error('[register] insert error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }

  // 4) 签 JWT（与 /verify / /login 完全一致）
  const uid = uidOf(email)
  const token = await signJwt({ email, uid })
  return sendJson(res, 200, { ok: true, token, uid, email })
}

// 设置 / 修改 / 重置密码：两条入口
//   1) Bearer 路径（v0.4+）：已通过 /verify 拿到 JWT，可直接写密码，免输第二遍码
//      - 用途：注册流程（verify → set-password-with-bearer）一步走完
//      - 校验：JWT 有效 + body.email 与 JWT.email 一致（防 A 拿 token 给 B 设密）
//      - 注册场景必须先 check 邮箱未注册 → 409 email_already_registered
//   2) OTP 路径（v0.3）：6 位验证码确认邮箱所有权（复用 OTP 限流）
//      - 用途：ForgotPasswordDialog、首次设置密码（无 session）
// /set-password 与 /reset-password 共用
async function handleSetPassword(req, res, body) {
  const password = String(body.password || '')
  if (!isValidPassword(password)) return sendJson(res, 400, { error: 'weak_password' })

  // 软验 Bearer：有就尝试 Bearer 路径，失败回落到 OTP 路径
  const auth = String(req.headers?.authorization || req.headers?.Authorization || '')
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  if (m) {
    const v = await verifyJwt(m[1])
    if (v.ok) {
      const tokenEmail = String(v.payload.email).toLowerCase()
      const bodyEmail = String(body.email || '').trim().toLowerCase()
      if (!isValidEmail(bodyEmail)) return sendJson(res, 400, { error: 'invalid_email' })
      if (bodyEmail !== tokenEmail) {
        return sendJson(res, 403, { error: 'email_mismatch' })
      }
      // 注册场景：邮箱已注册 = 409（沿用 /register 语义）
      try {
        const sql = getSql()
        const existing = await sql`SELECT email FROM user_passwords WHERE email = ${tokenEmail} LIMIT 1`
        if (existing.length) {
          return sendJson(res, 409, { error: 'email_already_registered' })
        }
      } catch (e) {
        console.error('[set-password:bearer] select error:', e)
        return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
      }
      return await writePasswordUpsert(res, tokenEmail, password)
    }
    // Bearer 无效（过期/伪造）→ 静默回落到 OTP 路径
  }

  // OTP 路径（v0.3 兼容）：ForgotPasswordDialog、首次设置密码
  const email = String(body.email || '').trim().toLowerCase()
  const code = String(body.code || '').trim()
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'invalid_email' })
  if (!/^\d{6}$/.test(code)) return sendJson(res, 400, { error: 'invalid_code' })

  const r = await verifyOtpAndConsume(email, code)
  if (!r.ok) return sendJson(res, r.status, { error: r.error, detail: r.detail })

  return await writePasswordUpsert(res, email, password)
}

// 写密码（upsert user_passwords）—— Bearer / OTP 两条路径共用
async function writePasswordUpsert(res, email, password) {
  const hash = await hashPassword(password)
  try {
    const sql = getSql()
    await sql`
      INSERT INTO user_passwords (email, password_hash, created_at, updated_at)
      VALUES (${email}, ${hash}, now(), now())
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            updated_at = now()
    `
  } catch (e) {
    console.error('[set-password] upsert error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }
  return sendJson(res, 200, { ok: true })
}

async function handleChangePassword(req, res, body) {
  const auth = await requireAuthAsync(req, res)
  if (!auth) return
  const email = auth.email
  const oldPassword = String(body.old_password || '')
  const newPassword = String(body.new_password || '')
  if (!oldPassword) return sendJson(res, 400, { error: 'invalid_password' })
  if (!isValidPassword(newPassword)) return sendJson(res, 400, { error: 'weak_password' })
  if (oldPassword === newPassword) return sendJson(res, 400, { error: 'same_as_old' })

  const lock = checkPasswordLock(email)
  if (lock.locked) {
    return sendJson(res, 429, { error: 'wrong_old_password_locked', retryAfterSec: lock.retryAfterSec })
  }

  let row = null
  try {
    const sql = getSql()
    const rows = await sql`SELECT password_hash FROM user_passwords WHERE email = ${email} LIMIT 1`
    row = rows[0] || null
  } catch (e) {
    console.error('[change-password] select error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }
  if (!row) return sendJson(res, 400, { error: 'password_not_set' })

  const ok = await verifyPassword(oldPassword, row.password_hash)
  if (!ok) {
    recordPasswordFailure(email)
    return sendJson(res, 401, { error: 'wrong_old_password' })
  }
  loginFails.delete(email)

  const hash = await hashPassword(newPassword)
  try {
    const sql = getSql()
    await sql`UPDATE user_passwords SET password_hash = ${hash}, updated_at = now() WHERE email = ${email}`
  } catch (e) {
    console.error('[change-password] update error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }

  const token = await signJwt({ email, uid: auth.uid })
  return sendJson(res, 200, { ok: true, token, uid: auth.uid, email })
}

async function handlePasswordStatus(req, res) {
  const auth = await requireAuthAsync(req, res)
  if (!auth) return
  try {
    const sql = getSql()
    const rows = await sql`SELECT updated_at FROM user_passwords WHERE email = ${auth.email} LIMIT 1`
    const row = rows[0] || null
    return sendJson(res, 200, {
      ok: true,
      has_password: !!row,
      updated_at: row?.updated_at || null,
    })
  } catch (e) {
    console.error('[password-status] select error:', e)
    return sendJson(res, 500, { error: 'db_error', detail: e?.message || String(e) })
  }
}

function handleHealth(req, res) {
  return sendJson(res, 200, {
    ok: true,
    ts: new Date().toISOString(),
  })
}

// ============== 入口 ==============
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    preflight(res)
    return
  }
  const action = String(req.query.action || '').toLowerCase()
  try {
    if (action === 'health' && req.method === 'GET') return handleHealth(req, res)

    if (action === 'send' && req.method === 'POST') {
      const body = await readJsonBody(req)
      return await handleSend(req, res, body)
    }
    if (action === 'verify' && req.method === 'POST') {
      const body = await readJsonBody(req)
      return await handleVerify(req, res, body)
    }
    if (action === 'login' && req.method === 'POST') {
      const body = await readJsonBody(req)
      return await handleLogin(req, res, body)
    }
    if (action === 'register' && req.method === 'POST') {
      const body = await readJsonBody(req)
      return await handleRegister(req, res, body)
    }
    if ((action === 'set-password' || action === 'reset-password') && req.method === 'POST') {
      const body = await readJsonBody(req)
      return await handleSetPassword(req, res, body)
    }
    if (action === 'change-password' && req.method === 'POST') {
      const body = await readJsonBody(req)
      return await handleChangePassword(req, res, body)
    }
    if (action === 'password-status' && req.method === 'GET') {
      return await handlePasswordStatus(req, res)
    }

    return sendJson(res, 404, { error: 'not_found', detail: `action=${action} method=${req.method}` })
  } catch (e) {
    console.error('[auth-otp] uncaught error:', e)
    return sendJson(res, 500, { error: 'internal', detail: e?.message || String(e) })
  }
}
