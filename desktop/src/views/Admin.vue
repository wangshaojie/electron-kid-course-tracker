<script setup lang="ts">
/**
 * Admin.vue —— 管理员后台（v2 整页重写版）
 *
 * 4 个 Tab（顶部 Segmented 切换）：
 *  - 👥 用户         /admin/users  注册用户表 + 搜索 + 筛选 + 排序 + 行点击打开详情抽屉
 *  - 📈 活跃度       /admin/active  趋势分桶（SVG 自绘条形图）+ 留存 + 登录事件流
 *  - 🏷 热度榜       /admin/leaderboard  课程名/机构 热度榜（by 切换）
 *  - 🔐 登录审计     /admin/logins  窗口内 IP/OS/版本 TOP + 最近登录流
 *
 * 路由守卫：router.beforeEach 在 isAuthenticated 后再校验 meta.requiresAdmin
 *          → 普通用户访问 /admin 直接跳 /
 *
 * 鲁棒性：
 *  - 4 块独立加载态（任一失败不影响其他）
 *  - 后端返 meta.degraded 时顶部黄条提示
 *  - 进入页自动拉 + 顶部"刷新"按钮（实时+手动）
 *  - 任何字段为 null → 显示「—」
 */
import { ref, computed, onMounted, reactive, watch } from 'vue'
import {
  getAdminUsers,
  getAdminActive,
  getAdminLeaderboard,
  getAdminLogins,
  type AdminUserRow,
  type AdminMeta,
  type AdminUserOrder,
  type AuthMethod,
  type ActiveBucket,
  type LeaderboardBy,
  type ActiveTrendPoint,
  type ActiveRecent,
  type LeaderboardItem,
  type LoginCountItem,
} from '@/lib/adminApi'
import UserDetailDrawer from '@/components/admin/UserDetailDrawer.vue'

// ============== Tab 状态 ==============
type TabKey = 'users' | 'active' | 'leaderboard' | 'logins'
const activeTab = ref<TabKey>('users')
const TAB_OPTIONS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'users', label: '用户', icon: '👥' },
  { key: 'active', label: '活跃度', icon: '📈' },
  { key: 'leaderboard', label: '热度榜', icon: '🏷' },
  { key: 'logins', label: '登录审计', icon: '🔐' },
]

// ============== 全局 ==============
const anyLoading = ref(false)
const lastFetched = ref<string | null>(null)

// 4 块独立 meta + error
const usersMeta = ref<AdminMeta | null>(null)
const usersError = ref<string | null>(null)
const activeMeta = ref<AdminMeta | null>(null)
const activeError = ref<string | null>(null)
const leaderboardMeta = ref<AdminMeta | null>(null)
const leaderboardError = ref<string | null>(null)
const loginsMeta = ref<AdminMeta | null>(null)
const loginsError = ref<string | null>(null)

const degradedKeys = computed<string[]>(() => {
  const set = new Set<string>()
  for (const m of [usersMeta.value, activeMeta.value, leaderboardMeta.value, loginsMeta.value]) {
    if (m?.degradedKeys) for (const k of m.degradedKeys) set.add(k)
  }
  return Array.from(set)
})

const loginEventsAvailable = computed<boolean>(() => {
  // 任何 meta 报可用 = 视为可用
  for (const m of [usersMeta.value, activeMeta.value, loginsMeta.value]) {
    if (m?.loginEventsAvailable) return true
  }
  // 都没报：默认乐观认为可用（migrations 已确认建表，但老版本后端可能不返）
  return usersMeta.value === null && activeMeta.value === null && loginsMeta.value === null
})

const KEY_LABEL: Record<string, string> = {
  children: '宝贝',
  courses: '课程',
  checkins: '打卡',
  email_otps: '邮箱反查',
  login_events: '登录事件',
}

function degradedHint(keys: string[]): string {
  if (!keys.length) return ''
  return keys.map((k) => KEY_LABEL[k] || k).join(' / ') + ' 数据暂未加载'
}

function formatTime(s: string | null | undefined) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return s
  }
}

function authMethodShort(m: AuthMethod | null | undefined) {
  if (m === 'otp-verify') return 'OTP'
  if (m === 'password-login') return '密码'
  if (m === 'register') return '注册'
  return ''
}

// ============== /admin/users ==============
const usersLoading = ref(false)
const usersList = ref<AdminUserRow[]>([])
const usersTotal = ref(0)

