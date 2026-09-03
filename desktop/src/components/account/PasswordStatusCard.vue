<script setup lang="ts">
/**
 * PasswordStatusCard.vue —— 设置页"账号安全"卡片
 *
 * 职责：
 *  - 展示当前登录邮箱（脱敏：a***@gmail.com）
 *  - 查询并展示"密码保护"状态：
 *      已设置（上次修改 2026-08-15）  /  未设置
 *  - 提供两个入口：
 *      1) 修改密码（已登录走 /change-password 必传旧密码）
 *      2) 忘记密码（走 OTP 确认邮箱所有权 /reset-password）
 */
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import ChangePasswordDialog from './ChangePasswordDialog.vue'
import ForgotPasswordDialog from './ForgotPasswordDialog.vue'

const auth = useAuthStore()

// 邮箱脱敏：a***@gmail.com（首字符 + *** + @ + 完整 domain）
const maskedEmail = computed(() => {
  const email = auth.user?.email ?? ''
  if (!email) return '未登录'
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  if (local.length <= 1) return `${local}***@${domain}`
  return `${local[0]}***@${domain}`
})

// 状态查询
const statusLoading = ref(false)
const hasPassword = ref(false)
const updatedAt = ref<string | null>(null)
const statusError = ref<string | null>(null)

async function loadStatus() {
  if (!auth.isAuthenticated) return
  statusLoading.value = true
  statusError.value = null
  try {
    const r = await auth.refreshPasswordStatus()
    if (r.error) {
      statusError.value = r.error
      hasPassword.value = false
      updatedAt.value = null
    } else {
      hasPassword.value = r.has_password
      updatedAt.value = r.updated_at
    }
  } catch (e) {
    statusError.value = (e as Error)?.message ?? '查询失败'
  } finally {
    statusLoading.value = false
  }
}

onMounted(loadStatus)

const statusText = computed(() => {
  if (statusLoading.value) return '查询中…'
  if (statusError.value) return `查询失败：${statusError.value}`
  if (!hasPassword.value) return '未设置（可设置密码用于登录）'
  if (updatedAt.value) {
    const d = new Date(updatedAt.value)
    if (!Number.isNaN(d.getTime())) {
      return `已设置（上次修改 ${d.toLocaleDateString('zh-CN')}）`
    }
  }
  return '已设置'
})

// 弹窗
const changeOpen = ref(false)
const forgotOpen = ref(false)

/**
 * "修改密码" 按钮智能路由：
 *   - 已设密码 → ChangePasswordDialog（需输旧密码 + 重发 JWT）
 *   - 未设密码 → ForgotPasswordDialog（走 OTP 设密，无需旧密码）
 * 这样"设置密码"和"修改密码"用同一个入口按钮，文案根据状态切换。
 */
function onChange() {
  if (hasPassword.value) {
    changeOpen.value = true
  } else {
    forgotOpen.value = true
  }
}
function onForgot() {
  forgotOpen.value = true
}

function onChangeSuccess() {
  // 修改成功后立即刷新状态
  loadStatus()
}
function onForgotSuccess() {
  // 区分两种场景：
  //   1) 已设密码用户走"忘记密码" → 必须重新登录（密码已改）
  //   2) 未设密码用户走"设置密码"（按钮智能路由到 ForgotPasswordDialog） → 留在当前页，刷新状态
  if (hasPassword.value) {
    ElMessage.success('密码已重置，请重新登录')
    setTimeout(() => auth.signOut(), 800)
  } else {
    ElMessage.success('密码已设置')
    loadStatus()
  }
}
</script>

<template>
  <div class="card-base">
    <div class="mb-3">
      <h3 class="font-bold" style="color: #fff;">🔐 账号安全</h3>
      <p class="mt-0.5 text-sm" style="color: rgba(255,255,255,0.6);">
        当前登录：<b style="color: #5FCE89;">{{ maskedEmail }}</b>
      </p>
    </div>

    <div class="pw-row">
      <div class="pw-info">
        <span class="pw-label">密码保护</span>
        <span
          :class="[
            'pw-status',
            statusError
              ? 'pw-status--err'
              : hasPassword
              ? 'pw-status--ok'
              : 'pw-status--off',
          ]"
        >
          {{ statusText }}
        </span>
      </div>
      <div class="pw-actions">
        <el-button
          v-if="hasPassword"
          type="primary"
          size="small"
          :disabled="statusLoading"
          @click="onChange"
        >
          修改密码
        </el-button>
        <el-button
          v-else
          type="primary"
          size="small"
          :disabled="statusLoading"
          @click="onChange"
        >
          设置密码
        </el-button>
        <el-button
          size="small"
          :disabled="statusLoading"
          @click="onForgot"
        >
          忘记密码
        </el-button>
      </div>
    </div>

    <p v-if="!hasPassword && !statusLoading && !statusError" class="pw-migrate">
      ⚠️ v0.3 之前注册的账号未设密码，请尽快"设置密码"完成迁移（之后可用密码登录）
    </p>

    <p class="pw-hint">
      {{
        hasPassword
          ? '修改密码会重新签发当前会话（其他已登录设备不会被踢出）'
          : '未设密码：点击"设置密码"将走邮箱验证码流程'
      }}
    </p>

    <ChangePasswordDialog v-model="changeOpen" @success="onChangeSuccess" />
    <ForgotPasswordDialog v-model="forgotOpen" @success="onForgotSuccess" />
  </div>
</template>

<style scoped>
.pw-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  flex-wrap: wrap;
}
.pw-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.pw-label {
  font-size: 14px;
  color: rgba(255,255,255,0.75);
  flex-shrink: 0;
}
.pw-status {
  font-size: 13px;
  padding: 2px 10px;
  border-radius: 12px;
  white-space: nowrap;
}
.pw-status--ok {
  color: #5FCE89;
  background: rgba(63,184,122,0.12);
  border: 1px solid rgba(63,184,122,0.3);
}
.pw-status--off {
  color: #FFB347;
  background: rgba(224,138,30,0.1);
  border: 1px solid rgba(224,138,30,0.3);
}
.pw-status--err {
  color: #FF7A7A;
  background: rgba(217,69,69,0.1);
  border: 1px solid rgba(217,69,69,0.3);
}
.pw-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.pw-hint {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(255,255,255,0.35);
}
.pw-migrate {
  margin: 8px 0 0;
  padding: 8px 12px;
  font-size: 12px;
  color: #FFB347;
  background: rgba(224,138,30,0.08);
  border: 1px solid rgba(224,138,30,0.25);
  border-radius: 6px;
  line-height: 1.5;
}
</style>
