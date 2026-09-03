<script setup lang="ts">
/**
 * Login.vue —— 登录页（暗色玻璃拟态版）
 *
 * 设计语言：
 *  - 暗色径向渐变背景 + 多色光晕（薄荷绿/暖橙/紫）
 *  - 半透明毛玻璃卡片 backdrop-blur
 *  - 自绘 SVG Logo（圆环 + 书 + 时钟指针）
 *  - 输入框：透明背景 + 白色描边，focus 时变薄荷绿
 *  - 主按钮：薄荷绿渐变 + 阴影 + hover 微缩放
 *  - 卡片入场有 fade+slide 动效
 *
 * 业务保持不变：
 *  - 主路径（密码 Tab，默认）：邮箱 + 密码 → /login
 *  - 辅路径（"其他方式" Tab，验证码登录）：邮箱 → OTP → /verify
 *  - 注册：密码 Tab 底部"点此注册"链接 → RegisterDialog
 *  - 忘记密码：密码 Tab 底部链接 → ForgotPasswordDialog
 */
import { ref, computed, onUnmounted, reactive, type Ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { isValidEmail } from '@/utils/email'
import ForgotPasswordDialog from '@/components/account/ForgotPasswordDialog.vue'
import RegisterDialog from '@/components/account/RegisterDialog.vue'
import BrandLogo from '@/components/brand/BrandLogo.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

// 登录方式：otp=验证码（折叠）/ password=密码（默认）
const mode = ref<'otp' | 'password'>('password')

// 表单数据
const pwFormData = reactive({ email: auth.lastEmail, password: '' })
const otpFormData = reactive({ email: auth.lastEmail, code: '' })

// 错误状态（自管理）
const pwErrors = reactive<{ email: string; password: string }>({ email: '', password: '' })
const otpErrors = reactive<{ email: string; code: string }>({ email: '', code: '' })

const sending = ref(false)
const verifying = ref(false)
const cooldown = ref(0)
let cooldownTimer: number | null = null

// "保持登录 30 天"开关 —— 持久化偏好
const remember = ref(localStorage.getItem('auth.remember') !== '0')
function setRemember(v: boolean) {
  remember.value = v
  try {
    localStorage.setItem('auth.remember', v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const emailValid = computed(() => isValidEmail(otpFormData.email.trim()))
const canSend = computed(() => emailValid.value && !sending.value && cooldown.value === 0)
const pwLoggingIn = ref(false)
const canPasswordLogin = computed(() => !pwLoggingIn.value)
const canSubmit = computed(() => !verifying.value)

function startCooldown(cd: Ref<number>, sec: number) {
  cd.value = sec
  if (cooldownTimer !== null) window.clearInterval(cooldownTimer)
  cooldownTimer = window.setInterval(() => {
    cd.value -= 1
    if (cd.value <= 0 && cooldownTimer !== null) {
      window.clearInterval(cooldownTimer)
      cooldownTimer = null
      cd.value = 0
    }
  }, 1000)
}

function redirectAfterLogin(msg: string) {
  ElMessage.success(msg)
  const redirect = (route.query.redirect as string) || '/'
  router.replace(redirect)
}

function validateEmail(val: string): string {
  if (!val) return '请输入邮箱'
  if (!isValidEmail(val.trim())) return '邮箱格式不正确，请检查后重新输入'
  return ''
}
function validatePassword(val: string): string {
  if (!val) return '请输入密码'
  if (val.length < 8 || !/[A-Za-z]/.test(val) || !/\d/.test(val)) {
    return '密码至少 8 位，需含字母和数字'
  }
  return ''
}
function validateCode(val: string): string {
  if (!val) return '请输入验证码'
  if (!/^\d{6}$/.test(val)) return '验证码为 6 位数字'
  return ''
}

async function handleSend() {
  if (!canSend.value) return
  sending.value = true
  try {
    const { error } = await auth.sendCode(otpFormData.email.trim())
    if (error) {
      ElMessage.error(`发送失败：${error}`)
      return
    }
    ElMessage.success('验证码已发送，请查收邮箱')
    startCooldown(cooldown, 60)
  } finally {
    sending.value = false
  }
}

async function handleSubmit() {
  otpErrors.email = validateEmail(otpFormData.email)
  otpErrors.code = validateCode(otpFormData.code)
  if (otpErrors.email || otpErrors.code) return
  if (!canSubmit.value) return
  verifying.value = true
  try {
    const r = await auth.verifyCode(otpFormData.email.trim(), otpFormData.code, remember.value)
    if (r.error) {
      ElMessage.error(`验证码错误：${r.error}`)
      otpFormData.code = ''
      return
    }
    redirectAfterLogin(remember.value ? '登录成功，30 天免登录' : '登录成功')
  } finally {
    verifying.value = false
  }
}

async function handlePasswordLogin() {
  pwErrors.email = validateEmail(pwFormData.email)
  pwErrors.password = validatePassword(pwFormData.password)
  if (pwErrors.email || pwErrors.password) return
  if (!canPasswordLogin.value) return
  pwLoggingIn.value = true
  try {
    const r = await auth.loginWithPassword(pwFormData.email.trim(), pwFormData.password, remember.value)
    if (r.error) {
      ElMessage.error(`登录失败：${r.error}`)
      return
    }
    redirectAfterLogin(remember.value ? '登录成功，30 天免登录' : '登录成功')
  } finally {
    pwLoggingIn.value = false
  }
}

// 输入时清错
function onPwEmailInput() { if (pwErrors.email) pwErrors.email = '' }
function onPwPwdInput() { if (pwErrors.password) pwErrors.password = '' }
function onOtpEmailInput() { if (otpErrors.email) otpErrors.email = '' }
function onOtpCodeInput() { if (otpErrors.code) otpErrors.code = '' }

// ---- 忘记密码 / 注册 弹窗入口 ----
const forgotOpen = ref(false)
const registerOpen = ref(false)
function openForgot() { forgotOpen.value = true }
function openRegister() { registerOpen.value = true }

/** 注册成功后自动跳首页 */
function onRegisterSuccess() {
  redirectAfterLogin('注册成功，已自动登录')
}

onUnmounted(() => {
  if (cooldownTimer !== null) window.clearInterval(cooldownTimer)
})
</script>

<template>
  <div class="login-page">
    <!-- 背景：深色径向渐变 + 3 个色光晕（CSS only，无图片） -->
    <div class="bg-aurora" aria-hidden="true">
      <div class="aurora aurora-1" />
      <div class="aurora aurora-2" />
      <div class="aurora aurora-3" />
      <!-- 噪点纹理（让暗色不"死"） -->
      <div class="bg-noise" />
    </div>

    <div class="login-card">
      <!-- 顶部品牌区 -->
      <div class="brand">
        <div class="logo-wrap">
          <div class="logo-glow" />
          <BrandLogo :size="72" />
        </div>
        <h1 class="brand-title">一寸光阴</h1>
        <p class="brand-subtitle">家长自用的孩子课外培训班管理工具</p>
      </div>

      <!-- 模式切换（segmented control 风格） -->
      <div class="segmented">
        <button
          type="button"
          class="segmented-item"
          :class="{ active: mode === 'password' }"
          @click="mode = 'password'"
        >
          <span>密码登录</span>
        </button>
        <button
          type="button"
          class="segmented-item"
          :class="{ active: mode === 'otp' }"
          @click="mode = 'otp'"
        >
          <span>其他方式</span>
        </button>
        <div class="segmented-thumb" :class="{ right: mode === 'otp' }" />
      </div>

      <!-- 表单切换 -->
      <transition name="form" mode="out-in">
        <!-- 密码登录表单 -->
        <form
          v-if="mode === 'password'"
          key="password"
          class="form"
          @submit.prevent="handlePasswordLogin"
        >
          <div class="field">
            <label class="field-label" for="pw-email">邮箱</label>
            <div class="field-input">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 7.5C3 6.12 4.12 5 5.5 5h13C19.88 5 21 6.12 21 7.5v9c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 19 3 17.88 3 16.5v-9z" stroke="currentColor" stroke-width="1.5" />
                <path d="M3 7l9 6 9-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <input
                id="pw-email"
                v-model="pwFormData.email"
                type="email"
                placeholder="请输入邮箱"
                autocomplete="email"
                :disabled="pwLoggingIn"
                @input="onPwEmailInput"
                @keyup.enter="handlePasswordLogin"
              />
            </div>
            <p v-if="pwErrors.email" class="field-error">{{ pwErrors.email }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="pw-password">密码</label>
            <div class="field-input">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.5" />
                <path d="M8 10V7a4 4 0 118 0v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                <circle cx="12" cy="15.5" r="1.5" fill="currentColor" />
              </svg>
              <input
                id="pw-password"
                v-model="pwFormData.password"
                type="password"
                placeholder="请输入密码"
                autocomplete="current-password"
                :disabled="pwLoggingIn"
                @input="onPwPwdInput"
                @keyup.enter="handlePasswordLogin"
              />
            </div>
            <p v-if="pwErrors.password" class="field-error">{{ pwErrors.password }}</p>
          </div>

          <button
            type="submit"
            class="btn-primary"
            :disabled="!canPasswordLogin"
            :class="{ loading: pwLoggingIn }"
          >
            <span v-if="!pwLoggingIn">登录</span>
            <span v-else class="btn-loading">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </span>
          </button>

          <div class="pw-extra">
            <button type="button" class="link" @click="openForgot">忘记密码</button>
            <span class="dot-sep" />
            <button type="button" class="link" @click="openRegister">点此注册</button>
            <span class="hint">需邮箱验证码</span>
          </div>
        </form>

        <!-- 验证码登录表单 -->
        <form
          v-else
          key="otp"
          class="form"
          @submit.prevent="handleSubmit"
        >
          <div class="otp-notice">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" />
              <path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            <span>仅老用户应急 / 设备迁移使用。新用户请切到「密码登录」点"点此注册"。</span>
          </div>

          <div class="field">
            <label class="field-label" for="otp-email">邮箱</label>
            <div class="field-input">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 7.5C3 6.12 4.12 5 5.5 5h13C19.88 5 21 6.12 21 7.5v9c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 19 3 17.88 3 16.5v-9z" stroke="currentColor" stroke-width="1.5" />
                <path d="M3 7l9 6 9-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <input
                id="otp-email"
                v-model="otpFormData.email"
                type="email"
                placeholder="请输入邮箱"
                autocomplete="email"
                :disabled="verifying"
                @input="onOtpEmailInput"
                @keyup.enter="handleSubmit"
              />
            </div>
            <p v-if="otpErrors.email" class="field-error">{{ otpErrors.email }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="otp-code">验证码</label>
            <div class="code-row">
              <div class="field-input code-input">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 8h14M5 12h14M5 16h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <input
                  id="otp-code"
                  v-model="otpFormData.code"
                  placeholder="6 位数字"
                  maxlength="6"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  :disabled="verifying"
                  @input="onOtpCodeInput"
                  @keyup.enter="handleSubmit"
                />
              </div>
              <button
                type="button"
                class="send-btn"
                :disabled="!canSend"
                :class="{ active: canSend }"
                @click="handleSend"
              >
                <span v-if="!sending">{{ cooldown > 0 ? `${cooldown}s` : '获取验证码' }}</span>
                <span v-else class="btn-loading">
                  <span class="dot" /><span class="dot" /><span class="dot" />
                </span>
              </button>
            </div>
            <p v-if="otpErrors.code" class="field-error">{{ otpErrors.code }}</p>
          </div>

          <button
            type="submit"
            class="btn-primary"
            :disabled="!canSubmit"
            :class="{ loading: verifying }"
          >
            <span v-if="!verifying">登录</span>
            <span v-else class="btn-loading">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </span>
          </button>
        </form>
      </transition>

      <!-- 保持登录 -->
      <label class="remember">
        <input
          type="checkbox"
          :checked="remember"
          @change="(e) => setRemember((e.target as HTMLInputElement).checked)"
        />
        <span class="checkbox-box">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="remember-text">保持登录 30 天</span>
        <span class="remember-hint">不勾则仅本次有效</span>
      </label>

      <p class="footer-hint">
        新用户请在「密码登录」Tab 底部点"点此注册"
      </p>
    </div>

    <!-- 忘记密码 + 注册 弹窗（共用 OTP 流程组件） -->
    <ForgotPasswordDialog v-model="forgotOpen" />
    <RegisterDialog v-model="registerOpen" @success="onRegisterSuccess" />
  </div>
</template>

<style scoped>
/* ============== 背景层 ============== */
.login-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: hidden;
  background: #0a0e1a;
  color: #fff;
  font-family: 'PingFang SC', 'Microsoft YaHei UI', system-ui, sans-serif;
}

.bg-aurora {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 20% 0%, #1a2742 0%, transparent 50%),
    radial-gradient(ellipse at 80% 100%, #1a2d2a 0%, transparent 50%),
    linear-gradient(180deg, #0a0e1a 0%, #0d1320 100%);
  z-index: 0;
}

.aurora {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.55;
  pointer-events: none;
}
.aurora-1 {
  width: 480px; height: 480px;
  background: radial-gradient(circle, #3FB87A 0%, transparent 70%);
  top: -120px; left: -120px;
  animation: float-1 18s ease-in-out infinite;
}
.aurora-2 {
  width: 420px; height: 420px;
  background: radial-gradient(circle, #E08A1E 0%, transparent 70%);
  bottom: -100px; right: -100px;
  opacity: 0.35;
  animation: float-2 22s ease-in-out infinite;
}
.aurora-3 {
  width: 360px; height: 360px;
  background: radial-gradient(circle, #6B5BFF 0%, transparent 70%);
  top: 30%; right: 20%;
  opacity: 0.28;
  animation: float-3 26s ease-in-out infinite;
}

@keyframes float-1 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(40px, 30px) scale(1.1); }
}
@keyframes float-2 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(-30px, -40px) scale(1.08); }
}
@keyframes float-3 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(30px, -30px) scale(0.95); }
}

/* 噪点纹理：内联 SVG，无外部资源 */
.bg-noise {
  position: absolute;
  inset: 0;
  opacity: 0.04;
  pointer-events: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>");
}

@media (prefers-reduced-motion: reduce) {
  .aurora { animation: none; }
}

/* ============== 玻璃卡片 ============== */
.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  padding: 36px 32px 28px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  box-shadow:
    0 24px 60px -20px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  animation: card-in 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes card-in {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ============== 品牌区 ============== */
.brand { text-align: center; margin-bottom: 24px; }

.logo-wrap {
  position: relative;
  display: inline-block;
  margin-bottom: 14px;
}

.logo-glow {
  position: absolute;
  inset: -20px;
  background: radial-gradient(circle, rgba(63, 184, 122, 0.4) 0%, transparent 60%);
  z-index: -1;
  filter: blur(8px);
}

.brand-title {
  margin: 0 0 6px;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #fff;
  background: linear-gradient(135deg, #fff 0%, #C5EFD5 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-subtitle {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.02em;
}

/* ============== Segmented Control ============== */
.segmented {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  padding: 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  margin-bottom: 24px;
}

.segmented-item {
  position: relative;
  z-index: 2;
  padding: 10px 0;
  background: transparent;
  border: 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.25s ease;
  font-family: inherit;
}
.segmented-item.active { color: #0a0e1a; }
.segmented-item:focus-visible { outline: 2px solid #3FB87A; outline-offset: 2px; border-radius: 8px; }

.segmented-thumb {
  position: absolute;
  top: 4px;
  left: 4px;
  width: calc(50% - 4px);
  height: calc(100% - 8px);
  background: linear-gradient(135deg, #5FCE89 0%, #3FB87A 100%);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(63, 184, 122, 0.35);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1;
}
.segmented-thumb.right { transform: translateX(100%); }

/* ============== 表单 ============== */
.form { display: flex; flex-direction: column; gap: 16px; }

.field { display: flex; flex-direction: column; gap: 6px; }

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.65);
  letter-spacing: 0.04em;
  padding-left: 2px;
}

.field-input {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.field-input:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
}

.field-input:focus-within {
  background: rgba(63, 184, 122, 0.08);
  border-color: #3FB87A;
  box-shadow: 0 0 0 4px rgba(63, 184, 122, 0.12);
}

.field-icon {
  width: 18px;
  height: 18px;
  margin-left: 14px;
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
  transition: color 0.2s ease;
}
.field-input:focus-within .field-icon { color: #5FCE89; }

.field-input input {
  flex: 1;
  padding: 13px 14px;
  background: transparent;
  border: 0;
  outline: 0;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  letter-spacing: 0.02em;
}
.field-input input::placeholder { color: rgba(255, 255, 255, 0.3); }
.field-input input:disabled { opacity: 0.5; cursor: not-allowed; }

.field-error {
  margin: 0;
  padding-left: 2px;
  font-size: 12px;
  color: #FF7A7A;
  letter-spacing: 0.02em;
  animation: error-in 0.2s ease;
}
@keyframes error-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ============== 验证码行 ============== */
.code-row { display: flex; gap: 8px; }
.code-input { flex: 1; }

.send-btn {
  flex-shrink: 0;
  min-width: 116px;
  padding: 0 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  font-weight: 500;
  cursor: not-allowed;
  transition: all 0.2s ease;
  font-family: inherit;
}
.send-btn.active {
  background: rgba(63, 184, 122, 0.12);
  border-color: rgba(63, 184, 122, 0.35);
  color: #5FCE89;
  cursor: pointer;
}
.send-btn.active:hover {
  background: rgba(63, 184, 122, 0.2);
  border-color: #3FB87A;
}

/* ============== 主按钮 ============== */
.btn-primary {
  position: relative;
  margin-top: 4px;
  padding: 14px 0;
  background: linear-gradient(135deg, #5FCE89 0%, #3FB87A 100%);
  border: 0;
  border-radius: 12px;
  color: #0a0e1a;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: 0.04em;
  cursor: pointer;
  overflow: hidden;
  box-shadow:
    0 6px 20px -4px rgba(63, 184, 122, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  transition: all 0.2s ease;
}
.btn-primary::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.3) 50%, transparent 70%);
  transform: translateX(-100%);
  transition: transform 0.6s ease;
}
.btn-primary:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow:
    0 10px 24px -4px rgba(63, 184, 122, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.btn-primary:not(:disabled):hover::after { transform: translateX(100%); }
.btn-primary:not(:disabled):active { transform: translateY(0); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

/* 加载态三点动画 */
.btn-loading {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
}
.btn-loading .dot {
  width: 6px; height: 6px;
  background: currentColor;
  border-radius: 50%;
  animation: dot-bounce 1.2s ease-in-out infinite;
}
.btn-loading .dot:nth-child(2) { animation-delay: 0.15s; }
.btn-loading .dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes dot-bounce {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
  40%           { transform: scale(1); opacity: 1; }
}

/* ============== 密码 Tab 额外链接 ============== */
.pw-extra {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 13px;
}

.link {
  background: none;
  border: 0;
  padding: 4px 2px;
  color: #5FCE89;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s ease;
  font-family: inherit;
}
.link:hover { color: #94DFB0; }
.link:focus-visible { outline: 2px solid #3FB87A; outline-offset: 2px; border-radius: 4px; }

.dot-sep { color: rgba(255, 255, 255, 0.2); font-size: 10px; user-select: none; }
.hint {
  margin-left: auto;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

/* ============== OTP 提示条 ============== */
.otp-notice {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  background: rgba(224, 138, 30, 0.08);
  border: 1px solid rgba(224, 138, 30, 0.2);
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 200, 140, 0.85);
}
.otp-notice svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; color: #FFB347; }

/* ============== 保持登录 ============== */
.remember {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  padding: 0 2px;
  cursor: pointer;
  user-select: none;
}
.remember input { display: none; }

.checkbox-box {
  width: 16px; height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: transparent;
  transition: all 0.15s ease;
}
.remember input:checked + .checkbox-box {
  background: linear-gradient(135deg, #5FCE89 0%, #3FB87A 100%);
  border-color: #3FB87A;
  color: #0a0e1a;
}
.checkbox-box svg { width: 12px; height: 12px; }

.remember-text { font-size: 13px; color: rgba(255, 255, 255, 0.75); }
.remember-hint { font-size: 11px; color: rgba(255, 255, 255, 0.3); margin-left: auto; }

/* ============== Footer ============== */
.footer-hint {
  text-align: center;
  margin: 16px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}

/* ============== 表单切换动画 ============== */
.form-enter-active,
.form-leave-active {
  transition: all 0.25s ease;
}
.form-enter-from {
  opacity: 0;
  transform: translateX(8px);
}
.form-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