const userQuery = reactive({
  q: '',
  method: '' as '' | AuthMethod,
  sinceDays: 0 as number,
  order: 'first_seen_at' as AdminUserOrder,
  asc: false,
})

// 搜索用本地 debounce：避免每次按键打接口
const usersQueryDebounced = ref({ ...userQuery })
let usersQueryTimer: number | null = null
watch(
  () => ({ ...userQuery }),
  (v) => {
    if (usersQueryTimer) window.clearTimeout(usersQueryTimer)
    usersQueryTimer = window.setTimeout(() => {
      usersQueryDebounced.value = v
    }, 300)
  },
  { deep: true },
)

async function loadUsers() {
  usersLoading.value = true
  usersError.value = null
  try {
    const r = await getAdminUsers({
      q: usersQueryDebounced.value.q || undefined,
      method: usersQueryDebounced.value.method || undefined,
      sinceDays: usersQueryDebounced.value.sinceDays || undefined,
      order: usersQueryDebounced.value.order,
      asc: usersQueryDebounced.value.asc,
    })
    if (!r.ok) {
      usersError.value = `用户表接口异常：${r.status} ${r.error}${r.detail ? ' · ' + r.detail : ''}`
      usersList.value = []
      usersTotal.value = 0
      return
    }
    usersList.value = r.data.users
    usersTotal.value = r.data.total
    usersMeta.value = r.data.meta ?? null
  } catch (e) {
    usersError.value = `用户表网络异常：${(e as Error)?.message ?? String(e)}`
  } finally {
    usersLoading.value = false
  }
}

const userDetailOpen = ref(false)
const userDetailSelected = ref<AdminUserRow | null>(null)
function openUserDetail(row: AdminUserRow) {
  userDetailSelected.value = row
  userDetailOpen.value = true
}
function clearSearch() {
  userQuery.q = ''
}

// ============== /admin/active ==============
const activeLoading = ref(false)
const activeSummary = ref<{
  windowDays: number
  bucket: ActiveBucket
  totalActiveInWindow: number
  totalLoginsInWindow: number
  newUsersInWindow: number
} | null>(null)
const activeTrend = ref<ActiveTrendPoint[]>([])
const activeRecent = ref<ActiveRecent[]>([])
const activeRetention = ref<{ d1: number; d7: number; d30: number }>({ d1: 0, d7: 0, d30: 0 })

const activeQuery = reactive({
  days: 30 as number,
  bucket: 'day' as ActiveBucket,
})

async function loadActive() {
  activeLoading.value = true
  activeError.value = null
  try {
    const r = await getAdminActive({ days: activeQuery.days, bucket: activeQuery.bucket })
    if (!r.ok) {
      activeError.value = `活跃度接口异常：${r.status} ${r.error}${r.detail ? ' · ' + r.detail : ''}`
      return
    }
    activeSummary.value = r.data.summary
    activeTrend.value = r.data.trend
    activeRecent.value = r.data.recent
    activeRetention.value = r.data.retention
    activeMeta.value = r.data.meta ?? null
  } catch (e) {
    activeError.value = `活跃度网络异常：${(e as Error)?.message ?? String(e)}`
  } finally {
    activeLoading.value = false
  }
}

// 趋势自绘 SVG
const trendChart = computed(() => {
  const pts = activeTrend.value
  const W = 720
  const H = 220
  const PAD_L = 36
  const PAD_R = 12
  const PAD_T = 16
  const PAD_B = 28
  if (!pts.length) {
    return { width: W, height: H, bars: [] as { x: number; w: number; h: number; v: number; label: string; bucket: string }[], xLabels: [] as { x: number; label: string }[], yMax: 0 }
  }
  const yMax = Math.max(1, ...pts.map((p) => p.activeUsers))
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const slotW = innerW / pts.length
  const barW = Math.max(2, slotW * 0.6)
  const bars = pts.map((p, i) => {
    const x = PAD_L + i * slotW + (slotW - barW) / 2
    const h = innerH * (p.activeUsers / yMax)
    return { x, w: barW, h, v: p.activeUsers, label: p.bucket, bucket: p.bucket }
  })
  // x 轴标签：均匀取 6 个
  const labelStep = Math.max(1, Math.floor(pts.length / 6))
  const xLabels: { x: number; label: string }[] = []
  for (let i = 0; i < pts.length; i += labelStep) {
    const x = PAD_L + i * slotW + slotW / 2
    const raw = pts[i]?.bucket ?? ''
    // bucket 形如 2026-09-10 / 2026-09 / 2026-09-08；只显示月-日 / 月 段
    const short = raw.length > 7 ? raw.slice(5) : raw
    xLabels.push({ x, label: short })
  }
  return { width: W, height: H, bars, xLabels, yMax }
})

