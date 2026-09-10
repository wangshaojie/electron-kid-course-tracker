/**
 * stores/auth.ts —— 鉴权 store（自建 JWT + Vercel HTTP Function `auth-otp`）
 *
 * 流程：
 *   1) sendCode(email)  → POST /auth-otp/send → Resend 发邮件
 *   2) verifyCode(email, code) → POST /auth-otp/verify → 自签 JWT → 存 localStorage
 *   3) bootstrap()       → 从 localStorage 恢复 session
 *   4) signOut()         → 清 localStorage
 *
 * session 持久化完全前端负责（localStorage），不依赖任何第三方 session。
 * 业务 PG 操作都走 Vercel HTTP Function（持有 Supabase service key），
 * 客户端只带自签 JWT；后端从 JWT 强制注入 owner_id，前端不可越权。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  otpSend,
  otpVerify,
  passwordLogin,
  setPassword as setPasswordApi,
  setPasswordWithAuth as setPasswordWithAuthApi,
  resetPassword as resetPasswordApi,
  changePassword as changePasswordApi,
  getPasswordStatus as getPasswordStatusApi,
  getActiveUser,
  getActiveJwt,
  persistSession,
  clearSession,
  type SessionUser,
} from '@/lib/cloudbase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null)
  const token = ref<string | null>(null)
  const status = ref<'idle' | 'bootstrapping' | 'authenticated' | 'unauthenticated'>('idle')
  const lastEmail = ref<string>(localStorage.getItem('auth.lastEmail') ?? '')
  /**
   * 账号切换触发器：每次成功 verify 都 +1
   * App.vue watch 它来强制重新加载业务数据（不管 isAuthenticated 是否经历 true→false→true）
   */
  const userRev = ref(0)

  const isAuthenticated = computed(() => status.value === 'authenticated' && !!user.value && !!token.value)

  function persistEmail(email: string) {
    lastEmail.value = email
    if (email) localStorage.setItem('auth.lastEmail', email)
  }

  async function bootstrap(): Promise<boolean> {
    status.value = 'bootstrapping'
    const t = getActiveJwt()
    const u = getActiveUser()
    if (t && u) {
      token.value = t
      user.value = u
      status.value = 'authenticated'
      return true
    }
    token.value = null
    user.value = null
    status.value = 'unauthenticated'
    return false
  }

  async function sendCode(email: string): Promise<{ error: string | null }> {
    const r = await otpSend(email)
    if (!r.ok) return { error: r.error }
    persistEmail(email)
    return { error: null }
  }

  async function verifyCode(
    email: string,
    code: string,
    remember: boolean = true,
  ): Promise<{ error: string | null }> {
    const r = await otpVerify(email, code)
    if (!r.ok) return { error: r.error }
    token.value = r.token
    user.value = { uid: r.uid, email: r.email }
    status.value = 'authenticated'
    userRev.value += 1
    persistSession(r.token, user.value, remember)
    persistEmail(email)
    return { error: null }
  }

  /** 密码登录：成功路径与 verifyCode 完全一致（存 token + userRev+1 触发业务重载） */
  async function loginWithPassword(
    email: string,
    password: string,
    remember: boolean = true,
  ): Promise<{ error: string | null }> {
    const r = await passwordLogin(email, password)
    if (!r.ok) return { error: r.error }
    token.value = r.token
    user.value = { uid: r.uid, email: r.email }
    status.value = 'authenticated'
    userRev.value += 1
    persistSession(r.token, user.value, remember)
    persistEmail(email)
    return { error: null }
  }

  /** 设置 / 修改密码（验证码确认邮箱所有权；首次设置也走这里） */
  async function setPassword(email: string, code: string, password: string): Promise<{ error: string | null }> {
    const r = await setPasswordApi(email, code, password)
    if (!r.ok) return { error: r.error }
    return { error: null }
  }

  /** 忘记密码重置（后端与 setPassword 同逻辑，前端文案不同） */
  async function resetPassword(email: string, code: string, password: string): Promise<{ error: string | null }> {
    const r = await resetPasswordApi(email, code, password)
    if (!r.ok) return { error: r.error }
    return { error: null }
  }

  /**
   * 注册（v0.4+：先验证邮箱，再设置密码，分两步走）
   *  - 第 1 步：POST /verify → 消费 OTP + 签 JWT（与 verifyCode 走同一条路径）
   *  - 第 2 步：POST /set-password 带 Bearer → 后端不消耗 OTP，email 校验，upsert 密码
   *  成功路径与 loginWithPassword 完全一致：存 token + userRev+1 触发业务重载
   *  失败语义：
   *    - 第 1 步失败：OTP 错 / 已用过 → 返回原错误
   *    - 第 2 步失败：邮箱已注册（409）/ 弱密码（400）/ 邮箱不匹配（403）
   *  副作用：第 1 步成功后 token 已经存进 store + persistSession，**即便第 2 步失败** session 也算登录
   *  设计取舍：第 1 步成功 = 邮箱所有权已确认；第 2 步失败最常见是"邮箱已注册"——
   *  这种情况下用户拿着 verify 拿到的 token 已经是合法登录态，UI 提示去登录页即可。
   */
  async function register(
    email: string,
    code: string,
    password: string,
    remember: boolean = true,
  ): Promise<{ error: string | null }> {
    // 防御性清洗 code：去掉空白/全角空格/全角数字 → 留 6 位半角数字
    // 原因：复制邮件验证码常带不可见字符（半角空格、thin space、全角数字 0-9），
    //       这些会让后端 /^\d{6}$/ 拒绝，但前端 step1 stepValid 校验可能已经通过
    const codeClean = String(code || '').replace(/[\s\u3000\uFF10-\uFF19]/g, (c) => {
      // 全角数字 0-9 (U+FF10-U+FF19) → 半角
      if (c >= '\uFF10' && c <= '\uFF19') return String(c.charCodeAt(0) - 0xFF10)
      // 空白类直接删除
      return ''
    })
    if (!/^\d{6}$/.test(codeClean)) {
      return { error: '验证码格式不正确（应为 6 位数字）' }
    }

    // 第 1 步：验证邮箱 + 拿 JWT
    const v = await otpVerify(email, codeClean)
    if (!v.ok) return { error: v.error }
    token.value = v.token
    user.value = { uid: v.uid, email: v.email }
    status.value = 'authenticated'
    userRev.value += 1
    persistSession(v.token, user.value, remember)
    persistEmail(email)

    // 第 2 步：带 Bearer 设密（不消耗 OTP）
    const s = await setPasswordWithAuthApi(email, password)
    if (!s.ok) {
      // 邮箱已注册（409）等情况：session 仍有效，让 UI 提示用户
      return { error: s.error }
    }
    return { error: null }
  }

  /**
   * 已登录用户修改密码（必传旧密码）
   * 成功 = 自动 persistSession 替换 token（30 天计时重置）
   * 失败 = 返回中文错误，session 保持不变
   */
  async function changePassword(
    oldPassword: string,
    newPassword: string,
    remember: boolean = true,
  ): Promise<{ error: string | null }> {
    const r = await changePasswordApi(oldPassword, newPassword)
    if (!r.ok) return { error: r.error }
    // 同步新 token + user（保持当前 session 不被打回 Login 页）
    token.value = r.token
    user.value = { uid: r.uid, email: r.email }
    status.value = 'authenticated'
    // 推断 remember 偏好（与登录保持一致）
    const pref = (() => {
      try {
        return localStorage.getItem('auth.remember') !== '0'
      } catch {
        return true
      }
    })()
    persistSession(r.token, user.value, remember ?? pref)
    return { error: null }
  }

  /**
   * 查询当前账号密码状态（has_password / updated_at）
   * 未登录时由后端返回 401 → 自动转中文
   */
  async function refreshPasswordStatus(): Promise<{
    has_password: boolean
    updated_at: string | null
    error: string | null
  }> {
    const r = await getPasswordStatusApi()
    if (!r.ok) return { has_password: false, updated_at: null, error: r.error }
    return { has_password: r.has_password, updated_at: r.updated_at, error: null }
  }

  async function signOut(): Promise<void> {
    // 关闭残留的长驻 Toast（如"当前账号下没有找到宝贝数据"），避免退出后还挂在屏幕上
    ElMessage.closeAll()
    token.value = null
    user.value = null
    status.value = 'unauthenticated'
    clearSession()
  }

  return {
    user,
    token,
    status,
    lastEmail,
    userRev,
    isAuthenticated,
    bootstrap,
    sendCode,
    verifyCode,
    loginWithPassword,
    setPassword,
    resetPassword,
    changePassword,
    refreshPasswordStatus,
    register,
    signOut,
  }
})
