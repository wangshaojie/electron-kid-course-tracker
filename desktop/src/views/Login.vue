<script setup lang="ts">
/**
 * Login.vue —— 登录页（密码为主，邮箱为辅）
 *
 * 主路径（密码 Tab，默认）：邮箱 + 密码 → /login
 * 辅路径（"其他方式"折叠区，验证码登录）：邮箱 → OTP → /verify（仅老用户应急，新用户走注册）
 * 注册：密码 Tab 底部"点此注册"链接 → RegisterDialog → 邮箱 + 密码 + OTP → /register
 * 忘记密码：密码 Tab 底部链接 → ForgotPasswordDialog → OTP → /reset-password
 *
 * 已登录用户的"修改密码"入口在 Settings.vue → PasswordStatusCard（必传旧密码）
 */
import { ref, computed, onUnmounted, reactive, type Ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { isValidEmail } from '@/utils/email'
import ForgotPasswordDialog from '@/components/account/ForgotPasswordDialog.vue'
import RegisterDialog from '@/components/account/RegisterDialog.vue'
import type { FormInstance } from 'element-plus'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

// 登录方式：otp=验证码（折叠）/ password=密码（默认）
const mode = ref<'otp' | 'password'>('password')
// 表单数据（reactive —— el-form :model 必须是对象）
// 两个 Tab 共享 email 字段，密码 / 验证码各自独立
const pwFormData = reactive({ email: auth.lastEmail, password: '' })
const otpFormData = reactive({ email: auth.lastEmail, code: '' })
const sending = ref(false)
const verifying = ref(false)
const cooldown = ref(0)
let cooldownTimer: number | null = null

// "保持登录 30 天"开关 —— 持久化偏好，关闭则只在本 tab 有效
const remember = ref(localStorage.getItem('auth.remember') !== '0')
function setRemember(v: boolean) {
  remember.value = v
  try {
    localStorage.setItem('auth.remember', v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const emailValid = computed(() => isValidEmail(pwFormData.email.trim()))
const canSend = computed(() => emailValid.value && !sending.value && cooldown.value === 0)
const pwLoggingIn = ref(false)
// 按钮 disabled 只看"是否正在请求"——格式校验交给 form rules（点提交时才校验并展示红字）
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
  // 1) 先做 form 校验（邮箱格式 / 验证码格式错误都给红字提示）
  if (!otpFormRef.value) return
  try {
    await otpFormRef.value.validate()
  } catch {
    return // 校验失败，el-form-item 已自动展示红字
  }
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
  // 1) 先做 form 校验（邮箱格式 / 密码强度错误都给红字提示）
  if (!pwFormRef.value) return
  try {
    await pwFormRef.value.validate()
  } catch {
    return // 校验失败，el-form-item 已自动展示红字
  }
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

// ---- 忘记密码 / 注册 弹窗入口（未登录用户也能用）----
const forgotOpen = ref(false)
const registerOpen = ref(false)
function openForgot() {
  forgotOpen.value = true
}
function openRegister() {
  registerOpen.value = true
}

// ---- 表单校验（邮箱格式不对给红字提示）----
const pwFormRef = ref<FormInstance | null>(null)
const otpFormRef = ref<FormInstance | null>(null)

const emailRules = [
  {
    required: true,
    validator: (_: unknown, val: string, cb: (err?: Error) => void) => {
      if (!val) return cb(new Error('请输入邮箱'))
      if (!isValidEmail(val.trim())) return cb(new Error('邮箱格式不正确，请检查后重新输入'))
      cb()
    },
    trigger: 'blur',
  },
]

const passwordRules = [
  {
    required: true,
    validator: (_: unknown, val: string, cb: (err?: Error) => void) => {
      if (!val) return cb(new Error('请输入密码'))
      if (val.length < 8 || !/[A-Za-z]/.test(val) || !/\d/.test(val)) {
        return cb(new Error('密码至少 8 位，需含字母和数字'))
      }
      cb()
    },
    trigger: 'blur',
  },
]

const codeRules = [
  {
    required: true,
    validator: (_: unknown, val: string, cb: (err?: Error) => void) => {
      if (!val) return cb(new Error('请输入验证码'))
      if (!/^\d{6}$/.test(val)) return cb(new Error('验证码为 6 位数字'))
      cb()
    },
    trigger: 'blur',
  },
]

/** 注册成功后自动跳首页（auth.bootstrap 已设 session，直接 replace） */
function onRegisterSuccess() {
  redirectAfterLogin('注册成功，已自动登录')
}

onUnmounted(() => {
  if (cooldownTimer !== null) window.clearInterval(cooldownTimer)
})
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="logo">📚</div>
        <h1>一寸光阴</h1>
        <p class="subtitle">家长自用的孩子课外培训班管理工具</p>
      </div>

      <el-tabs v-model="mode" class="login-tabs" stretch>
        <!-- 密码登录（默认 Tab） -->
        <el-tab-pane label="密码登录" name="password">
          <el-form
            ref="pwFormRef"
            :model="pwFormData"
            :rules="{ email: emailRules, password: passwordRules }"
            @submit.prevent="handlePasswordLogin"
            label-position="top"
            class="form"
          >
            <el-form-item label="邮箱" prop="email">
              <el-input
                v-model="pwFormData.email"
                type="email"
                placeholder="请输入邮箱"
                autocomplete="email"
                :clearable="true"
                :disabled="pwLoggingIn"
                @keyup.enter="handlePasswordLogin"
              />
            </el-form-item>

            <el-form-item label="密码" prop="password">
              <el-input
                v-model="pwFormData.password"
                type="password"
                placeholder="请输入密码"
                autocomplete="current-password"
                show-password
                :clearable="true"
                :disabled="pwLoggingIn"
                @keyup.enter="handlePasswordLogin"
              />
            </el-form-item>

            <el-button
              type="primary"
              size="large"
              :loading="pwLoggingIn"
              :disabled="!canPasswordLogin"
              class="submit"
              @click="handlePasswordLogin"
            >
              登录
            </el-button>
          </el-form>

          <div class="pw-extra">
            <el-button link type="primary" class="pw-toggle" @click="openForgot">
              忘记密码
            </el-button>
            <span class="pw-divider">·</span>
            <el-button link type="primary" class="pw-toggle" @click="openRegister">
              点此注册
            </el-button>
            <span class="pw-hint">需邮箱验证码</span>
          </div>
        </el-tab-pane>

        <!-- 验证码登录（折叠为"其他方式"） -->
        <el-tab-pane label="其他方式" name="otp">
          <p class="otp-hint">仅老用户应急 / 设备迁移使用。新用户请到密码 Tab 点"点此注册"。</p>
          <el-form
            ref="otpFormRef"
            :model="otpFormData"
            :rules="{ email: emailRules, code: codeRules }"
            @submit.prevent="handleSubmit"
            label-position="top"
            class="form"
          >
            <el-form-item label="邮箱" prop="email">
              <el-input
                v-model="otpFormData.email"
                type="email"
                placeholder="请输入邮箱"
                autocomplete="email"
                :clearable="true"
                :disabled="verifying"
                @keyup.enter="handleSubmit"
              />
            </el-form-item>

            <el-form-item label="验证码" prop="code">
              <div class="code-row">
                <el-input
                  v-model="otpFormData.code"
                  placeholder="6 位数字"
                  maxlength="6"
                  autocomplete="one-time-code"
                  :clearable="false"
                  :disabled="verifying"
                  class="code-input"
                  @keyup.enter="handleSubmit"
                />
                <el-button
                  :type="canSend ? 'primary' : 'default'"
                  :loading="sending"
                  :disabled="!canSend"
                  class="send-btn"
                  @click="handleSend"
                >
                  {{ cooldown > 0 ? `${cooldown}s 后重发` : '获取验证码' }}
                </el-button>
              </div>
            </el-form-item>

            <el-button
              type="primary"
              size="large"
              :loading="verifying"
              :disabled="!canSubmit"
              class="submit"
              @click="handleSubmit"
            >
              登录
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <!-- 忘记密码 + 注册 弹窗（共用 OTP 流程组件） -->
      <ForgotPasswordDialog v-model="forgotOpen" />
      <RegisterDialog v-model="registerOpen" @success="onRegisterSuccess" />

      <div class="remember-row">
        <el-checkbox v-model="remember" @change="(v: boolean | string | number) => setRemember(Boolean(v))">
          <span class="remember-text">保持登录 30 天</span>
        </el-checkbox>
        <span class="remember-hint">不勾则仅本次有效</span>
      </div>

      <p class="footer-hint">
        新用户请到密码 Tab 底部点"点此注册"，需邮箱 + 密码 + 验证码
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #F4FBF7 0%, #EAF8F0 100%);
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 16px;
  padding: 40px 32px 28px;
  box-shadow: 0 8px 32px rgba(63, 184, 122, 0.12);
}

.brand { text-align: center; margin-bottom: 20px; }
.brand .logo { font-size: 48px; margin-bottom: 8px; }
.brand h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; color: #1f2937; }
.brand .subtitle { margin: 0; color: #6b7280; font-size: 14px; }

.login-tabs { margin-bottom: 4px; }
.login-tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background-color: #e5e7eb; }
.login-tabs :deep(.el-tabs__item) { font-size: 14px; }

.form { margin-bottom: 12px; }
.code-row { display: flex; gap: 8px; width: 100%; }
.code-input { flex: 1; }
.send-btn { flex-shrink: 0; width: 130px; }

.submit { width: 100%; margin-top: 8px; font-size: 16px; font-weight: 500; }

.pw-extra {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 6px;
  padding: 0 2px;
}
.pw-toggle { padding: 0; font-size: 13px; }
.pw-divider { color: #d1d5db; font-size: 12px; user-select: none; }
.pw-hint { font-size: 11px; color: #9ca3af; margin-left: auto; }

.otp-hint {
  color: #6b7280;
  font-size: 12px;
  background: #FEF3C7;
  border: 1px solid #FDE68A;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 4px 0 12px;
}

.set-pw-steps { margin: 4px 0 20px; }
.set-pw-body { min-height: 260px; }
.set-pw-body .form :deep(.el-form-item) { margin-bottom: 14px; }
.set-pw-actions { display: flex; gap: 12px; margin-top: 8px; }
.set-pw-actions .submit { flex: 1; margin-top: 0; }
.pw-error { margin: -6px 0 10px; font-size: 12px; color: #f56c6c; }

.set-pw-steps { margin: 4px 0 20px; }
.set-pw-body { min-height: 260px; }
.set-pw-body .form :deep(.el-form-item) { margin-bottom: 14px; }
.set-pw-actions { display: flex; gap: 12px; margin-top: 8px; }
.set-pw-actions .submit { flex: 1; margin-top: 0; }
.pw-error { margin: -6px 0 10px; font-size: 12px; color: #f56c6c; }

.remember-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 0 2px;
}
.remember-text { font-size: 13px; color: #4b5563; }
.remember-hint { font-size: 11px; color: #9ca3af; }

.footer-hint { text-align: center; color: #9ca3af; font-size: 12px; margin: 12px 0 0; }
</style>
