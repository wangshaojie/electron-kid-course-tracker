<script setup lang="ts">
/**
 * ChangePasswordDialog.vue —— 修改密码弹窗（已登录用户）
 *
 * 流程：
 *  - Step 1: 旧密码 + 新密码 + 确认新密码
 *  - Step 2: 校验中（按钮 loading）
 *  - Step 3: 成功 → Toast + 1.2s 自动关弹窗
 *
 * 后端：POST /change-password（需 Bearer JWT）
 *  - 旧密码错 5 次锁 15 分钟（错误码 wrong_old_password_locked）
 *  - 新密码不能与旧密码相同（错误码 same_as_old）
 *  - 未设过密码走 password_not_set 错误码（应改走"忘记密码"）
 */
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  success: []
}>()

const auth = useAuthStore()

// 字段
const oldPassword = ref('')
const newPassword = ref('')
const newPassword2 = ref('')
const submitting = ref(false)
const step = ref<1 | 2 | 3>(1)

// 校验
const oldPwValid = computed(() => oldPassword.value.length >= 1)
const newPwValid = computed(
  () => newPassword.value.length >= 8 && /[A-Za-z]/.test(newPassword.value) && /\d/.test(newPassword.value),
)
const newPwMatch = computed(() => newPassword.value === newPassword2.value)
const sameAsOld = computed(() => oldPassword.value && newPassword.value && oldPassword.value === newPassword.value)

const canSubmit = computed(
  () =>
    oldPwValid.value &&
    newPwValid.value &&
    newPwMatch.value &&
    !sameAsOld.value &&
    !submitting.value,
)

function reset() {
  oldPassword.value = ''
  newPassword.value = ''
  newPassword2.value = ''
  submitting.value = false
  step.value = 1
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) reset()
  },
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  step.value = 2
  try {
    const r = await auth.changePassword(oldPassword.value, newPassword.value)
    if (r.error) {
      // 错误回到 step 1 让用户修改
      step.value = 1
      ElMessage.error(r.error)
      return
    }
    step.value = 3
    ElMessage.success('密码修改成功')
    emit('success')
    // 1.2s 后自动关
    setTimeout(() => {
      emit('update:modelValue', false)
    }, 1200)
  } catch (e) {
    step.value = 1
    ElMessage.error((e as Error)?.message ?? '修改失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="修改密码"
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
      class="change-pw-steps"
    >
      <el-step title="输入密码" />
      <el-step title="提交中" />
    </el-steps>

    <div v-show="step === 1" class="change-pw-body">
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="当前密码">
          <el-input
            v-model="oldPassword"
            type="password"
            placeholder="请输入当前密码"
            autocomplete="current-password"
            show-password
            :clearable="true"
            :disabled="submitting"
            @keyup.enter="onSubmit"
          />
        </el-form-item>

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
        <p v-else-if="sameAsOld" class="pw-error">新密码不能与当前密码相同</p>

        <el-button
          type="primary"
          size="large"
          :loading="submitting"
          :disabled="!canSubmit"
          class="submit"
          @click="onSubmit"
        >
          确认修改
        </el-button>
      </el-form>
    </div>

    <div v-show="step === 2" class="change-pw-loading">
      <el-icon class="is-loading" :size="32"><Loading /></el-icon>
      <p class="loading-text">正在校验旧密码并写入新密码…</p>
    </div>

    <div v-show="step === 3" class="change-pw-success">
      <el-icon :size="48" color="#3FB87A"><CircleCheckFilled /></el-icon>
      <p class="success-text">密码修改成功</p>
      <p class="success-hint">本会话已自动用新密码重新登录</p>
    </div>
  </el-dialog>
</template>

<style scoped>
.change-pw-steps { margin: 4px 0 20px; }
.change-pw-body { min-height: 280px; }
.change-pw-body :deep(.el-form-item) { margin-bottom: 14px; }
.submit { width: 100%; margin-top: 8px; font-size: 16px; font-weight: 500; }
.pw-error { margin: -6px 0 10px; font-size: 12px; color: #f56c6c; }

.change-pw-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
}
.loading-text { color: #6b7280; font-size: 14px; }

.change-pw-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
}
.success-text { color: #1f2937; font-size: 18px; font-weight: 600; margin: 0; }
.success-hint { color: #6b7280; font-size: 13px; margin: 0; }
</style>
