/**
 * lib/cloudbase.ts —— 自建 JWT + HTTP Function 入口
 *
 * ⚠️ 文件名沿用历史（cloudbase.ts），与腾讯 CloudBase 无关：
 * 自建 OTP/密码鉴权 + 业务读写都走两个自托管 HTTP Function（部署在 Vercel，
 * 底层 PG 是 Supabase）。这里只保留自建 JWT、OTP / 密码 / 业务 API 等 fetch 封装。
 *
 * 关键点：
 *  - 自建 OTP 走 HTTP Function `auth-otp`（Resend 发邮件 + 存验证码 + 自签 JWT）
 *  - 业务数据走 `businessApi` → `data-api` HTTP Function（服务端 owner_id 强制注入）
 *  - 鉴权靠自签 JWT 存到 localStorage / sessionStorage
 */

// 端点地址：Vercel 自托管 HTTP Function 根 URL（迁移后唯一主路径）
const authOtpUrl = import.meta.env.VITE_AUTH_OTP_URL as string
const dataApiUrl = import.meta.env.VITE_DATA_API_URL as string

/**
 * 接口地址自检（v0.5.28+）
 * --------------------------------------------------------------
 * 历史坑：这里原本是**模块顶层 throw**。一旦打包时这两个变量为空
 * （GitHub Actions 的 secret 被删 / 没配 → `${{ secrets.X }}` 解析成空串，
 * Vite 里 process.env 又会无条件覆盖 .env 文件），整个模块图在 import 阶段就炸，
 * Vue 根本 mount 不起来 → 用户只看到白屏。
 * 改成暴露检查函数，由 src/main.ts 在 mount 之前调用并渲染可读的错误页。
 */
export function getApiConfigError(): string | null {
  const missing: string[] = []
  if (!authOtpUrl) missing.push('VITE_AUTH_OTP_URL')
  if (!dataApiUrl) missing.push('VITE_DATA_API_URL')
  if (!missing.length) return null
  return `缺少接口地址配置：${missing.join(' 和 ')}`
}

/** auth-otp HTTP function 根 URL（业务 CRUD / 鉴权） */
export const AUTH_OTP_URL = authOtpUrl || ''

/** data-api HTTP function 根 URL（业务 CRUD） */
export const DATA_API_URL = dataApiUrl || ''

// ==================== 客户端元信息 ====================

/**
 * 网络请求超时（毫秒）
 * --------------------------------------------------------------
 * 之前所有 fetch 都没有超时：网络挂死（连上了但不下数据 / 代理黑洞）时
 * Promise 永不 settle → 界面永远停在 loading，用户只能杀进程。
 */
const FETCH_TIMEOUT_MS = 20_000

/** 幂等方法的最大额外重试次数 */
const MAX_RETRY = 2
/** 重试基础间隔（毫秒），逐次递增 */
const RETRY_BASE_MS = 600
/**
 * 可安全重试的 HTTP 方法（重复执行不会产生副作用）
 * ⚠️ POST 一律不重试，重试会造成实质性问题：
 *      /send    → 发两封验证码邮件 + 撞上 60 秒限流
 *      /verify  → 验证码已被消费，重试必然失败
 *      /login   → 密码错误时被后端重复计入失败次数（5 次就锁 15 分钟）
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PATCH', 'DELETE'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 带超时的单次 fetch */
function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

/**
 * 带超时 + 自动重试的 fetch
 * --------------------------------------------------------------
 * 为什么需要重试：跨域请求偶尔会被本机代理 / 网络瞬时掐断，Chromium 直接抛
 * `TypeError: Failed to fetch`（后端根本没收到这个请求）。原来一次失败就是
 * 永久失败，用户只能看着「网络连接失败」反复重登。
 * 实测日志：2026-10-23 13:54:03 应用启动时 3 个 data-api 请求全部 Failed to fetch，
 * 同一时刻 auth 登录也失败；后端 health 200 / CORS 正常，属瞬时链路抖动。
 */