// ============== /admin/leaderboard ==============
const leaderboardLoading = ref(false)
const leaderboardItems = ref<LeaderboardItem[]>([])
const leaderboardQuery = reactive({
  by: 'course' as LeaderboardBy,
  limit: 20,
})

async function loadLeaderboard() {
  leaderboardLoading.value = true
  leaderboardError.value = null
  try {
    const r = await getAdminLeaderboard({ by: leaderboardQuery.by, limit: leaderboardQuery.limit })
    if (!r.ok) {
      leaderboardError.value = `热度榜接口异常：${r.status} ${r.error}${r.detail ? ' · ' + r.detail : ''}`
      return
    }
    leaderboardItems.value = r.data.items
    leaderboardMeta.value = r.data.meta ?? null
  } catch (e) {
    leaderboardError.value = `热度榜网络异常：${(e as Error)?.message ?? String(e)}`
  } finally {
    leaderboardLoading.value = false
  }
}

// ============== /admin/logins ==============
const loginsLoading = ref(false)
const loginsSummary = ref<{
  totalLogins: number
  distinctUsers: number
  distinctIps: number
  distinctOs: number
  distinctVersions: number
  sinceDays: number
} | null>(null)
const loginsTopIps = ref<LoginCountItem[]>([])
const loginsTopOs = ref<LoginCountItem[]>([])
const loginsTopVersions = ref<LoginCountItem[]>([])
const loginsRecent = ref<ActiveRecent[]>([])

const loginsQuery = reactive({
  sinceDays: 30 as number,
  limit: 100,
})

async function loadLogins() {
  loginsLoading.value = true
  loginsError.value = null
  try {
    const r = await getAdminLogins({ sinceDays: loginsQuery.sinceDays, limit: loginsQuery.limit })
    if (!r.ok) {
      loginsError.value = `登录审计接口异常：${r.status} ${r.error}${r.detail ? ' · ' + r.detail : ''}`
      return
    }
    loginsSummary.value = r.data.summary
    loginsTopIps.value = r.data.topIps
    loginsTopOs.value = r.data.topOs
    loginsTopVersions.value = r.data.topVersions
    loginsRecent.value = r.data.recent
    loginsMeta.value = r.data.meta ?? null
  } catch (e) {
    loginsError.value = `登录审计网络异常：${(e as Error)?.message ?? String(e)}`
  } finally {
    loginsLoading.value = false
  }
}

// ============== 整体刷新（按当前 tab 只刷当前 + 必要依赖）==============
async function refreshAll() {
  anyLoading.value = true
  try {
    // 始终拉 4 个（很轻；任意失败不影响其他）
    await Promise.allSettled([loadUsers(), loadActive(), loadLeaderboard(), loadLogins()])
    if (!usersError.value && !activeError.value && !leaderboardError.value && !loginsError.value) {
      lastFetched.value = new Date().toLocaleString('zh-CN', { hour12: false })
    }
  } finally {
    anyLoading.value = false
  }
}

onMounted(refreshAll)

// 切 tab 时，如果该 tab 数据为空则拉一次（避免用户切到空 tab）
watch(activeTab, (k) => {
  if (k === 'users' && usersList.value.length === 0 && !usersLoading.value) void loadUsers()
  if (k === 'active' && activeTrend.value.length === 0 && !activeLoading.value) void loadActive()
  if (k === 'leaderboard' && leaderboardItems.value.length === 0 && !leaderboardLoading.value) void loadLeaderboard()
  if (k === 'logins' && loginsRecent.value.length === 0 && !loginsLoading.value) void loadLogins()
})
</script>

