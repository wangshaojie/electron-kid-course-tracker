/**
 * utils/email.ts —— 邮箱格式校验（RFC 5322 简化版，覆盖 99% 实际地址）
 */

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false
  return EMAIL_RE.test(email.trim())
}