async function fetchResilient(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase()
  const attempts = IDEMPOTENT_METHODS.has(method) ? MAX_RETRY + 1 : 1
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchWithTimeout(url, init)
    } catch (e) {
      lastErr = e
      const name = (e as { name?: string })?.name
      // 超时不重试：已经等了 20 秒，再等只会让用户等更久
      if (name === 'TimeoutError' || name === 'AbortError') throw e
      if (i < attempts - 1) await sleep(RETRY_BASE_MS * (i + 1))
    }
  }
  throw lastErr
}

/** 由错误信息推断网络故障，并给出可执行的下一步 */
function networkHintFromMessage(msg?: string): string {
  const m = String(msg || '')
  if (/timeout|timed out|aborted/i.test(m)) return '网络请求超时，请检查网络后重试'
  if (/failed to fetch|networkerror|load failed|connection refused|econnreset/i.test(m)) {
    // 这台机器开着系统代理（v2rayN/xray），代理规则没放行该域名时正是这个报错
    return '无法连接到服务器，请检查网络；若使用代理/VPN，需放行 api.240730.xyz'
  }
  return '网络连接失败，请检查网络后重试'
}

/** 统一网络错误文案（区分超时 / 离线 / 连接失败） */
function networkErrorText(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError') {
    return '网络请求超时，请检查网络后重试'
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return '网络未连接，请先联网后重试'
  }
  return networkHintFromMessage((e as { message?: string })?.message)
}

// App 启动时由 App.vue/auth.bootstrap 调用 refreshClientMeta()，从主进程读当前版本。
// 之后所有出口（dataApi / auth-otp fetch）自动带 X-Client-Version header。
// dev 模式 window.kidfs 不存在（preload 未挂载），自动回退到 ''。
let _appVersion = ''

/** App 启动时由 App.vue 调一次，从主进程读 package.json version（dev 也准） */
export async function refreshClientMeta() {
  try {
    const v = (await window.updater?.getAppVersion?.()) as string | undefined
    if (typeof v === 'string' && v) _appVersion = v
  } catch {
    /* 留空，header 不带 */
  }
}

/** 给 fetch headers 加 X-Client-Version（已加载就带，未加载就空串） */
function clientHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'X-Client-Version': _appVersion, ...(extra || {}) }
}

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

// ==================== 会话失效通知（token 过期 → 跳登录页）===================

/**
 * 会话失效回调注册
 * --------------------------------------------------------------
 * 之前 token 过期只做了一件事：getActiveJwt() 把 storage 里的 token 删掉。
 * 但 auth store 内存里的 token ref 还在，isAuthenticated 仍然是 true，
 * 界面停在业务页，只是所有请求 401 —— 用户看得见"数据没了"却找不到重新登录的入口，
 * 只能杀进程重开（而且重开还是过期，要再登一次）。
 *
 * 现在统一走这个回调：lib 层只负责"发现没 token 了"，
 * 具体怎么清登录态 / 怎么跳登录页由 auth store 决定（避免 lib ↔ store 循环依赖）。
 */
export type SessionExpiredHandler = (reason: 'token_expired' | 'no_active_jwt') => void
let _sessionExpiredHandler: SessionExpiredHandler | null = null

/** 注册会话失效回调（auth store 在创建时注册一次） */
export function onSessionExpired(cb: SessionExpiredHandler | null) {
  _sessionExpiredHandler = cb
}

function notifySessionExpired(reason: 'token_expired' | 'no_active_jwt') {
  try {
    _sessionExpiredHandler?.(reason)
  } catch (e) {
    console.warn('[auth] session expired handler failed', e)
  }
}

