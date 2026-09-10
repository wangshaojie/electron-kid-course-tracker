<script setup lang="ts">
/**
 * UserDetailDrawer.vue —— 管理员后台 · 用户详情抽屉
 *
 * 展示一个用户的所有信息（来源：AdminUserRow）+ 额外拉一次该用户的
 * 最近登录事件流（直接用 admin/logins 客户端过滤）。
 *
 * 入口：Admin.vue 行点击 → emit('open', row) → v-model:true
 *
 * 设计取舍：
 *  - 不开新接口（/admin/users/:id/detail）。当前所有需要的数据都在
 *    AdminUserRow + admin/logins recent 里，admin 详情量小。
 *  - 抽屉打开时不重拉（数据来自列表行），避免进入抽屉就 spinner 闪烁。
 *    如需"最新"信息，外部点"刷新"按钮整页重拉后再点行。
 */
import { computed } from 'vue'
import type { AdminUserRow } from '@/lib/adminApi'

const props = defineProps<{
  modelValue: boolean
  user: AdminUserRow | null
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function close() {
  visible.value = false
}

function formatTime(s: string | null | undefined) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return s
  }
}

function copy(text: string | null | undefined) {
  if (!text) return
  try {
    void navigator.clipboard?.writeText(text)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    direction="rtl"
    size="480px"
    :with-header="false"
    :modal-class="'admin-drawer-modal'"
    custom-class="admin-drawer"
  >
    <div v-if="user" class="flex h-full flex-col text-sm">
      <!-- 头部 -->
      <header class="flex items-start justify-between border-b px-5 py-4" style="border-color: var(--divider);">
        <div class="min-w-0 flex-1">
          <p class="text-xs uppercase tracking-wider text-dark-soft">用户详情</p>
          <h2 class="mt-1 truncate text-lg font-bold text-dark-title">
            {{ user.email || '(邮箱未知)' }}
          </h2>
          <p class="mt-1 flex items-center gap-1 text-xs text-dark-soft">
            <code
              class="select-all break-all rounded px-1 py-0.5 font-mono"
              :class="{ 'cursor-pointer hover:bg-white/5': true }"
              style="background: rgba(255,255,255,0.04);"
              :title="user.uid"
              @click="copy(user.uid)"
            >{{ user.uid }}</code>
            <button
              class="rounded px-1.5 py-0.5 text-[10px] text-brand hover:bg-white/5"
              type="button"
              @click="copy(user.uid)"
            >复制</button>
          </p>
        </div>
        <button
          type="button"
          class="ml-3 rounded-md px-2 py-1 text-xs text-dark-soft hover:bg-white/5 hover:text-dark-title"
          @click="close"
        >✕ 关闭</button>
      </header>

      <!-- 内容区 -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        <!-- 业务统计 -->
        <section class="mb-5">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-dark-soft">业务数据</h3>
          <div class="grid grid-cols-3 gap-2">
            <div class="rounded-lg border px-3 py-2" style="border-color: var(--divider);">
              <p class="text-[10px] text-dark-soft">宝贝</p>
              <p class="mt-0.5 text-xl font-bold text-dark-title">{{ user.childCount }}</p>
            </div>
            <div class="rounded-lg border px-3 py-2" style="border-color: var(--divider);">
              <p class="text-[10px] text-dark-soft">课程</p>
              <p class="mt-0.5 text-xl font-bold text-dark-title">{{ user.courseCount }}</p>
            </div>
            <div class="rounded-lg border px-3 py-2" style="border-color: var(--divider);">
              <p class="text-[10px] text-dark-soft">打卡</p>
              <p class="mt-0.5 text-xl font-bold text-dark-title">{{ user.checkinCount }}</p>
            </div>
          </div>
        </section>

        <!-- 关键时间 -->
        <section class="mb-5">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-dark-soft">关键时间</h3>
          <dl class="space-y-1.5 text-xs">
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-dark-soft">首次出现</dt>
              <dd class="text-dark-title">{{ formatTime(user.firstSeenAt) }}</dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-dark-soft">最近登录</dt>
              <dd class="text-dark-title">{{ formatTime(user.lastLoginAt) }}</dd>
            </div>
          </dl>
        </section>

        <!-- 最近一次登录 -->
        <section class="mb-5">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-dark-soft">最近一次登录</h3>
          <div
            v-if="user.lastLoginAt"
            class="rounded-lg border p-3"
            style="border-color: var(--divider);"
          >
            <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div>
                <p class="text-[10px] text-dark-soft">IP</p>
                <code
                  class="mt-0.5 inline-block max-w-full break-all rounded px-1 py-0.5 font-mono"
                  style="background: rgba(255,255,255,0.04); color: var(--text-body);"
                >{{ user.lastIp || '—' }}</code>
              </div>
              <div>
                <p class="text-[10px] text-dark-soft">设备</p>
                <p class="mt-0.5 text-dark-title">{{ user.lastOs || '—' }}<span v-if="user.lastArch" class="text-dark-soft"> / {{ user.lastArch }}</span></p>
              </div>
              <div>
                <p class="text-[10px] text-dark-soft">客户端</p>
                <p class="mt-0.5 text-dark-title">{{ user.lastClient || '—' }}</p>
              </div>
              <div>
                <p class="text-[10px] text-dark-soft">App 版本</p>
                <p class="mt-0.5 text-dark-title">v{{ user.lastAppVersion || '—' }}</p>
              </div>
              <div>
                <p class="text-[10px] text-dark-soft">Electron</p>
                <p class="mt-0.5 text-dark-title">{{ user.lastElectronVersion || '—' }}</p>
              </div>
              <div>
                <p class="text-[10px] text-dark-soft">登录方式</p>
                <p class="mt-0.5 text-dark-title">
                  <el-tag
                    v-if="user.lastAuthMethod"
                    size="small"
                    :type="user.lastAuthMethod === 'password-login' ? 'primary' : user.lastAuthMethod === 'register' ? 'success' : 'info'"
                    effect="plain"
                    round
                  >{{ user.lastAuthMethod === 'otp-verify' ? 'OTP' : user.lastAuthMethod === 'password-login' ? '密码' : '注册' }}</el-tag>
                  <span v-else>—</span>
                </p>
              </div>
            </div>
            <p v-if="user.lastUserAgent" class="mt-2 break-all text-[10px] text-dark-soft" :title="user.lastUserAgent">
              UA: {{ user.lastUserAgent }}
            </p>
          </div>
          <p v-else class="text-xs text-dark-soft">该用户暂无登录记录（可能从老版本迁移过来）</p>
        </section>

        <!-- 多端 / 多 IP 概览 -->
        <section class="mb-5">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-dark-soft">多端 / 多 IP 概览</h3>
          <div class="grid grid-cols-3 gap-2">
            <div class="rounded-lg border px-3 py-2 text-center" style="border-color: var(--divider);">
              <p class="text-[10px] text-dark-soft">去重 IP</p>
              <p class="mt-0.5 text-lg font-bold text-dark-title">{{ user.distinctIpCount }}</p>
            </div>
            <div class="rounded-lg border px-3 py-2 text-center" style="border-color: var(--divider);">
              <p class="text-[10px] text-dark-soft">去重设备</p>
              <p class="mt-0.5 text-lg font-bold text-dark-title">{{ user.distinctDeviceCount }}</p>
            </div>
            <div class="rounded-lg border px-3 py-2 text-center" style="border-color: var(--divider);">
              <p class="text-[10px] text-dark-soft">去重版本</p>
              <p class="mt-0.5 text-lg font-bold text-dark-title">{{ user.distinctAppCount }}</p>
            </div>
          </div>
          <p class="mt-2 text-[10px] text-dark-soft">
            数字来自 <code class="font-mono">login_events</code> 全量去重。&gt; 1 时建议重点关注（账号可能在多端使用，或密码已泄露）。
          </p>
        </section>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.admin-drawer {
  background: var(--bg-card);
  color: var(--text-body);
}
.admin-drawer :deep(.el-drawer__body) {
  padding: 0;
  height: 100%;
  overflow: hidden;
}
</style>
