/**
 * stores/auth.ts —— 鉴权 store（自建 JWT + CloudBase HTTP Function `auth-otp`）
 *
 * 流程：
 *   1) sendCode(email)  → POST /auth-otp/send → Resend 发邮件
 *   2) verifyCode(email, code) → POST /auth-otp/verify → 自签 JWT → 存 localStorage
 *   3) bootstrap()       → 从 localStorage 恢复 session
 *   4) signOut()         → 清 localStorage
 *
 * session 持久化完全前端负责（localStorage），不依赖任何 CloudBase session。
 * 业务 PG 操作走 cloud function（持有腾讯云永久密钥），不需要前端 JWT 参与。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  otpSend,
  otpVerify,
  passwordLogin,
  setPassword as setPasswordApi,
  resetPassword as resetPasswordApi,
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
    user.value = { uid: r.uid, email: r.email, role: r.role }
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
    user.value = { uid: r.uid, email: r.email, role: r.role }
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
    signOut,
  }
})
