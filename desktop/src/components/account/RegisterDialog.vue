<script setup lang="ts">
/**
 * RegisterDialog.vue —— 注册弹窗（v0.4+：先验证邮箱，再设置密码）
 *
 * 流程：
 *  - Step 1: 邮箱 + 收码 + 输 6 位验证码（前端仅校验格式，不发请求）
 *  - Step 2: 密码 + 确认密码
 *  - Step 3: 成功 → Toast + 1.2s 自动关弹窗
 *
 * 后端链路（store.register 内部组合）：
 *  - 第 1 步：POST /verify → 消费 OTP + 签 JWT + 存 session
 *  - 第 2 步：POST /set-password 带 Bearer JWT → 不消耗 OTP + 写密码
 *  - 邮箱已注册（/set-password 返回 409）→ session 已存在但密码未设，引导去登录
 *  - 弱密码（400 weak_password）→ 回 Step 2 重输
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
const password = ref('')
const password2 = ref('')
const step = ref<1 | 2 | 3>(1)
const sending = ref(false)
const submitting = ref(false)
const cooldown = ref(0)
let cooldownTimer: number | null = null

// 校验
const emailValid = computed(() => isValidEmail(email.value.trim()))
const codeValid = computed(() => /^\d{6}$/.test(code.value))
const pwValid = computed(
  () => password.value.length >= 8 && /[A-Za-z]/.test(password.value) && /\d/.test(password.value),
)
const pwMatch = computed(() => password.value === password2.value)
const canGoNext1 = computed(() => emailValid.value && codeValid.value && !sending.value)
const canSend = computed(() => emailValid.value && !sending.value && cooldown.value === 0)
const canSubmit = computed(
  () => emailValid.value && pwValid.value && pwMatch.value && !submitting.value,
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
  email.value = ''
  code.value = ''
  password.value = ''
  password2.value = ''
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
      // 邮箱已注册（409）：store 内部已经在 /verify 成功后写入了 session；
      // 提示用户回登录页登录即可，留在本弹窗里无意义。
      if (r.error.includes('已注册')) {
        ElMessage.warning('该邮箱已注册，请直接登录或找回密码')
        // 关闭弹窗由父组件通过 success 触发后处理；这里给个重置引导
        step.value = 1
        // 邮箱已注册时，store 实际上已经处于 authenticated 态，让父组件拿到 success 后再处理
        // 这里不强退：业务上"邮箱已注册"是用户友好提示，不阻断他们继续使用
      } else {
        ElMessage.error(r.error)
      }
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
      <el-step title="验证邮箱" />
      <el-step title="设置密码" />
    </el-steps>

    <div v-show="step === 1" class="reg-body">
      <p class="hint">先通过邮箱验证码确认您是该邮箱的所有者，再设置密码。</p>
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
              @keyup.enter="goNext1"
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
          :disabled="!canGoNext1"
          class="submit"
          @click="goNext1"
        >
          下一步
        </el-button>
      </el-form>
    </div>

    <div v-show="step === 2" class="reg-body">
      <p class="hint">邮箱 <b>{{ email }}</b> 已验证。密码至少 8 位，包含字母和数字。</p>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            placeholder="至少 8 位，含字母和数字"
            autocomplete="new-password"
            show-password
            :clearable="true"
            :disabled="submitting"
            @keyup.enter="onSubmit"
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
            :disabled="submitting"
            @keyup.enter="onSubmit"
          />
        </el-form-item>

        <p v-if="password && !pwValid" class="pw-error">密码需至少 8 位，并包含字母和数字</p>
        <p v-else-if="password2 && !pwMatch" class="pw-error">两次输入的密码不一致</p>

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
      <el-icon :size="48" color="var(--brand-1)"><CircleCheckFilled /></el-icon>
      <p class="success-text">注册成功</p>
      <p class="success-hint">正在自动登录…</p>
    </div>
  </el-dialog>
</template>

<style scoped>
.reg-steps { margin: 4px 0 20px; }
.reg-body { min-height: 280px; }
.reg-body :deep(.el-form-item) { margin-bottom: 14px; }
.hint { color: var(--text-soft); font-size: 13px; margin: 0 0 12px; }
.hint b { color: var(--text-title); }
.code-row { display: flex; gap: 8px; width: 100%; }
.code-input { flex: 1; }
.send-btn { flex-shrink: 0; width: 130px; }
.submit { width: 100%; margin-top: 8px; font-size: 16px; font-weight: 500; }
.reg-actions { display: flex; gap: 12px; margin-top: 8px; }
.reg-actions .submit { flex: 1; margin-top: 0; }
.pw-error { margin: -6px 0 10px; font-size: 12px; color: var(--danger-text); }

.reg-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
}
.success-text { color: var(--text-title); font-size: 18px; font-weight: 600; margin: 0; }
.success-hint { color: var(--text-soft); font-size: 13px; margin: 0; }
</style>
