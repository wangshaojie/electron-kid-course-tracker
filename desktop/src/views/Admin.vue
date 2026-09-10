<script setup lang="ts">
/**
 * Admin.vue —— 管理员后台（暗色玻璃版）
 *
 * 数据来源：data-api HTTP Function（带 JWT 鉴权 + ADMIN_EMAILS 白名单）
 * 路由守卫：router.beforeEach 在 isAuthenticated 后再校验 meta.requiresAdmin
 *          → 普通用户访问 /admin 直接跳 /
 *
 * 4 个核心数字 + 1 个注册用户表
 *  - totalUsers        去重 owner_id 数（来自 children/courses/checkins/user_prefs）
 *  - usersWithChildren children 表去重 owner_id 数
 *  - childCoverageRate usersWithChildren / totalUsers（保留 4 位小数 → %）
 *  - totalChildren / totalCourses / totalCheckins 业务行数
 *
 * 用户表新增列（v0.5+）：
 *  - lastIp            最近一次登录 IP（x-forwarded-for）
 *  - lastOs            Windows 10/11 / macOS / Linux
 *  - lastArch          x64 / arm64 / x86
 *  - lastAppVersion    来自 X-Client-Version header（package.json version）
 *  - lastLoginAt       最近一次成功登录时间
 *  - lastAuthMethod    otp-verify / password-login / register
 */
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApiGet } from '@/lib/cloudbase'

interface AdminStats {
  ok: true
  totalUsers: number
  usersWithChildren: number
  childCoverageRate: number
  totalChildren: number
  totalCourses: number
  totalCheckins: number
  fetchedAt: string
}

interface AdminUser {
  uid: string
  email: string | null
  firstSeenAt: string | null
  childCount: number
  courseCount: number
  checkinCount: number
  // 最近一次登录（v0.5+ 由 auth-otp /verify /login /register 写 login_events）
  lastIp: string | null
  lastOs: string | null
  lastArch: string | null
  lastClient: string | null
  lastAppVersion: string | null
  lastElectronVersion: string | null
  lastUserAgent: string | null
  lastAuthMethod: 'otp-verify' | 'password-login' | 'register' | null
  lastLoginAt: string | null
}

interface AdminUsersResponse {
  ok: true
  total: number
  users: AdminUser[]
  fetchedAt: string
}

const loading = ref(false)
const stats = ref<AdminStats | null>(null)
const users = ref<AdminUser[]>([])
const usersTotal = ref(0)
const lastFetched = ref<string | null>(null)

const coveragePercent = computed(() => {
  if (!stats.value) return '—'
  return `${(stats.value.childCoverageRate * 100).toFixed(1)}%`
})

function formatTime(s: string | null) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return s
  }
}

function authMethodShort(m: AdminUser['lastAuthMethod']) {
  if (m === 'otp-verify') return 'OTP'
  if (m === 'password-login') return '密码'
  if (m === 'register') return '注册'
  return ''
}

