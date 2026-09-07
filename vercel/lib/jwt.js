/**
 * HS256 JWT 签 / 验
 * --------------------------------------------------------------
 * 沿用 CloudBase auth-otp 那套签名方式：
 *   - alg: HS256
 *   - payload: { email, uid, role, iat, exp }
 *   - uid: sha256(email).hex.slice(0, 32)
 *
 * 这样老用户 30 天 JWT 在新部署下仍然有效（Vercel Functions 用同一个 JWT_SECRET）。
 *
 * 用 jose 库（Vercel Edge / Node 都跑得了，jsonwebtoken 装在 Edge runtime 会爆）。
 */

import { SignJWT, jwtVerify } from 'jose'
import { createHash } from 'node:crypto'

const DEFAULT_TTL_SEC = 60 * 60 * 24 * 30 // 30 天

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) {
    throw new Error('JWT_SECRET is not set (must match auth-otp sign secret)')
  }
  return new TextEncoder().encode(s)
}

/** uid = sha256(email).hex.slice(0, 32) —— 与 CloudBase 端完全一致 */
export function uidOf(email) {
  return createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 32)
}

/**
 * 签 JWT
 * @param {{ email: string, uid?: string, role?: 'admin'|'user' }} payload
 * @param {number} [ttlSec]
 */
export async function signJwt(payload, ttlSec = DEFAULT_TTL_SEC) {
  const now = Math.floor(Date.now() / 1000)
  const email = String(payload.email).toLowerCase()
  const uid = payload.uid || uidOf(email)
  return new SignJWT({ email, uid, role: payload.role || 'user' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSec)
    .sign(getSecret())
}

/**
 * 验 JWT
 * @returns { ok: true, payload: { email, uid, role, iat, exp } } | { ok: false, error: string }
 */
export async function verifyJwt(token) {
  if (!token || typeof token !== 'string') return { ok: false, error: 'missing_token' }
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (!payload.email || !payload.uid) return { ok: false, error: 'invalid_token' }
    return { ok: true, payload }
  } catch (e) {
    return { ok: false, error: 'invalid_token', detail: e?.message || String(e) }
  }
}