/** 拿当前 JWT（自己签的），没登录或已过期返回 null */
export function getActiveJwt(): string | null {
  const raw = localStorage.getItem(JWT_KEY) ?? sessionStorage.getItem(JWT_KEY)
  if (!raw) return null
  // persistSession 经 writeLS/writeSS 存储（JSON.stringify），需解包去掉引号；
  // 兼容历史直接 setItem 存原样的场景
  let t = raw
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') t = parsed
  } catch {
    /* raw 不是 JSON，原样使用 */
  }
  const exp = readJwtExp(t)
  if (exp && exp * 1000 < Date.now()) {
    // 已过期，清理
    try { localStorage.removeItem(JWT_KEY); sessionStorage.removeItem(JWT_KEY) } catch {}
    // 通知上层：登录态已失效 → 登出 + 回登录页（否则用户卡在空数据界面）
    notifySessionExpired('token_expired')
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
  const raw = localStorage.getItem(UID_KEY) ?? sessionStorage.getItem(UID_KEY)
  if (!raw) return null
  // ⚠️ 不能直接返回 raw：UID_KEY 是 writeLS 用 JSON.stringify 写进去的（带引号），
  //    raw 读出来是 '"abc"' 而不是 'abc'，与 getActiveUser().uid 不一致。
  //    兼容历史直接 setItem 存原样的场景（同 getActiveJwt 的处理方式）。
  let t = raw
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') t = parsed
  } catch {
    /* raw 不是 JSON，原样使用 */
  }
  return t || null
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
    // 「不记住我」：清掉 localStorage 里的旧副本。
    // 否则 getActiveJwt()（localStorage 优先）会读到上一次「记住我」留下的陈旧 token，
    // 导致改密 / 重新登录后仍用旧 token 发请求 → 401 invalid_token。
    if (!remember) {
      localStorage.removeItem(JWT_KEY)
      localStorage.removeItem(USER_KEY)
      localStorage.removeItem(UID_KEY)
    }
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
type VerifyResult = { ok: true; token: string; uid: string; email: string; role: 'admin' | 'user' } | { ok: false; error: string }

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
  too_many_verify_attempts: '验证码错误次数过多，请 15 分钟后再试，或重新获取验证码',
  invalid_code: '验证码格式不正确（应为 6 位数字）',
  // 网络
  network_error: '网络连接失败，请检查网络后重试',
  // 密码登录
  invalid_password: '密码格式不正确',
  weak_password: '密码强度不足（至少 8 位，需含字母和数字）',
  invalid_credentials: '邮箱或密码错误',
  too_many_login_attempts: '密码错误次数过多，已锁定 15 分钟，请稍后再试',
  // 已登录改密码
  wrong_old_password: '旧密码错误，请检查后重新输入',
  wrong_old_password_locked: '旧密码错误次数过多，已锁定 15 分钟，请稍后再试',
  same_as_old: '新密码不能与旧密码相同',
  password_not_set: '当前账号尚未设置密码，请使用"忘记密码"功能设置',
  // 注册
  email_already_registered: '该邮箱已注册，请直接登录或使用"忘记密码"重置',
  // 鉴权（Bearer）
  no_bearer: '请先登录后再操作',
  invalid_token: '登录状态已失效，请重新登录',
  token_expired: '登录状态已过期，请重新登录',
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
export function translateOtpError(
  rawError: string | null | undefined,
  httpStatus?: number,
  detail?: string,
): string {
  if (rawError === 'network_error') {
    // 网络层失败：给出可执行的下一步，而不是一句笼统的「稍后重试」
    return networkHintFromMessage(detail)
  }
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
    r = await fetchResilient(`${AUTH_OTP_URL}/send`, {
      method: 'POST',
      headers: clientHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email }),
    })
  } catch (e) {
    return { ok: false, error: networkErrorText(e) }
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) {
    return { ok: false, error: translateOtpError(j.error, r.status, j.detail) }
  }
  return { ok: true, id: j.id }
}

export async function otpVerify(email: string, code: string): Promise<VerifyResult> {
  let r: Response
  try {
    r = await fetchResilient(`${AUTH_OTP_URL}/verify`, {
      method: 'POST',
      headers: clientHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email, code }),
    })
  } catch (e) {
    return { ok: false, error: networkErrorText(e) }
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) {
    return { ok: false, error: translateOtpError(j.error, r.status, j.detail) }
  }
  return { ok: true, token: j.token, uid: j.uid, email: j.email, role: (j.role === 'admin' ? 'admin' : 'user') }
}

// ==================== 密码登录 / 设置密码（auth-otp） ====================