async function load() {
  loading.value = true
  try {
    const [s, u] = await Promise.all([
      dataApiGet<AdminStats>('/admin/stats'),
      dataApiGet<AdminUsersResponse>('/admin/users'),
    ])
    if (!s.ok) {
      ElMessage.error(`加载统计失败：${s.status} ${s.error}${s.detail ? ' · ' + s.detail : ''}`)
      return
    }
    if (!u.ok) {
      ElMessage.error(`加载用户表失败：${u.status} ${u.error}`)
      return
    }
    stats.value = s.data
    users.value = u.data.users
    usersTotal.value = u.data.total
    lastFetched.value = new Date().toLocaleString('zh-CN', { hour12: false })
  } catch (e) {
    ElMessage.error(`网络异常：${(e as Error)?.message ?? String(e)}`)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="h-full overflow-y-auto dark-page p-6">
    <header class="mb-5 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-dark-title">🛡 管理员后台</h1>
        <p class="text-sm text-dark-soft">
          注册用户统计 · 基础面板
          <span v-if="lastFetched" class="ml-2 text-xs text-dark-ghost">
            最近更新 {{ lastFetched }}
          </span>
        </p>
        <p class="mt-1 text-xs text-dark-ghost">
          IP / 设备 / 客户端版本 来自用户最近一次成功登录（OTP / 密码 / 注册）时上报。
          未登录过的老用户这些列显示「—」。
        </p>
      </div>
      <button class="btn-dark-ghost" :disabled="loading" @click="load">
        <span v-if="!loading">🔄 刷新</span>
        <span v-else>刷新中…</span>
      </button>
    </header>

    <!-- 4 个核心数字 -->
    <div class="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
      <div class="glass-card p-5">
        <p class="text-xs text-dark-soft">总注册用户</p>
        <p class="mt-1 text-3xl font-extrabold text-brand">
          {{ stats?.totalUsers ?? '—' }}
        </p>
        <p class="mt-1 text-xs text-dark-soft">在任一业务表出现过</p>
      </div>
      <div class="glass-card p-5">
        <p class="text-xs text-dark-soft">已创建宝贝的用户</p>
        <p class="mt-1 text-3xl font-extrabold text-brand">
          {{ stats?.usersWithChildren ?? '—' }}
        </p>
        <p class="mt-1 text-xs text-dark-soft">覆盖率 {{ coveragePercent }}</p>
      </div>
      <div class="glass-card p-5">
        <p class="text-xs text-dark-soft">总宝贝 / 课程 / 打卡</p>
        <p class="mt-1 text-2xl font-extrabold text-dark-title">
          {{ stats?.totalChildren ?? '—' }} /
          {{ stats?.totalCourses ?? '—' }} /
          {{ stats?.totalCheckins ?? '—' }}
        </p>
        <p class="mt-1 text-xs text-dark-soft">业务行数（所有用户合计）</p>
      </div>
      <div class="glass-card p-5">
        <p class="text-xs text-dark-soft">覆盖用户列表</p>
        <p class="mt-1 text-3xl font-extrabold text-brand">
          {{ usersTotal }}
        </p>
        <p class="mt-1 text-xs text-dark-soft">按首次创建时间倒序，最多 500</p>
      </div>
    </div>

    <!-- 注册用户表 -->
    <div class="glass-card p-5">
      <h3 class="mb-3 font-bold text-dark-title">📋 注册用户表</h3>
      <el-table v-loading="loading" :data="users" stripe max-height="540">
        <el-table-column label="邮箱" min-width="200">
          <template #default="{ row }">
            <span v-if="row.email" class="text-sm text-dark-title">{{ row.email }}</span>
            <span
              v-else
              class="text-xs text-dark-soft"
              :title="row.uid"
            >无 (uid 截断 {{ row.uid.slice(0, 8) }}…)</span>
          </template>
        </el-table-column>
        <el-table-column label="UID" min-width="160">
          <template #default="{ row }">
            <code
              class="select-all break-all text-xs"
              style="color: var(--text-body);"
            >{{ row.uid }}</code>
          </template>
        </el-table-column>
        <el-table-column label="首次出现" width="170">
          <template #default="{ row }">
            <span class="text-xs" style="color: var(--text-body);">{{ formatTime(row.firstSeenAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="宝贝" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.childCount > 0 ? 'success' : 'info'" effect="plain" round>
              {{ row.childCount }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="课程" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.courseCount > 0 ? 'warning' : 'info'" effect="plain" round>
              {{ row.courseCount }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="打卡" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.checkinCount > 0 ? 'primary' : 'info'" effect="plain" round>
              {{ row.checkinCount }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近 IP" min-width="120">
          <template #default="{ row }">
            <code
              v-if="row.lastIp"
              class="select-all break-all text-xs"
              style="color: var(--text-body);"
            >{{ row.lastIp }}</code>
            <span v-else class="text-xs text-dark-ghost">—</span>
          </template>
        </el-table-column>
        <el-table-column label="设备" min-width="150">
          <template #default="{ row }">
            <span v-if="row.lastOs || row.lastArch" class="text-xs" style="color: var(--text-body);">
              {{ row.lastOs || '未知' }}<span v-if="row.lastArch" class="text-dark-ghost"> / {{ row.lastArch }}</span>
            </span>
            <span v-else class="text-xs text-dark-ghost">—</span>
          </template>
        </el-table-column>
        <el-table-column label="客户端版本" min-width="140">
          <template #default="{ row }">
            <span v-if="row.lastAppVersion" class="text-xs" style="color: var(--text-body);">
              v{{ row.lastAppVersion }}
              <span
                v-if="row.lastAuthMethod"
                class="ml-1 text-dark-ghost"
                :title="row.lastAuthMethod"
              >· {{ authMethodShort(row.lastAuthMethod) }}</span>
            </span>
            <span v-else class="text-xs text-dark-ghost">—</span>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="170">
          <template #default="{ row }">
            <span class="text-xs" style="color: var(--text-body);">{{ formatTime(row.lastLoginAt) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <p
        v-if="usersTotal > 0"
        class="mt-2 text-center text-xs"
        style="color: var(--text-soft);"
      >
        共 {{ usersTotal }} 个用户{{ usersTotal > 500 ? '（仅展示前 500）' : '' }}
      </p>
    </div>
  </div>
</template>
