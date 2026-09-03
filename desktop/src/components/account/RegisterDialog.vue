<script setup lang="ts">
/**
 * RegisterDialog.vue —— 注册弹窗（密码为主，邮箱验证码为辅）
 *
 * 流程：
 *  - Step 1: 邮箱 + 密码 + 确认密码（一次性输完）
 *  - Step 2: 6 位邮箱验证码
 *  - Step 3: 成功 → Toast + 1.2s 自动关弹窗
 *
 * 后端：POST /register
 *  - 一次性走完：校验 OTP + 校验密码强度 + 检查邮箱未注册 + 写密码 + 签 JWT
 *  - 邮箱已注册 → 409 email_already_registered（让用户去登录/忘记密码）
 *  - 弱密码 → 400 weak_password
 *  - 成功返回与 /verify /login 完全一致（token/uid/email/role），前端可直接走 register 的后续逻辑
 */
import { ref, computed, watch, onUnmounted, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CircleCheckFilled } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { isValidEmail } from '@/utils/email'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  success: []
}>()

const auth = useAuthStore()

// 字段
const email = ref('')
const password = ref('')
const password2 = ref('')
const code = ref('')
const step = ref<1 | 2 | 3>(1)
const sending = ref(false)
const submitting = ref(false)
const cooldown = ref(0)
let cooldownTimer: number | null = null

// 校验
const emailValid = computed(() => isValidEmail(email.value.trim()))
const pwValid = computed(
  () => password.value.length >= 8 && /[A-Za-z]/.test(password.value) && /\d/.test(password.value),
)
const pwMatch = computed(() => password.value === password2.value)
const codeValid = computed(() => /^\d{6}$/.test(code.value))
const canGoNext1 = computed(() => emailValid.value && pwValid.value && pwMatch.value && !sending.value)
const canSend = computed(() => emailValid.value && !sending.value && cooldown.value === 0)
const canSubmit = computed(() => emailValid.value && codeValid.value && !submitting.value)

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

function reset() {
  email.value = ''
  password.value = ''
  password2.value = ''
  code.value = ''
  step.value = 1
  if (cooldownTimer !== null) {
    window.clearInterval(cooldownTimer)
    cooldownTimer = null
  }
  cooldown.value = 0
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) reset()
  },
)

onUnmounted(() => {
  if (cooldownTimer !== null) window.clearInterval(cooldownTimer)
})

async function onSend() {
  if (!canSend.value) return
  sending.value = true
  try {
    const r = await auth.sendCode(email.value.trim())
    if (r.error) {
      ElMessage.error(`发送失败：${r.error}`)
      return
    }
    ElMessage.success('验证码已发送，请查收邮箱')
    startCooldown(cooldown, 60)
  } finally {
    sending.value = false
  }
}

function goNext1() {
  if (canGoNext1.value) step.value = 2
}
function goPrev2() {
  step.value = 1
}

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const r = await auth.register(email.value.trim(), code.value, password.value, true)
    if (r.error) {
      // 邮箱已注册这种要回 step 1 提示用户去登录 / 忘记密码
      if (r.error.includes('已注册')) {
        step.value = 1
      }
      ElMessage.error(r.error)
      return
    }
    step.value = 3
    ElMessage.success('注册成功，已自动登录')
    emit('success')
    setTimeout(() => {
      emit('update:modelValue', false)
    }, 1200)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="注册账号"
    width="440"
    align-center
    :close-on-click-modal="false"
    :show-close="step !== 2"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-steps
      v-if="step !== 3"
      :active="step - 1"
      align-center
      finish-status="success"
      class="reg-steps"
    >
      <el-step title="设置密码" />
      <el-step title="验证邮箱" />
    </el-steps>

    <div v-show="step === 1" class="reg-body">
      <p class="hint">输入邮箱 + 密码完成注册。密码至少 8 位，包含字母和数字。</p>
      <el-form label-position="top" @submit.prevent="goNext1">
        <el-form-item label="邮箱">
          <el-input
            v-model="email"
            type="email"
            placeholder="请输入邮箱"
            autocomplete="email"
            :clearable="true"
            :disabled="sending"
            @keyup.enter="goNext1"
          />
        </el-form-item>

        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            placeholder="至少 8 位，含字母和数字"
            autocomplete="new-password"
            show-password
            :clearable="true"
            :disabled="sending"
            @keyup.enter="goNext1"
          />
        </el-form-item>

        <el-form-item label="确认密码">
          <el-input
            v-model="password2"
            type="password"
            placeholder="再次输入密码"
            autocomplete="new-password"
            show-password
            :clearable="true"
            :disabled="sending"
            @keyup.enter="goNext1"
          />
        </el-form-item>

        <p v-if="password && !pwValid" class="pw-error">密码需至少 8 位，并包含字母和数字</p>
        <p v-else-if="password2 && !pwMatch" class="pw-error">两次输入的密码不一致</p>

        <el-button
          type="primary"
          size="large"
          :disabled="!canGoNext1"
          class="submit"
          @click="goNext1"
        >
          下一步
        </el-button>
      </el-form>
    </div>

    <div v-show="step === 2" class="reg-body">
      <p class="hint">验证码已发送至 <b>{{ email }}</b>，10 分钟内有效</p>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="邮箱验证码">
          <div class="code-row">
            <el-input
              v-model="code"
              placeholder="6 位数字"
              maxlength="6"
              autocomplete="one-time-code"
              :clearable="false"
              :disabled="submitting"
              class="code-input"
              @keyup.enter="onSubmit"
            />
            <el-button
              :type="canSend ? 'primary' : 'default'"
              :loading="sending"
              :disabled="!canSend"
              class="send-btn"
              @click="onSend"
            >
              {{ cooldown > 0 ? `${cooldown}s 后重发` : '重新发送' }}
            </el-button>
          </div>
        </el-form-item>

        <div class="reg-actions">
          <el-button size="large" :disabled="submitting" @click="goPrev2">上一步</el-button>
          <el-button
            type="primary"
            size="large"
            :loading="submitting"
            :disabled="!canSubmit"
            class="submit"
            @click="onSubmit"
          >
            确认注册
          </el-button>
        </div>
      </el-form>
    </div>

    <div v-show="step === 3" class="reg-success">
      <el-icon :size="48" color="#3FB87A"><CircleCheckFilled /></el-icon>
      <p class="success-text">注册成功</p>
      <p class="success-hint">正在自动登录…</p>
    </div>
  </el-dialog>
</template>

<style scoped>
.reg-steps { margin: 4px 0 20px; }
.reg-body { min-height: 280px; }
.reg-body :deep(.el-form-item) { margin-bottom: 14px; }
.hint { color: rgba(255,255,255,0.55); font-size: 13px; margin: 0 0 12px; }
.hint b { color: #fff; }
.code-row { display: flex; gap: 8px; width: 100%; }
.code-input { flex: 1; }
.send-btn { flex-shrink: 0; width: 130px; }
.submit { width: 100%; margin-top: 8px; font-size: 16px; font-weight: 500; }
.reg-actions { display: flex; gap: 12px; margin-top: 8px; }
.reg-actions .submit { flex: 1; margin-top: 0; }
.pw-error { margin: -6px 0 10px; font-size: 12px; color: #FF7A7A; }

.reg-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
}
.success-text { color: #fff; font-size: 18px; font-weight: 600; margin: 0; }
.success-hint { color: rgba(255,255,255,0.55); font-size: 13px; margin: 0; }
</style>