<template>
  <div class="h-full overflow-y-auto dark-page p-6">
    <header class="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-dark-title">🛡 管理员后台</h1>
        <p class="text-sm text-dark-soft">
          注册用户 · 活跃度 · 课程热度 · 登录审计
          <span v-if="lastFetched" class="ml-2 text-xs text-dark-ghost">
            最近更新 {{ lastFetched }}
          </span>
        </p>
      </div>
      <div class="flex shrink-0 gap-2">
        <button class="btn-dark-ghost" :disabled="anyLoading" @click="refreshAll">
          <span v-if="!anyLoading">🔄 刷新全部</span>
          <span v-else>刷新中…</span>
        </button>
      </div>
    </header>

    <!-- Tab 切换 -->
    <div class="mb-4">
      <el-segmented
        v-model="activeTab"
        :options="TAB_OPTIONS.map((t) => ({ label: `${t.icon} ${t.label}`, value: t.key }))"
        size="large"
        class="admin-tab"
      />
    </div>

    <!-- 降级提示 -->
    <div
      v-if="degradedKeys.length > 0"
      class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
    >
      ⚠️ 部分数据不可用：{{ degradedHint(degradedKeys) }}。
      <span v-if="!loginEventsAvailable">
        可能原因：<code class="font-mono">login_events</code> 表未创建（Supabase 没跑 <code class="font-mono">20260910090000_login_events.sql</code>），或 RLS 策略把 service_role 也拒了。
      </span>
      <span v-else>其它数据正常。</span>
    </div>

    <!-- 错误提示：每块独立展示 -->
    <div
      v-if="usersError || activeError || leaderboardError || loginsError"
      class="mb-4 space-y-1"
    >
      <div
        v-if="usersError"
        class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
      >
        <span class="font-mono text-xs">[用户]</span> {{ usersError }}
        <button class="ml-2 text-xs underline" @click="loadUsers">重试</button>
      </div>
      <div
        v-if="activeError"
        class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
      >
        <span class="font-mono text-xs">[活跃度]</span> {{ activeError }}
        <button class="ml-2 text-xs underline" @click="loadActive">重试</button>
      </div>
      <div
        v-if="leaderboardError"
        class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
      >
        <span class="font-mono text-xs">[热度榜]</span> {{ leaderboardError }}
        <button class="ml-2 text-xs underline" @click="loadLeaderboard">重试</button>
      </div>
      <div
        v-if="loginsError"
        class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
      >
        <span class="font-mono text-xs">[登录审计]</span> {{ loginsError }}
        <button class="ml-2 text-xs underline" @click="loadLogins">重试</button>
      </div>
    </div>

    <!-- ============== Tab 1: 用户 ============== -->
    <section v-show="activeTab === 'users'">
      <!-- 筛选条 -->
      <div class="glass-card mb-4 p-4">
        <div class="flex flex-wrap items-center gap-3">
          <el-input
            v-model="userQuery.q"
            placeholder="搜索邮箱 / uid 前缀"
            clearable
            class="!w-72"
            @keyup.enter="() => { usersQueryDebounced = { ...userQuery } }"
            @clear="clearSearch"
          >
            <template #prefix>🔍</template>
          </el-input>
          <el-select
            v-model="userQuery.method"
            placeholder="登录方式"
            clearable
            class="!w-32"
          >
            <el-option label="全部方式" value="" />
            <el-option label="OTP" value="otp-verify" />
            <el-option label="密码" value="password-login" />
            <el-option label="注册" value="register" />
          </el-select>
          <el-select
            v-model="userQuery.sinceDays"
            placeholder="活跃时间"
            clearable
            class="!w-36"
          >
            <el-option label="全部" :value="0" />
            <el-option label="近 1 天" :value="1" />
            <el-option label="近 7 天" :value="7" />
            <el-option label="近 30 天" :value="30" />
          </el-select>
          <el-select
            v-model="userQuery.order"
            placeholder="排序字段"
            class="!w-40"
          >
            <el-option label="首次出现时间" value="first_seen_at" />
            <el-option label="最近登录时间" value="last_login_at" />
            <el-option label="宝贝数" value="child_count" />
            <el-option label="课程数" value="course_count" />
            <el-option label="打卡数" value="checkin_count" />
          </el-select>
          <el-tooltip :content="userQuery.asc ? '升序' : '降序'" placement="top">
            <button
              class="btn-dark-ghost"
              type="button"
              style="padding: 6px 10px; min-width: 36px;"
              @click="userQuery.asc = !userQuery.asc"
            >
              {{ userQuery.asc ? '↑' : '↓' }}
            </button>
          </el-tooltip>
          <div class="flex-1" />
          <span class="text-xs text-dark-soft">
            共 <b class="text-dark-title">{{ usersTotal }}</b> 个用户
            <span v-if="usersTotal > usersList.length" class="ml-1 text-dark-ghost">
              （展示前 {{ usersList.length }}）
            </span>
          </span>
        </div>
      </div>

      <!-- 用户表 -->
      <div class="glass-card p-5">
        <el-table
          v-loading="usersLoading"
          :data="usersList"
          stripe
          max-height="640"
          row-class-name="admin-row-clickable"
          @row-click="openUserDetail"
        >
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
          <el-table-column label="UID" min-width="140">
            <template #default="{ row }">
              <code class="select-all break-all text-xs" style="color: var(--text-body);">{{ row.uid }}</code>
            </template>
          </el-table-column>
          <el-table-column label="首次出现" width="160">
            <template #default="{ row }">
              <span class="text-xs" style="color: var(--text-body);">{{ formatTime(row.firstSeenAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="宝贝" width="70" align="center">
            <template #default="{ row }">
              <el-tag :type="row.childCount > 0 ? 'success' : 'info'" effect="plain" round size="small">
                {{ row.childCount }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="课程" width="70" align="center">
            <template #default="{ row }">
              <el-tag :type="row.courseCount > 0 ? 'warning' : 'info'" effect="plain" round size="small">
                {{ row.courseCount }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="打卡" width="70" align="center">
            <template #default="{ row }">
              <el-tag :type="row.checkinCount > 0 ? 'primary' : 'info'" effect="plain" round size="small">
                {{ row.checkinCount }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="IP" width="110">
            <template #default="{ row }">
              <code
                v-if="row.lastIp"
                class="select-all break-all text-xs"
                style="color: var(--text-body);"
                :title="`窗口内 ${row.distinctIpCount} 个不同 IP`"
              >{{ row.lastIp }}</code>
              <span v-else class="text-xs text-dark-ghost">—</span>
            </template>
          </el-table-column>
          <el-table-column label="设备" width="140">
            <template #default="{ row }">
              <span v-if="row.lastOs || row.lastArch" class="text-xs" style="color: var(--text-body);">
                {{ row.lastOs || '未知' }}<span v-if="row.lastArch" class="text-dark-ghost"> / {{ row.lastArch }}</span>
              </span>
              <span v-else class="text-xs text-dark-ghost">—</span>
            </template>
          </el-table-column>
          <el-table-column label="客户端" width="150">
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
          <el-table-column label="最近登录" width="160">
            <template #default="{ row }">
              <span class="text-xs" style="color: var(--text-body);">{{ formatTime(row.lastLoginAt) }}</span>
            </template>
          </el-table-column>
          <template #empty>
            <div class="py-6 text-center text-sm text-dark-soft">
              <p v-if="usersError">用户表加载失败，{{ usersError }}</p>
              <p v-else-if="!usersLoading && usersTotal === 0">暂无注册用户（业务表都为空）</p>
              <p v-else>—</p>
            </div>
          </template>
        </el-table>
        <p class="mt-2 text-center text-[10px] text-dark-ghost">点击行查看用户详情</p>
      </div>
    </section>

    <!-- ============== Tab 2: 活跃度 ============== -->
    <section v-show="activeTab === 'active'">
      <!-- 窗口 + 桶选择 -->
      <div class="glass-card mb-4 p-4">
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm font-medium" style="color: var(--text-body);">窗口：</span>
          <el-segmented
            v-model="activeQuery.days"
            :options="[
              { label: '近 7 天', value: 7 },
              { label: '近 30 天', value: 30 },
              { label: '近 90 天', value: 90 },
            ]"
            @change="loadActive"
          />
          <span class="ml-4 text-sm font-medium" style="color: var(--text-body);">分桶：</span>
          <el-segmented
            v-model="activeQuery.bucket"
            :options="[
              { label: '按日', value: 'day' },
              { label: '按周', value: 'week' },
              { label: '按月', value: 'month' },
            ]"
            @change="loadActive"
          />
        </div>
      </div>

      <!-- 汇总 + 留存 -->
      <div class="mb-4 grid grid-cols-2 gap-4 md:grid-cols-5">
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">窗口内活跃用户</p>
          <p class="mt-1 text-2xl font-extrabold text-brand">{{ activeSummary?.totalActiveInWindow ?? '—' }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">窗口内总登录</p>
          <p class="mt-1 text-2xl font-extrabold text-dark-title">{{ activeSummary?.totalLoginsInWindow ?? '—' }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">窗口内新增用户</p>
          <p class="mt-1 text-2xl font-extrabold text-dark-title">{{ activeSummary?.newUsersInWindow ?? '—' }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">1 日回访率</p>
          <p class="mt-1 text-2xl font-extrabold text-dark-title">
            {{ activeRetention.d1 ? (activeRetention.d1 * 100).toFixed(1) + '%' : '—' }}
          </p>
        </div>
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">7 日回访率</p>
          <p class="mt-1 text-2xl font-extrabold text-dark-title">
            {{ activeRetention.d7 ? (activeRetention.d7 * 100).toFixed(1) + '%' : '—' }}
          </p>
        </div>
      </div>

      <!-- 趋势图（自绘 SVG） -->
      <div class="glass-card mb-4 p-5">
        <h3 class="mb-2 font-bold text-dark-title">活跃用户趋势</h3>
        <p class="mb-3 text-xs text-dark-soft">
          每个时间桶的独立活跃用户数（登录过的去重 owner_id 数）
        </p>
        <div v-if="activeLoading && !activeTrend.length" class="py-10 text-center text-sm text-dark-soft">加载中…</div>
        <div v-else-if="!activeTrend.length" class="py-10 text-center text-sm text-dark-soft">窗口内暂无数据</div>
        <div v-else class="admin-trend-wrap">
          <svg
            :viewBox="`0 0 ${trendChart.width} ${trendChart.height}`"
            preserveAspectRatio="xMidYMid meet"
            class="admin-trend-svg"
          >
            <!-- y 轴参考线 -->
            <line
              v-for="i in 4"
              :key="`grid-${i}`"
              :x1="36"
              :x2="trendChart.width - 12"
              :y1="16 + ((trendChart.height - 16 - 28) * i) / 4"
              :y2="16 + ((trendChart.height - 16 - 28) * i) / 4"
              stroke="rgba(255,255,255,0.06)"
              stroke-dasharray="3 3"
            />
            <!-- y 轴顶部刻度 -->
            <text
              v-for="i in 5"
              :key="`yt-${i}`"
              x="32"
              :y="16 + ((trendChart.height - 16 - 28) * (i - 1)) / 4 + 4"
              text-anchor="end"
              font-size="10"
              fill="rgba(255,255,255,0.5)"
            >{{ Math.round(trendChart.yMax * (1 - (i - 1) / 4)) }}</text>
            <!-- bar -->
            <g v-for="b in trendChart.bars" :key="b.label">
              <rect
                :x="b.x"
                :y="trendChart.height - 28 - b.h"
                :width="b.w"
                :height="b.h"
                rx="2"
                fill="rgba(63,184,122,0.7)"
              >
                <title>{{ b.label }} · 活跃 {{ b.v }} 人</title>
              </rect>
            </g>
            <!-- x 轴标签 -->
            <g v-for="(xl, i) in trendChart.xLabels" :key="`xl-${i}`">
              <text
                :x="xl.x"
                :y="trendChart.height - 10"
                text-anchor="middle"
                font-size="10"
                fill="rgba(255,255,255,0.55)"
              >{{ xl.label }}</text>
            </g>
          </svg>
        </div>
      </div>

      <!-- 最近登录事件流 -->
      <div class="glass-card p-5">
        <h3 class="mb-3 font-bold text-dark-title">最近登录事件流（最新 {{ activeRecent.length }} 条）</h3>
        <el-table :data="activeRecent.slice(0, 50)" stripe max-height="420" size="small">
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="邮箱" min-width="180">
            <template #default="{ row }">
              <span class="text-xs">{{ row.email || '(无)' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="IP" width="130">
            <template #default="{ row }">
              <code v-if="row.ip" class="text-xs">{{ row.ip }}</code>
              <span v-else class="text-xs text-dark-ghost">—</span>
            </template>
          </el-table-column>
          <el-table-column label="设备" width="140">
            <template #default="{ row }">
              <span v-if="row.os || row.arch" class="text-xs">{{ row.os || '?' }}<span v-if="row.arch"> / {{ row.arch }}</span></span>
              <span v-else class="text-xs text-dark-ghost">—</span>
            </template>
          </el-table-column>
          <el-table-column label="客户端" width="110">
            <template #default="{ row }">
              <span class="text-xs">v{{ row.appVersion || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="方式" width="70" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" round>{{ authMethodShort(row.authMethod) }}</el-tag>
            </template>
          </el-table-column>
          <template #empty>
            <div class="py-6 text-center text-sm text-dark-soft">暂无登录事件</div>
          </template>
        </el-table>
        <p v-if="activeRecent.length > 50" class="mt-2 text-center text-[10px] text-dark-ghost">
          仅展示前 50 条，登录审计 Tab 可看到完整 {{ loginsQuery.limit }} 条
        </p>
      </div>
    </section>

    <!-- ============== Tab 3: 热度榜 ============== -->
    <section v-show="activeTab === 'leaderboard'">
      <div class="glass-card mb-4 p-4">
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm font-medium" style="color: var(--text-body);">维度：</span>
          <el-segmented
            v-model="leaderboardQuery.by"
            :options="[
              { label: '课程名', value: 'course' },
              { label: '机构', value: 'institution' },
            ]"
            @change="loadLeaderboard"
          />
          <span class="ml-4 text-sm font-medium" style="color: var(--text-body);">TOP</span>
          <el-select v-model="leaderboardQuery.limit" class="!w-24" @change="loadLeaderboard">
            <el-option label="10" :value="10" />
            <el-option label="20" :value="20" />
            <el-option label="50" :value="50" />
            <el-option label="100" :value="100" />
          </el-select>
        </div>
      </div>

      <div class="glass-card p-5">
        <h3 class="mb-3 font-bold text-dark-title">
          🏷 跨用户{{ leaderboardQuery.by === 'institution' ? '机构' : '课程名' }}热度榜
        </h3>
        <p class="mb-3 text-xs text-dark-soft">按独立用户数倒序；相同用户数再按出现次数。</p>
        <el-table v-loading="leaderboardLoading" :data="leaderboardItems" stripe max-height="640" size="small">
          <el-table-column label="#" width="50" type="index" />
          <el-table-column :label="leaderboardQuery.by === 'institution' ? '机构' : '课程名'" min-width="220">
            <template #default="{ row }">
              <span class="text-sm font-medium text-dark-title">{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="独立用户" width="100" align="center">
            <template #default="{ row }">
              <el-tag type="success" effect="plain" round>{{ row.ownerCount }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="课程数" width="100" align="center">
            <template #default="{ row }">
              <el-tag type="warning" effect="plain" round>{{ row.count }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="总投入 (¥)" width="120" align="right">
            <template #default="{ row }">
              <span class="text-sm tabular-nums">{{ row.totalAmount.toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="总课时" width="100" align="right">
            <template #default="{ row }">
              <span class="text-sm tabular-nums">{{ row.totalHours.toFixed(1) }}</span>
            </template>
          </el-table-column>
          <template #empty>
            <div class="py-6 text-center text-sm text-dark-soft">
              <p v-if="leaderboardError">加载失败，{{ leaderboardError }}</p>
              <p v-else-if="!leaderboardLoading">暂无数据</p>
              <p v-else>—</p>
            </div>
          </template>
        </el-table>
      </div>
    </section>

    <!-- ============== Tab 4: 登录审计 ============== -->
    <section v-show="activeTab === 'logins'">
      <div class="glass-card mb-4 p-4">
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm font-medium" style="color: var(--text-body);">窗口：</span>
          <el-segmented
            v-model="loginsQuery.sinceDays"
            :options="[
              { label: '近 7 天', value: 7 },
              { label: '近 30 天', value: 30 },
              { label: '近 90 天', value: 90 },
            ]"
            @change="loadLogins"
          />
        </div>
      </div>

      <!-- 关键数字 -->
      <div v-if="loginsSummary" class="mb-4 grid grid-cols-2 gap-4 md:grid-cols-5">
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">窗口内总登录</p>
          <p class="mt-1 text-2xl font-extrabold text-brand">{{ loginsSummary.totalLogins }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">独立用户</p>
          <p class="mt-1 text-2xl font-extrabold text-dark-title">{{ loginsSummary.distinctUsers }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">独立 IP</p>
          <p class="mt-1 text-2xl font-extrabold text-dark-title">{{ loginsSummary.distinctIps }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">独立 OS</p>
          <p class="mt-1 text-2xl font-extrabold text-dark-title">{{ loginsSummary.distinctOs }}</p>
        </div>
        <div class="glass-card p-4">
          <p class="text-[10px] text-dark-soft">独立 App 版本</p>
          <p class="mt-1 text-2xl font-extrabold text-dark-title">{{ loginsSummary.distinctVersions }}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <!-- IP TOP -->
        <div class="glass-card p-5">
          <h3 class="mb-3 font-bold text-dark-title">🌐 IP TOP 20</h3>
          <el-table v-loading="loginsLoading" :data="loginsTopIps" stripe size="small" max-height="380">
            <el-table-column label="IP" min-width="140">
              <template #default="{ row }">
                <code class="break-all text-xs">{{ row.name }}</code>
              </template>
            </el-table-column>
            <el-table-column label="次数" width="60" align="right">
              <template #default="{ row }">
                <el-tag type="primary" effect="plain" round size="small">{{ row.count }}</el-tag>
              </template>
            </el-table-column>
            <template #empty><div class="py-4 text-center text-xs text-dark-soft">暂无</div></template>
          </el-table>
        </div>

        <!-- OS TOP -->
        <div class="glass-card p-5">
          <h3 class="mb-3 font-bold text-dark-title">💻 设备 TOP 20</h3>
          <el-table v-loading="loginsLoading" :data="loginsTopOs" stripe size="small" max-height="380">
            <el-table-column label="OS / Arch" min-width="160">
              <template #default="{ row }">
                <span class="text-xs">{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="次数" width="60" align="right">
              <template #default="{ row }">
                <el-tag type="warning" effect="plain" round size="small">{{ row.count }}</el-tag>
              </template>
            </el-table-column>
            <template #empty><div class="py-4 text-center text-xs text-dark-soft">暂无</div></template>
          </el-table>
        </div>

        <!-- Version TOP -->
        <div class="glass-card p-5">
          <h3 class="mb-3 font-bold text-dark-title">📦 App 版本 TOP 20</h3>
          <el-table v-loading="loginsLoading" :data="loginsTopVersions" stripe size="small" max-height="380">
            <el-table-column label="版本" min-width="120">
              <template #default="{ row }">
                <span class="text-xs">v{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="次数" width="60" align="right">
              <template #default="{ row }">
                <el-tag type="success" effect="plain" round size="small">{{ row.count }}</el-tag>
              </template>
            </el-table-column>
            <template #empty><div class="py-4 text-center text-xs text-dark-soft">暂无</div></template>
          </el-table>
        </div>
      </div>

      <!-- 最近登录流 -->
      <div class="glass-card mt-4 p-5">
        <h3 class="mb-3 font-bold text-dark-title">最近 {{ loginsRecent.length }} 条登录</h3>
        <el-table :data="loginsRecent" stripe size="small" max-height="420">
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="邮箱" min-width="180">
            <template #default="{ row }"><span class="text-xs">{{ row.email || '(无)' }}</span></template>
          </el-table-column>
          <el-table-column label="IP" width="130">
            <template #default="{ row }">
              <code v-if="row.ip" class="text-xs">{{ row.ip }}</code>
              <span v-else class="text-xs text-dark-ghost">—</span>
            </template>
          </el-table-column>
          <el-table-column label="设备" width="140">
            <template #default="{ row }">
              <span v-if="row.os || row.arch" class="text-xs">{{ row.os || '?' }}<span v-if="row.arch"> / {{ row.arch }}</span></span>
              <span v-else class="text-xs text-dark-ghost">—</span>
            </template>
          </el-table-column>
          <el-table-column label="客户端" width="100">
            <template #default="{ row }"><span class="text-xs">v{{ row.appVersion || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="方式" width="70" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" round>{{ authMethodShort(row.authMethod) }}</el-tag>
            </template>
          </el-table-column>
          <template #empty><div class="py-6 text-center text-sm text-dark-soft">暂无登录事件</div></template>
        </el-table>
      </div>
    </section>

    <!-- 详情抽屉（任意 tab 都能打开，挂在 root） -->
    <UserDetailDrawer
      v-model="userDetailOpen"
      :user="userDetailSelected"
    />
  </div>
</template>

<style scoped>
.admin-tab {
  /* Segmented 容器靠色变量撑开（dark-page 主题感知） */
}
.admin-trend-wrap {
  width: 100%;
  overflow-x: auto;
}
.admin-trend-svg {
  width: 100%;
  height: 220px;
  display: block;
}
:deep(.admin-row-clickable) {
  cursor: pointer;
}
:deep(.admin-row-clickable:hover > td) {
  background: rgba(63, 184, 122, 0.08) !important;
}
</style>
