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
 *
 * 三档策略（由主进程按安装形态决定）：
 *   nsis / nsis-fallback → 一键下载 + 自动安装 + 重启
 *   portable             → 下载到 %TEMP% → 弹"打开安装包"按钮
 * 失败时回退到"前往 GitHub 下载"。
 */
const UPDATER_DISMISS_KEY = 'update.dismissed'
function rememberDismiss(version: string) {
  try { localStorage.setItem(UPDATER_DISMISS_KEY, version) } catch { /* ignore */ }
}
function isDismissed(version: string): boolean {
  try { return localStorage.getItem(UPDATER_DISMISS_KEY) === version } catch { return false }
}

function registerUpdater() {
  if (!window.updater) return

  // ---- 收到"有新版本" ----
  window.updater.onUpdateAvailable((info) => {
    // eslint-disable-next-line no-console
    console.log('[updater] 收到新版本提醒', info.version, 'mode=', info.mode)
    if (isDismissed(info.version)) return

    const mode = info.mode ?? 'portable' // 老主进程没带 mode → 当 portable 处理（最安全）
    const isAuto = mode === 'nsis'

    void ElMessageBox.confirm(
      `当前版本 v${info.currentVersion}，发现新版本 v${info.version}。\n\n${
        isAuto
          ? '点击「立即更新」后会自动下载并安装，安装完成后自动重启。'
          : '点击「立即更新」后会自动下载到本地，下载完成后双击安装即可。'
      }`,
      '发现新版本',
      {
        confirmButtonText: '立即更新',
        cancelButtonText: '稍后再说',
        type: 'info',
        closeOnClickModal: false,
        closeOnPressEscape: false,
      },
    )
      .then(async () => {
        rememberDismiss(info.version)
        if (isAuto) {
          // NSIS 模式：直接调主进程触发下载 + 监听进度
          void window.updater!.startNsisDownload()
        } else {
          // portable / fallback：调主进程下到 %TEMP%
          void window.updater!.startManualDownload(info, mode === 'nsis-fallback' ? 'fallback' : 'portable')
        }
      })
      .catch(() => {
        rememberDismiss(info.version)
      })
  })

  // ---- 进度 ----
  window.updater.onUpdateProgress((p) => {
    if (p.percent >= 100) return
    // 用 Notification 风格提示
    ElMessage({
      message: `正在下载新版本… ${p.percent.toFixed(0)}% (${formatBytes(p.transferred)}/${formatBytes(p.total)})`,
      type: 'info',
      duration: 0,
      showClose: true,
      grouping: true,
    })
  })

  // ---- 下载完成 ----
  window.updater.onUpdateDownloaded((d) => {
    if (d.localPath) {
      // portable 模式：提示打开本地文件
      void ElMessageBox.confirm(
        `新版本 v${d.version} 已下载到本地。\n\n路径：${d.localPath}\n\n点击「打开安装包」立即启动安装；点击「稍后再说」保留在本地，下次需要时到该路径手动双击。`,
        '下载完成',
        {
          confirmButtonText: '打开安装包',
          cancelButtonText: '稍后再说',
          type: 'success',
          closeOnClickModal: false,
        },
      )
        .then(() => {
          void window.updater!.openLocalFile(d.localPath!)
        })
        .catch(() => { /* keep */ })
    } else {
      // NSIS 模式：提示重启安装
      void ElMessageBox.confirm(
        `新版本 v${d.version} 已下载完成。\n\n点击「立即重启并安装」会关闭当前应用并自动完成安装。`,
        '准备安装',
        {
          confirmButtonText: '立即重启并安装',
          cancelButtonText: '稍后再说（退出时安装）',
          type: 'success',
          closeOnClickModal: false,
        },
      )
        .then(() => {
          void window.updater!.installNsisUpdate()
        })
        .catch(() => { /* autoInstallOnAppQuit 已开启，退出时也会装 */ })
    }
  })

  // ---- 错误（带 fallback 信息） ----
  window.updater.onUpdateError((e) => {
    if (e.fallback === 'openExternal' && e.url) {
      void ElMessageBox.confirm(
        `自动更新失败：${e.message}\n\n是否打开 GitHub 下载页手动下载？`,
        '更新失败',
        {
          confirmButtonText: '前往下载',
          cancelButtonText: '取消',
          type: 'warning',
        },
      ).then(() => {
        void window.updater!.openExternal(e.url!)
      }).catch(() => { /* cancel */ })
    } else {
      ElMessage({ message: `更新失败：${e.message}`, type: 'error', duration: 0, showClose: true })
    }
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
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
