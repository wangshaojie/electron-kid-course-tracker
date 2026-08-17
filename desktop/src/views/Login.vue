<script setup lang="ts">
/**
 * Login.vue —— 登录页（双方式：验证码登录 + 密码登录）
 *
 * 验证码登录：邮箱 → 获取验证码（auth-otp /send 发邮件）→ 输 6 位码 → /verify 自动登录
 * 密码登录：邮箱 + 密码 → /login 登录（未设密码的用户需先用验证码登录后在下方"设置/修改密码"设置）
 * 设置/修改密码：验证码确认邮箱所有权 → /set-password 写入 scrypt 哈希
 */
import { ref, computed, onUnmounted, type Ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { isValidEmail } from '@/utils/email'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

// 登录方式：otp=验证码 / password=密码
const mode = ref<'otp' | 'password'>('otp')
const email = ref(auth.lastEmail)
const code = ref('')
const password = ref('')
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

const emailValid = computed(() => isValidEmail(email.value.trim()))
const codeValid = computed(() => /^\d{6}$/.test(code.value))
const passwordValid = computed(
  () => password.value.length >= 8 && /[A-Za-z]/.test(password.value) && /\d/.test(password.value),
)
const canSend = computed(() => emailValid.value && !sending.value && cooldown.value === 0)
const canSubmit = computed(() => emailValid.value && codeValid.value && !verifying.value)
const pwLoggingIn = ref(false)
const canPasswordLogin = computed(() => emailValid.value && passwordValid.value && !pwLoggingIn.value)

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
    const { error } = await auth.sendCode(email.value.trim())
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
  if (!canSubmit.value) return
  verifying.value = true
  try {
    const r = await auth.verifyCode(email.value.trim(), code.value, remember.value)
    if (r.error) {
      ElMessage.error(`验证码错误：${r.error}`)
      code.value = ''
      return
    }
    redirectAfterLogin(remember.value ? '登录成功，30 天免登录' : '登录成功')
  } finally {
    verifying.value = false
  }
}

async function handlePasswordLogin() {
  if (!canPasswordLogin.value) return
  pwLoggingIn.value = true
  try {
    const r = await auth.loginWithPassword(email.value.trim(), password.value, remember.value)
    if (r.error) {
      ElMessage.error(`登录失败：${r.error}`)
      return
    }
    redirectAfterLogin(remember.value ? '登录成功，30 天免登录' : '登录成功')
  } finally {
    pwLoggingIn.value = false
  }
}

// ---- 设置 / 修改密码（验证码确认邮箱所有权，Dialog 两步式）----
const setPwVisible = ref(false)
const setPwStep = ref<1 | 2>(1)
const setPwCode = ref('')
const newPassword = ref('')
const newPassword2 = ref('')
const setPwSending = ref(false)
const setPwSubmitting = ref(false)
const setPwCooldown = ref(0)

const setPwCodeValid = computed(() => /^\d{6}$/.test(setPwCode.value))
const newPwValid = computed(
  () => newPassword.value.length >= 8 && /[A-Za-z]/.test(newPassword.value) && /\d/.test(newPassword.value),
)
const newPwMatch = computed(() => newPassword.value === newPassword2.value)
const canSendSetPwCode = computed(() => emailValid.value && !setPwSending.value && setPwCooldown.value === 0)
const canSubmitSetPw = computed(
  () => emailValid.value && setPwCodeValid.value && newPwValid.value && newPwMatch.value && !setPwSubmitting.value,
)

async function handleSendSetPwCode() {
  if (!canSendSetPwCode.value) return
  setPwSending.value = true
  try {
    const { error } = await auth.sendCode(email.value.trim())
    if (error) {
      ElMessage.error(`发送失败：${error}`)
      return
    }
    ElMessage.success('验证码已发送，请查收邮箱')
    startCooldown(setPwCooldown, 60)
  } finally {
    setPwSending.value = false
  }
}

async function handleSubmitSetPw() {
  if (!canSubmitSetPw.value) return
  setPwSubmitting.value = true
  try {
    const r = await auth.setPassword(email.value.trim(), setPwCode.value, newPassword.value)
    if (r.error) {
      ElMessage.error(`设置失败：${r.error}`)
      return
    }
    ElMessage.success('密码设置成功，现在可以使用密码登录')
    setPwVisible.value = false
    setPwStep.value = 1
    setPwCode.value = ''
    newPassword.value = ''
    newPassword2.value = ''
  } finally {
    setPwSubmitting.value = false
  }
}

function openSetPw() {
  setPwStep.value = 1
  setPwCode.value = ''
  newPassword.value = ''
  newPassword2.value = ''
  setPwVisible.value = true
}

const canGoSetPwNext = computed(() => emailValid.value && setPwCodeValid.value && !setPwSending.value)

function goSetPwNext() {
  if (canGoSetPwNext.value) setPwStep.value = 2
}

