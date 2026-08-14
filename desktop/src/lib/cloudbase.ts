/**
 * lib/cloudbase.ts —— CloudBase SDK 初始化（自建 OTP + PG 模式）
 *
 * 关键点：
 *  - 自建 OTP 走 HTTP Function `auth-otp`（Resend 发邮件 + 我们的 PG 表存码 + 自签 JWT）
 *  - 业务数据走 `app.rdb().from(table)` —— 必须指定 schema = 'public'
 *  - 鉴权靠 `authJwt` 存到 localStorage（cloud function /verify 签发的）
 *  - CloudBase 自带的 `auth.signInWithOtp` 完全不用了
 *
 * 业务 store 直接 import 这里导出的 `app`、`db`、`authJwt`：
 *   - `app`：云函数调用（`app.callFunction`）和 rdb（`app.rdb`）
 *   - `db`：`app.rdb({ database: 'public' })`，业务 CRUD 入口
 *   - `authJwt`：自己签的 JWT，存到 localStorage；后续 PG 操作不需要再带（PG 用 secret key 走的 service role 路径）
 */

import cloudbase from '@cloudbase/js-sdk'

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID as string
const region = (import.meta.env.VITE_CLOUDBASE_REGION as string) || 'ap-shanghai'
const accessKey = import.meta.env.VITE_CLOUDBASE_ACCESS_KEY as string
const authOtpUrl = (import.meta.env.VITE_AUTH_OTP_URL as string) ||
  `https://${envId}.service.tcloudbase.com/auth-otp`

if (!envId) {
  throw new Error('VITE_CLOUDBASE_ENV_ID 未设置（.env.development）')
}
if (!accessKey || accessKey === '__FILL_PUBLISHABLE_KEY__') {
  console.warn('[cloudbase] VITE_CLOUDBASE_ACCESS_KEY 仍是占位符；现在因为我们走自建 JWT，business 数据走 cloud function，publishable key 仅供 SDK 初始化')
}

export const app = cloudbase.init({
  env: envId,
  region,
  accessKey,
})

/** rdb 必须指定 schema='public'，否则 PostgREST 报 PGRST106 */
export const db = app.rdb({ database: 'public' })

/** auth-otp HTTP function 根 URL */
export const AUTH_OTP_URL = authOtpUrl

// ==================== 自建 JWT ====================

const JWT_KEY = 'auth.jwt'
const USER_KEY = 'auth.user'
const UID_KEY = 'auth.uid'

export interface SessionUser {
  uid: string
  email: string
}

