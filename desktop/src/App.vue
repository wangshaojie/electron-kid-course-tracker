<script setup lang="ts">
/**
 * App.vue —— CloudBase 版本
 *
 * 启动期由 main.ts 完成 auth.bootstrap()，App.vue 主要负责挂业务数据
 *
 * 关键：watch auth.isAuthenticated，登录态变化时主动 load children
 * （App.vue 在登录时已经挂载，onMounted 不会再跑）
 */
import { onMounted, computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppLayout from '@/components/common/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useDBStore } from '@/stores/db'
import { useChildrenStore } from '@/stores/children'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'

const route = useRoute()
const auth = useAuthStore()
const db = useDBStore()
const children = useChildrenStore()
const courses = useCoursesStore()
const checkins = useCheckinsStore()

const isLoginPage = computed(() => route.name === 'login')
const initError = ref<string | null>(null)
const initializing = ref(false)
let loadingPromise: Promise<void> | null = null

/**
 * 切换账号 / 登录前 —— 清空三个 store + 清 localStorage 残留
 * 不清空的话，新账号加载完成前 UI 还会显示前一个账号的数据
 */
function resetBusinessState() {
  try { localStorage.removeItem('kid_active_child_id') } catch { /* ignore */ }
  try { children.items.splice(0); children.activeId = ''; children.loaded = false } catch { /* ignore */ }
  try { courses.items.splice(0) } catch { /* ignore */ }
  try { checkins.items.splice(0) } catch { /* ignore */ }
}

async function loadBusinessData() {
  // 单飞：onMounted 和 watch 几乎同时触发时只跑一次
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    // 关键：先清空前一个账号的内存状态，再 load 新账号
    // 不然会出现"账号 A 退出 → 账号 B 登录 → 还看到 A 的数据"的 bug
    resetBusinessState()
    initializing.value = true
    initError.value = null
    try {
      await db.init()
      await children.load()
      if (children.activeIdSafe) {
        await Promise.all([courses.refresh(), checkins.refresh()])
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? '加载数据失败'
      initError.value = msg
      ElMessage.error(msg)
    } finally {
      initializing.value = false
    }
  })()
  try {
    await loadingPromise
  } finally {
    loadingPromise = null
  }
}

/**
 * 版本更新提醒：主进程查到新版本会通过 IPC 推过来。
 * 同版本只提醒一次（localStorage 记录），避免每次启动都弹。
 */
const UPDATER_DISMISS_KEY = 'update.dismissed'
function registerUpdater() {
  if (!window.updater) return
  window.updater.onUpdateAvailable((info) => {
    // eslint-disable-next-line no-console
    console.log('[updater] 收到新版本提醒', info.version)
    try {
      if (localStorage.getItem(UPDATER_DISMISS_KEY) === info.version) return
    } catch { /* ignore */ }
    ElMessageBox.confirm(
      `当前版本 v${info.currentVersion}，发现新版本 v${info.version}。\n\n是否前往 GitHub 下载页下载更新？`,
      '发现新版本',
      {
        confirmButtonText: '前往下载',
        cancelButtonText: '稍后再说',
        type: 'info',
        closeOnClickModal: false,
      },
    ).then(() => {
      void window.updater.openExternal(info.url)
    }).catch(() => {
      // 点了"稍后再说"或关闭 → 本次不再提醒（换新版本后才恢复）
      try { localStorage.setItem(UPDATER_DISMISS_KEY, info.version) } catch { /* ignore */ }
    })
  })
}

onMounted(() => {
  registerUpdater()
  if (auth.isAuthenticated) {
    void loadBusinessData()
  }
})

// 登录态从 false 变 true（用户刚登录）→ 重新加载业务数据
watch(
  () => auth.isAuthenticated,
  (now, prev) => {
    if (now && !prev) {
      void loadBusinessData()
    }
  },
)

// 关键：账号切换（uid 变了）→ 强制重载业务数据
// 不然从 A 账号直接登录 B 账号（不退出）时，children/courses store 还是 A 的
watch(
  () => auth.user?.uid ?? '',
  (now, prev) => {
    if (now && now !== prev) {
      void loadBusinessData()
    }
  },
)
</script>

<template>
  <router-view v-if="isLoginPage" />

  <AppLayout v-else-if="auth.isAuthenticated">
    <div v-if="initializing" class="splash">
      <div class="dot-pulse" />
      <p>正在从云端拉取数据…</p>
    </div>

    <router-view v-else v-slot="{ Component, route }">
      <transition name="route" mode="out-in" appear>
        <component :is="Component" :key="route.fullPath" />
      </transition>
    </router-view>
  </AppLayout>

  <div v-else class="boot-splash" />
</template>

<style scoped>
.boot-splash, .splash {
  position: fixed;
  inset: 0;
  background: #F7FAF8;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.splash p { color: #6b7280; font-size: 14px; }
.dot-pulse {
  width: 32px; height: 32px; border-radius: 50%;
  background: #3FB87A;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(0.6); opacity: 0.4; }
  50%      { transform: scale(1.0); opacity: 1.0; }
}
</style>