type PasswordLoginResult =
  | { ok: true; token: string; uid: string; email: string; role: 'admin' | 'user' }
  | { ok: false; error: string }
type PasswordSetResult = { ok: true } | { ok: false; error: string }

/** auth-otp POST 通用请求：网络错误 / 后端 error 统一走 translateOtpError 翻译成中文 */
async function postOtp(path: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  let r: Response
  try {
    r = await fetchResilient(`${AUTH_OTP_URL}${path}`, {
      method: 'POST',
      headers: clientHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
  } catch (e) {
    // ⚠️ 原始原因必须落日志：之前 auth 链路完全吞掉异常，
    //    界面上只有一句「网络连接失败」，无法区分「代理没放行 / DNS 挂了 / CORS 被拦」。
    console.warn('[auth-otp] network_error', path, (e as Error)?.message ?? String(e))
    return { status: 0, json: { error: 'network_error', detail: (e as Error)?.message ?? String(e) } }
  }
  const j = await r.json().catch(() => ({}))
  return { status: r.status, json: j }
}

/** 密码登录：成功返回与 /verify 完全相同的结构（token/uid/email/role） */
export async function passwordLogin(email: string, password: string): Promise<PasswordLoginResult> {
  const { status, json } = await postOtp('/login', { email, password })
  if (status >= 400 || json.error) {
    return { ok: false, error: translateOtpError(json.error, status, json.detail) }
  }
  return {
    ok: true,
    token: json.token,
    uid: json.uid,
    email: json.email,
    role: json.role === 'admin' ? 'admin' : 'user',
  }
}

/** 设置 / 修改密码（需 6 位验证码确认邮箱所有权；首次设置也走这里） */
export async function setPassword(email: string, code: string, password: string): Promise<PasswordSetResult> {
  const { status, json } = await postOtp('/set-password', { email, code, password })
  if (status >= 400 || json.error) {
    return { ok: false, error: translateOtpError(json.error, status, json.detail) }
  }
  return { ok: true }
}

/**
 * 已 verify 完设密（注册流程用）
 * - 走 /set-password 但带 Bearer JWT（已 verify 拿到的 token）
 * - 后端不消耗 OTP，body.email 必须与 JWT.email 一致
 * - 邮箱已注册 → 409 email_already_registered
 */
export async function setPasswordWithAuth(email: string, password: string): Promise<PasswordSetResult> {
  const { status, json } = await postOtpAuth('/set-password', { email, password })
  if (status >= 400 || json.error) {
    return { ok: false, error: translateOtpError(json.error, status, json.detail) }
  }
  return { ok: true }
}

/** 忘记密码重置（后端与 set-password 同逻辑，前端文案不同） */
export async function resetPassword(email: string, code: string, password: string): Promise<PasswordSetResult> {
  const { status, json } = await postOtp('/reset-password', { email, code, password })
  if (status >= 400 || json.error) {
    return { ok: false, error: translateOtpError(json.error, status, json.detail) }
  }
  return { ok: true }
}

// ==================== 注册（auth-otp /register）===================
// 注册即设密：OTP 验证邮箱所有权 + 写密码 + 签 JWT（一次走完）
// 成功返回与 /verify /login 完全一致（token/uid/email/role）
type RegisterResult =
  | { ok: true; token: string; uid: string; email: string; role: 'admin' | 'user' }
  | { ok: false; error: string }

export async function register(email: string, code: string, password: string): Promise<RegisterResult> {
  const { status, json } = await postOtp('/register', { email, code, password })
  if (status >= 400 || json.error) {
    return { ok: false, error: translateOtpError(json.error, status, json.detail) }
  }
  return {
    ok: true,
    token: json.token,
    uid: json.uid,
    email: json.email,
    role: json.role === 'admin' ? 'admin' : 'user',
  }
}

// ==================== 已登录改密码（auth-otp /change-password + /password-status）===================

type ChangePasswordResult =
  | { ok: true; token: string; uid: string; email: string; role: 'admin' | 'user' }
  | { ok: false; error: string }
type PasswordStatusResult =
  | { ok: true; has_password: boolean; updated_at: string | null }
  | { ok: false; error: string }

/** auth-otp 带 Bearer 的 POST（已登录改密码用） */
async function postOtpAuth(path: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const tok = getActiveJwt()
  if (!tok) {
    notifySessionExpired('no_active_jwt')
    return { status: 401, json: { error: 'no_bearer' } }
  }
  let r: Response
  try {
    r = await fetchResilient(`${AUTH_OTP_URL}${path}`, {
      method: 'POST',
      headers: clientHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }),
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.warn('[auth-otp] network_error', path, (e as Error)?.message ?? String(e))
    return { status: 0, json: { error: 'network_error', detail: (e as Error)?.message ?? String(e) } }
  }
  const j = await r.json().catch(() => ({}))
  return { status: r.status, json: j }
}

/** auth-otp 带 Bearer 的 GET（查询密码状态用） */
async function getOtpAuth(path: string): Promise<{ status: number; json: any }> {
  const tok = getActiveJwt()
  if (!tok) {
    notifySessionExpired('no_active_jwt')
    return { status: 401, json: { error: 'no_bearer' } }
  }
  let r: Response
  try {
    r = await fetchResilient(`${AUTH_OTP_URL}${path}`, {
      method: 'GET',
      headers: clientHeaders({ Authorization: `Bearer ${tok}` }),
    })
  } catch (e) {
    console.warn('[auth-otp] network_error', path, (e as Error)?.message ?? String(e))
    return { status: 0, json: { error: 'network_error', detail: (e as Error)?.message ?? String(e) } }
  }
  const j = await r.json().catch(() => ({}))
  return { status: r.status, json: j }
}

/**
 * 已登录用户修改密码（必传旧密码）
 * - 成功返回新签发的 JWT（自动 persistSession 替换）
 * - 失败返回中文错误
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const { status, json } = await postOtpAuth('/change-password', {
    old_password: oldPassword,
    new_password: newPassword,
  })
  if (status >= 400 || json.error) {
    return { ok: false, error: translateOtpError(json.error, status, json.detail) }
  }
  return {
    ok: true,
    token: json.token,
    uid: json.uid,
    email: json.email,
    role: json.role === 'admin' ? 'admin' : 'user',
  }
}

/**
 * 查询当前账号密码状态（需登录）
 * - has_password=false → 用户从未设过密码，应该走"忘记密码"或"首次设置"流程
 * - has_password=true + updated_at → 已设过，显示"上次修改 XX"
 */
export async function getPasswordStatus(): Promise<PasswordStatusResult> {
  const { status, json } = await getOtpAuth('/password-status')
  if (status >= 400 || json.error) {
    return { ok: false, error: translateOtpError(json.error, status, json.detail) }
  }
  return {
    ok: true,
    has_password: json.has_password === true,
    updated_at: typeof json.updated_at === 'string' ? json.updated_at : null,
  }
}

// ==================== data-api HTTP 调用（业务收口） ====================

export type DataApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; detail?: string }

/**
 * businessApi 抛出的错误对象
 * --------------------------------------------------------------
 * ⚠️ 之前 `throw new Error(translateDataApiError(...))` 只挂了中文文案，
 *    原始 error code / detail 全丢了 → theme.ts 的 _isRemoteColMissing()
 *    （靠 detail 里出现 "column ... does not exist" 判断"云端没这列"）变成死代码，
 *    「theme 列不存在 → 永久降级为只本地」这条兜底永远不触发。
 * 现在：message 给用户看（中文），code / status / detail 挂在对象上给诊断用。
 */
export interface BusinessApiError extends Error {
  /** 后端 error code（如 db_error / unknown_column / course_hours_exceeded） */
  code?: string
  /** HTTP 状态码 */
  status?: number
  /** 后端原始 detail（不进用户界面，只进 console） */
  detail?: string
}

/**
 * data-api 通用调用（GET/POST/PATCH/DELETE）
 * - 自动带 Authorization: Bearer <当前 JWT>
 * - 401/403/5xx 错误透传原文（业务 store 需要原文）
 */
export async function dataApi<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  subPath: string,
  body?: unknown,
): Promise<DataApiResult<T>> {
  const tok = getActiveJwt()
  if (!tok) {
    // 没有可用 JWT（未登录 或 token 已过期）→ 通知上层清理登录态并回登录页
    notifySessionExpired('no_active_jwt')
    return { ok: false, status: 401, error: 'no_active_jwt' }
  }
  let r: Response
  try {
    r = await fetchResilient(`${DATA_API_URL}${subPath}`, {
      method,
      headers: clientHeaders({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tok}`,
      }),
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
    })
  } catch (e) {
    return { ok: false, status: 0, error: 'network_error', detail: (e as Error)?.message ?? String(e) }
  }
  let j: any = {}
  try { j = await r.json() } catch { /* ignore */ }
  if (!r.ok || j.error) {
    return {
      ok: false,
      status: r.status,
      error: String(j.error || `http_${r.status}`),
      detail: typeof j.detail === 'string' ? j.detail : typeof j.message === 'string' ? j.message : undefined,
    }
  }
  return { ok: true, data: j as T }
}

/**
 * data-api 错误码 → 中文
 * ⚠️ 之前 businessApi 直接抛 `${r.error}: ${r.detail}`，用户看到的是
 *    "db_error: connection terminated unexpectedly" 这种英文 / PG 内部信息。
 *    现在统一翻译；detail 只进 console 便于排查，不进用户界面。
 */
const DATA_API_ERROR_MAP: Record<string, string> = {
  no_active_jwt: '登录状态已失效，请重新登录',
  invalid_token: '登录状态已失效，请重新登录',
  missing_authorization: '登录状态已失效，请重新登录',
  network_error: '网络连接失败，请检查网络后重试',
  unknown_table: '请求的数据不存在',
  bad_query: '查询参数不合法',
  not_found: '记录不存在或已被删除',
  method_not_allowed: '不支持的操作',
  empty_payload: '没有需要更新的内容',
  // 服务端字段不存在（PG 42703）→ 客户端据此判断"云端还没这列"（如 user_prefs.theme）
  unknown_column: '请求的字段不存在',
  // 累计课时超限（数据库触发器 enforce_course_hours_limit 抛的）
  course_hours_exceeded: '该课程剩余课时不足，不能再增加打卡',
  // 表级 CHECK 约束（金额/课时必须 > 0）
  check_violation: '数据不合法：金额、课时必须大于 0',
  db_error: '服务暂时不可用，请稍后重试',
  internal: '服务异常，请稍后重试',
}

export function translateDataApiError(rawError: string | null | undefined, detail?: string): string {
  if (detail) console.warn('[data-api]', rawError, detail)
  if (!rawError) return '操作失败，请稍后重试'
  if (rawError === 'network_error') {
    return networkHintFromMessage(detail)
  }
  if (DATA_API_ERROR_MAP[rawError]) {
    // PG 约束冲突（金额/课时必须 > 0 的 CHECK）给更具体的提示
    if (rawError === 'db_error' && detail && /check constraint|violates/i.test(detail)) {
      return '数据不合法：金额、课时必须大于 0'
    }
    return DATA_API_ERROR_MAP[rawError]!
  }
  return '操作失败，请稍后重试'
}

/**
 * 业务 API：失败直接 throw（store 保持现有 `throw error` 行为不变），
 * 成功返回后端响应体里的 data 载荷（即 { ok, data } 里的 data）
 *
 * ⚠️ 抛出的 Error 上必须挂 code / status / detail（见 BusinessApiError）：
 *    UI 用 message（中文），诊断逻辑（如 theme 列缺失判定）用 code / detail。
 */
export async function businessApi<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  subPath: string,
  body?: unknown,
): Promise<T> {
  const r = await dataApi<{ ok: true; data: T }>(method, subPath, body)
  if (!r.ok) {
    const err = new Error(translateDataApiError(r.error, r.detail)) as BusinessApiError
    err.code = r.error
    err.status = r.status
    err.detail = r.detail
    throw err
  }
  return r.data.data
}