function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
function writeLS(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
function readSS<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
function writeSS(key: string, value: unknown) {
  try {
    if (value == null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

// 决定 session 存哪：localStorage（持久，30 天有效）or sessionStorage（关 tab 即失效）
function sessionStore(remember: boolean) {
  return remember ? {
    get: <T>(k: string) => readLS<T>(k),
    set: (k: string, v: unknown) => writeLS(k, v),
    del: (k: string) => { try { localStorage.removeItem(k) } catch {} },
  } : {
    get: <T>(k: string) => readSS<T>(k),
    set: (k: string, v: unknown) => writeSS(k, v),
    del: (k: string) => { try { sessionStorage.removeItem(k) } catch {} },
  }
}

/** 从 JWT payload 里读 exp（秒）。不解析签名（前端没必要做完整校验，只读到期时间） */
function readJwtExp(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    // base64url → base64
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')
    const json = atob(b64)
    const obj = JSON.parse(json) as { exp?: number }
    return typeof obj.exp === 'number' ? obj.exp : null
  } catch {
    return null
  }
}

/** 拿当前 JWT（自己签的），没登录或已过期返回 null */
export function getActiveJwt(): string | null {
  const t = localStorage.getItem(JWT_KEY) ?? sessionStorage.getItem(JWT_KEY)
  if (!t) return null
  const exp = readJwtExp(t)
  if (exp && exp * 1000 < Date.now()) {
    // 已过期，清理
    try { localStorage.removeItem(JWT_KEY); sessionStorage.removeItem(JWT_KEY) } catch {}
    return null
  }
  return t
}

/** 拿当前用户（按 JWT 来源 storage 找） */
export function getActiveUser(): SessionUser | null {
  return readLS<SessionUser>(USER_KEY) ?? readSS<SessionUser>(USER_KEY)
}

/** 拿当前用户 uid（写 PG 业务表 owner_id 用） */
export function getActiveUid(): string | null {
  return localStorage.getItem(UID_KEY) ?? sessionStorage.getItem(UID_KEY)
}

/** 写登录态（verify 成功时调）
 *  - remember=true  → localStorage（30 天免登录）
 *  - remember=false → sessionStorage（关 tab 即失效）
 * 同时把偏好写到 localStorage.auth.remember，下次自动按偏好选
 */
export function persistSession(token: string, user: SessionUser, remember: boolean) {
  const s = sessionStore(remember)
  s.set(JWT_KEY, token)
  s.set(USER_KEY, user)
  s.set(UID_KEY, user.uid)
  try {
    localStorage.setItem('auth.remember', remember ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** 清登录态（signOut 时调）—— 双清 */
export function clearSession() {
  for (const k of [JWT_KEY, USER_KEY, UID_KEY]) {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k) } catch {}
  }
}

// ==================== auth-otp HTTP 调用 ====================

type SendResult = { ok: true; id: string } | { ok: false; error: string }
type VerifyResult = { ok: true; token: string; uid: string; email: string } | { ok: false; error: string }

/**
 * 把后端 error code / HTTP 状态码翻译成中文文案
 * 后端 `auth-otp` 返回的 `error` 字段都是英文 enum + HTTP status
 * 前端要展示成用户能看懂的中文
 */
const OTP_ERROR_MAP: Record<string, string> = {
  // 邮箱相关
  invalid_email: '邮箱格式不正确，请检查后重新输入',
  // 限流（按 IP / 按邮箱）
  too_many_requests_ip: '当前网络下请求过于频繁，请稍后再试（每 60 秒最多 1 次）',
  too_many_requests_email: '该邮箱今天请求次数太多（每小时最多 5 次），请稍后再试',
  too_many_requests: '请求过于频繁，请稍后再试',
  // 验证码
  no_active_code: '没有可用的验证码，请重新获取',
  code_expired: '验证码已过期（10 分钟内有效），请重新获取',
  code_mismatch: '验证码错误，请检查后重新输入',
  too_many_attempts: '验证码错误次数太多，请重新获取',
  invalid_code: '验证码格式不正确（应为 6 位数字）',
  // 服务端
  mail_send_failed: '邮件发送失败，请稍后重试',
  db_error: '服务暂时不可用，请稍后重试',
  internal: '服务异常，请稍后重试',
  not_found: '请求路径不存在',
}

/**
 * 把后端 error / httpStatus 翻译成中文
 * 永远不返回后端原始英文，确保用户看到的是中文
 */
export function translateOtpError(rawError: string | null | undefined, httpStatus?: number): string {
  if (!rawError) {
    if (httpStatus === 429) return OTP_ERROR_MAP.too_many_requests!
    if (httpStatus && httpStatus >= 500) return OTP_ERROR_MAP.internal!
    if (httpStatus && httpStatus >= 400) return '请求失败，请检查输入后重试'
    return '操作失败，请稍后重试'
  }
  if (OTP_ERROR_MAP[rawError]) return OTP_ERROR_MAP[rawError]!
  // 兜底：http_xxx 形态
  const m = rawError.match(/^http_(\d{3})$/)
  if (m) {
    const code = Number(m[1])
    if (code === 429) return OTP_ERROR_MAP.too_many_requests!
    if (code >= 500) return OTP_ERROR_MAP.internal!
    if (code >= 400) return '请求失败，请检查输入后重试'
  }
  // 任何其他未知 code，统一兜底
  return '操作失败，请稍后重试'
}

export async function otpSend(email: string): Promise<SendResult> {
  let r: Response
  try {
    r = await fetch(`${AUTH_OTP_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  } catch (e) {
    return { ok: false, error: '网络连接失败，请检查网络后重试' }
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) {
    return { ok: false, error: translateOtpError(j.error, r.status) }
  }
  return { ok: true, id: j.id }
}

export async function otpVerify(email: string, code: string): Promise<VerifyResult> {
  let r: Response
  try {
    r = await fetch(`${AUTH_OTP_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
  } catch (e) {
    return { ok: false, error: '网络连接失败，请检查网络后重试' }
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) {
    return { ok: false, error: translateOtpError(j.error, r.status) }
  }
  return { ok: true, token: j.token, uid: j.uid, email: j.email }
}
