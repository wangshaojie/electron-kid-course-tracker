<script setup lang="ts">
/**
 * Login.vue —— CloudBase OTP 邮箱验证码登录
 *
 * 流程：
 *   1) 输入邮箱 → "获取验证码" → auth.signInWithOtp → 邮件发码
 *   2) 输 6 位码 → "登录 / 注册" → data.verifyOtp({ token }) → 自动登录
 */
import { ref, computed, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { isValidEmail } from '@/utils/email'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const email = ref(auth.lastEmail)
const code = ref('')
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
const canSend = computed(() => emailValid.value && !sending.value && cooldown.value === 0)
const canSubmit = computed(() => emailValid.value && codeValid.value && !verifying.value)

function startCooldown(sec: number) {
  cooldown.value = sec
  if (cooldownTimer !== null) window.clearInterval(cooldownTimer)
  cooldownTimer = window.setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0 && cooldownTimer !== null) {
      window.clearInterval(cooldownTimer)
      cooldownTimer = null
      cooldown.value = 0
    }
  }, 1000)
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
    startCooldown(60)
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
    ElMessage.success(remember.value ? '登录成功，30 天免登录' : '登录成功')
    const redirect = (route.query.redirect as string) || '/'
    router.replace(redirect)
  } finally {
    verifying.value = false
  }
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
        <p class="subtitle">输入邮箱和验证码即可登录或注册</p>
      </div>

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

        <div class="remember-row">
          <el-checkbox v-model="remember" @change="(v: boolean | string | number) => setRemember(Boolean(v))">
            <span class="remember-text">保持登录 30 天</span>
          </el-checkbox>
          <span class="remember-hint">不勾则仅本次有效</span>
        </div>
      </el-form>

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

.brand { text-align: center; margin-bottom: 32px; }
.brand .logo { font-size: 48px; margin-bottom: 8px; }
.brand h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; color: #1f2937; }
.brand .subtitle { margin: 0; color: #6b7280; font-size: 14px; }

.form { margin-bottom: 12px; }
.code-row { display: flex; gap: 8px; width: 100%; }
.code-input { flex: 1; }
.send-btn { flex-shrink: 0; width: 130px; }

.submit { width: 100%; margin-top: 8px; font-size: 16px; font-weight: 500; }

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