function goSetPwPrev() {
  setPwStep.value = 1
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
        <p class="subtitle">验证码或密码登录，未注册将自动创建账号</p>
      </div>

      <el-tabs v-model="mode" class="login-tabs" stretch>
        <!-- 验证码登录 -->
        <el-tab-pane label="验证码登录" name="otp">
          <el-form @submit.prevent="handleSubmit" label-position="top" class="form">
            <el-form-item label="邮箱">
              <el-input
                v-model="email"
                type="email"
                placeholder="请输入邮箱"
                autocomplete="email"
                :clearable="true"
                :disabled="verifying"
              />
            </el-form-item>

            <el-form-item label="验证码">
              <div class="code-row">
                <el-input
                  v-model="code"
                  placeholder="6 位数字"
                  maxlength="6"
                  autocomplete="one-time-code"
                  :clearable="false"
                  :disabled="verifying"
                  class="code-input"
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
              登录 / 注册
            </el-button>
          </el-form>
        </el-tab-pane>

        <!-- 密码登录 -->
        <el-tab-pane label="密码登录" name="password">
          <el-form @submit.prevent="handlePasswordLogin" label-position="top" class="form">
            <el-form-item label="邮箱">
              <el-input
                v-model="email"
                type="email"
                placeholder="请输入邮箱"
                autocomplete="email"
                :clearable="true"
                :disabled="pwLoggingIn"
              />
            </el-form-item>

            <el-form-item label="密码">
              <el-input
                v-model="password"
                type="password"
                placeholder="请输入密码"
                autocomplete="current-password"
                show-password
                :clearable="true"
                :disabled="pwLoggingIn"
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
            <el-button link type="primary" class="pw-toggle" @click="openSetPw">
              设置 / 修改密码
            </el-button>
            <span class="pw-hint">需邮箱验证码确认</span>
          </div>
        </el-tab-pane>
      </el-tabs>

      <!-- 设置 / 修改密码：Dialog 两步式（页面不再被撑长） -->
      <el-dialog
        v-model="setPwVisible"
        title="设置 / 修改密码"
        width="420"
        align-center
        :close-on-click-modal="false"
        destroy-on-close
      >
        <el-steps :active="setPwStep - 1" align-center finish-status="success" class="set-pw-steps">
          <el-step title="验证邮箱" />
          <el-step title="设置新密码" />
        </el-steps>

        <div v-show="setPwStep === 1" class="set-pw-body">
          <el-form @submit.prevent="goSetPwNext" label-position="top" class="form">
            <el-form-item label="邮箱">
              <el-input
                v-model="email"
                type="email"
                placeholder="请输入邮箱"
                autocomplete="email"
                :clearable="true"
                :disabled="setPwSubmitting"
              />
            </el-form-item>

            <el-form-item label="邮箱验证码">
              <div class="code-row">
                <el-input
                  v-model="setPwCode"
                  placeholder="6 位数字"
                  maxlength="6"
                  autocomplete="one-time-code"
                  :clearable="false"
                  :disabled="setPwSubmitting"
                  class="code-input"
                />
                <el-button
                  :type="canSendSetPwCode ? 'primary' : 'default'"
                  :loading="setPwSending"
                  :disabled="!canSendSetPwCode"
                  class="send-btn"
                  @click="handleSendSetPwCode"
                >
                  {{ setPwCooldown > 0 ? `${setPwCooldown}s 后重发` : '获取验证码' }}
                </el-button>
              </div>
            </el-form-item>

            <el-button
              type="primary"
              size="large"
              :disabled="!canGoSetPwNext"
              class="submit"
              @click="goSetPwNext"
            >
              下一步
            </el-button>
          </el-form>
        </div>

        <div v-show="setPwStep === 2" class="set-pw-body">
          <el-form @submit.prevent="handleSubmitSetPw" label-position="top" class="form">
            <el-form-item label="新密码">
              <el-input
                v-model="newPassword"
                type="password"
                placeholder="至少 8 位，含字母和数字"
                autocomplete="new-password"
                show-password
                :clearable="true"
                :disabled="setPwSubmitting"
              />
            </el-form-item>

            <el-form-item label="确认新密码">
              <el-input
                v-model="newPassword2"
                type="password"
                placeholder="再次输入新密码"
                autocomplete="new-password"
                show-password
                :clearable="true"
                :disabled="setPwSubmitting"
              />
            </el-form-item>

            <p v-if="newPassword && !newPwValid" class="pw-error">密码需至少 8 位，并包含字母和数字</p>
            <p v-else-if="newPassword2 && !newPwMatch" class="pw-error">两次输入的密码不一致</p>

            <div class="set-pw-actions">
              <el-button size="large" :disabled="setPwSubmitting" @click="goSetPwPrev">上一步</el-button>
              <el-button
                type="primary"
                size="large"
                :loading="setPwSubmitting"
                :disabled="!canSubmitSetPw"
                class="submit"
                @click="handleSubmitSetPw"
              >
                确认设置
              </el-button>
            </div>
          </el-form>
        </div>
      </el-dialog>

      <div class="remember-row">
        <el-checkbox v-model="remember" @change="(v: boolean | string | number) => setRemember(Boolean(v))">
          <span class="remember-text">保持登录 30 天</span>
        </el-checkbox>
        <span class="remember-hint">不勾则仅本次有效</span>
      </div>

      <p class="footer-hint">
        未注册用户输入正确的验证码后将自动创建账号
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
  justify-content: space-between;
  margin-top: 6px;
  padding: 0 2px;
}
.pw-toggle { padding: 0; font-size: 13px; }
.pw-hint { font-size: 11px; color: #9ca3af; }

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
