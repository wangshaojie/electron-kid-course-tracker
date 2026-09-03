<script setup lang="ts">
/**
 * ForgotPasswordDialog.vue —— 忘记密码弹窗（无需登录可用）
 *
 * 流程：
 *  - Step 1: 邮箱（可改） + 6 位 OTP
 *  - Step 2: 新密码 + 确认新密码
 *  - Step 3: 成功 → Toast + 1.5s 自动关弹窗
 *
 * 后端：POST /reset-password（后端逻辑与 /set-password 完全相同）
 *  - 不需要旧密码（OTP 已经证明邮箱所有权）
 *  - 未设过密码的用户也能用（直接就设置了）
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
const code = ref('')
const newPassword = ref('')
const newPassword2 = ref('')
const step = ref<1 | 2 | 3>(1)
const sending = ref(false)
const submitting = ref(false)
const cooldown = ref(0)
let cooldownTimer: number | null = null

// 校验
const emailValid = computed(() => isValidEmail(email.value.trim()))
const codeValid = computed(() => /^\d{6}$/.test(code.value))
const newPwValid = computed(
  () => newPassword.value.length >= 8 && /[A-Za-z]/.test(newPassword.value) && /\d/.test(newPassword.value),
)
const newPwMatch = computed(() => newPassword.value === newPassword2.value)
const canSend = computed(() => emailValid.value && !sending.value && cooldown.value === 0)
const canGoNext = computed(() => emailValid.value && codeValid.value && !sending.value)
const canSubmit = computed(
  () => emailValid.value && newPwValid.value && newPwMatch.value && !submitting.value,
)

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
  // 打开时默认填上当前账号邮箱（如果有），让用户能直接确认
  email.value = auth.user?.email ?? auth.lastEmail ?? ''
  code.value = ''
  newPassword.value = ''
  newPassword2.value = ''
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

function goNext() {
  if (canGoNext.value) step.value = 2
}

function goPrev() {
  step.value = 1
}

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const r = await auth.resetPassword(email.value.trim(), code.value, newPassword.value)
    if (r.error) {
      ElMessage.error(`重置失败：${r.error}`)
      return
    }
    step.value = 3
    ElMessage.success('密码已重置')
    emit('success')
    setTimeout(() => {
      emit('update:modelValue', false)
    }, 1500)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="忘记密码"
    width="420"
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
      class="forgot-pw-steps"
    >
      <el-step title="验证邮箱" />
      <el-step title="设置新密码" />
    </el-steps>

    <div v-show="step === 1" class="forgot-pw-body">
      <p class="hint">将通过邮箱验证码确认您是该邮箱的所有者，然后重置密码。</p>
      <el-form label-position="top" @submit.prevent="goNext">
        <el-form-item label="邮箱">
          <el-input
            v-model="email"
            type="email"
            placeholder="请输入要重置的邮箱"
            autocomplete="email"
            :clearable="true"
            :disabled="sending"
            @keyup.enter="goNext"
          />
        </el-form-item>

        <el-form-item label="邮箱验证码">
          <div class="code-row">
            <el-input
              v-model="code"
              placeholder="6 位数字"
              maxlength="6"
              autocomplete="one-time-code"
              :clearable="false"
              :disabled="sending"
              class="code-input"
              @keyup.enter="goNext"
            />
            <el-button
              :type="canSend ? 'primary' : 'default'"
              :loading="sending"
              :disabled="!canSend"
              class="send-btn"
              @click="onSend"
            >
              {{ cooldown > 0 ? `${cooldown}s 后重发` : '获取验证码' }}
            </el-button>
          </div>
        </el-form-item>

        <el-button
          type="primary"
          size="large"
          :disabled="!canGoNext"
          class="submit"
          @click="goNext"
        >
          下一步
        </el-button>
      </el-form>
    </div>

    <div v-show="step === 2" class="forgot-pw-body">
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="新密码">
          <el-input
            v-model="newPassword"
            type="password"
            placeholder="至少 8 位，含字母和数字"
            autocomplete="new-password"
            show-password
            :clearable="true"
            :disabled="submitting"
            @keyup.enter="onSubmit"
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
            :disabled="submitting"
            @keyup.enter="onSubmit"
          />
        </el-form-item>

        <p v-if="newPassword && !newPwValid" class="pw-error">密码需至少 8 位，并包含字母和数字</p>
        <p v-else-if="newPassword2 && !newPwMatch" class="pw-error">两次输入的密码不一致</p>

        <div class="forgot-pw-actions">
          <el-button size="large" :disabled="submitting" @click="goPrev">上一步</el-button>
          <el-button
            type="primary"
            size="large"
            :loading="submitting"
            :disabled="!canSubmit"
            class="submit"
            @click="onSubmit"
          >
            确认重置
          </el-button>
        </div>
      </el-form>
    </div>

    <div v-show="step === 3" class="forgot-pw-success">
      <el-icon :size="48" color="#3FB87A"><CircleCheckFilled /></el-icon>
      <p class="success-text">密码已重置</p>
      <p class="success-hint">正在跳转到登录页…</p>
    </div>
  </el-dialog>
</template>

<style scoped>
.forgot-pw-steps { margin: 4px 0 16px; }
.forgot-pw-body { min-height: 240px; }
.forgot-pw-body :deep(.el-form-item) { margin-bottom: 14px; }
.hint { color: rgba(255,255,255,0.55); font-size: 13px; margin: 0 0 16px; }
.code-row { display: flex; gap: 8px; width: 100%; }
.code-input { flex: 1; }
.send-btn { flex-shrink: 0; width: 130px; }
.submit { width: 100%; margin-top: 8px; font-size: 16px; font-weight: 500; }
.forgot-pw-actions { display: flex; gap: 12px; margin-top: 8px; }
.forgot-pw-actions .submit { flex: 1; margin-top: 0; }
.pw-error { margin: -6px 0 10px; font-size: 12px; color: #FF7A7A; }

.forgot-pw-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
}
.success-text { color: #fff; font-size: 18px; font-weight: 600; margin: 0; }
.success-hint { color: rgba(255,255,255,0.55); font-size: 13px; margin: 0; }
</style>
