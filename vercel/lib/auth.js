/**
 * 鉴权 + CORS 通用工具
 * --------------------------------------------------------------
 *  - CORS：桌面端（Electron 渲染层 / Vite dev）跨域调用时浏览器会发 preflight，
 *    因此所有响应（含 OPTIONS 204）都必须带 Access-Control-Allow-Origin 等头。
 *  - requireAuth：从 Authorization: Bearer <jwt> 验签，返回 { email, uid }
 *  - requireAdmin：在 requireAuth 基础上 + email ∈ ADMIN_EMAILS（不信任 JWT 里的 role）
 *  - sendJson / readJsonBody：HTTP helper
 */

import { verifyJwt } from './jwt.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }

function adminEmailSet() {
  return new Set(
    String(process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function sendJson(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
  res.json(data)
}

/** OPTIONS 预检：返回 204 + CORS 头 */
export function preflight(res) {
  res.status(204)
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
  res.end()
}

export async function readJsonBody(req) {
  // Vercel Node runtime 默认对 application/json 做了 parse，req.body 已是对象
  if (req.body == null) return {}
  if (typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    if (!req.body) return {}
    try {
      return JSON.parse(req.body)
    } catch {
      throw new Error('Invalid JSON body')
    }
  }
  return {}
}

/** 异步版：登录即可访问 */
export async function requireAuthAsync(req, res) {
  const auth = String(req.headers?.authorization || req.headers?.Authorization || '')
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  if (!m) {
    sendJson(res, 401, { error: 'missing_authorization' })
    return null
  }
  const v = await verifyJwt(m[1])
  if (!v.ok) {
    sendJson(res, 401, { error: v.error, detail: v.detail })
    return null
  }
  const email = String(v.payload.email).toLowerCase()
  const uid = String(v.payload.uid)
  if (!uid) {
    sendJson(res, 401, { error: 'invalid_token', detail: 'missing uid in JWT' })
    return null
  }
  return { email, uid, role: v.payload.role || 'user' }
}

/** admin 路由：登录 + 现查 ADMIN_EMAILS 白名单 */
export async function requireAdminAsync(req, res) {
  const auth = await requireAuthAsync(req, res)
  if (!auth) return null
  if (!auth.email || !adminEmailSet().has(auth.email)) {
    sendJson(res, 403, { error: 'forbidden', message: 'not in ADMIN_EMAILS' })
    return null
  }
  return auth
}

export { JSON_HEADERS, CORS_HEADERS }
