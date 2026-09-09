<script setup lang="ts">
/**
 * App.vue —— 顶层组件
 *
 * 启动期由 main.ts 完成 auth.bootstrap()，App.vue 主要负责挂业务数据
 *
 * 关键：watch auth.isAuthenticated，登录态变化时主动 load children
 * （App.vue 在登录时已经挂载，onMounted 不会再跑）
 */
import { onMounted, computed, ref, watch, h } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import AppLayout from '@/components/common/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useDBStore } from '@/stores/db'
import { useChildrenStore } from '@/stores/children'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'
import { useThemeStore } from '@/stores/theme'
import { useUpdateStore } from '@/stores/update'

const route = useRoute()
const auth = useAuthStore()
const db = useDBStore()
const children = useChildrenStore()
const courses = useCoursesStore()
const checkins = useCheckinsStore()
const theme = useThemeStore()
const updateStore = useUpdateStore()

const isLoginPage = computed(() => route.name === 'login')
const initError = ref<string | null>(null)
// 默认 true：登录后立即进入“内容区同步中”态，避免先闪一帧空页面再切 loading
const initializing = ref(true)
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
      // 主题跟用户绑定:登录后从云端同步一次(多设备保持一致)
      // 跟 children 并行,不顺延启动
      void theme.syncFromCloud()
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
 * 统一策略（NSIS 和 portable 走同一条路）：
 *   主进程把 .exe 下到 %TEMP%\TimeWell-update\ → 推 localPath → 渲染端弹
 *   "打开安装包"按钮（NSIS 装包）或"打开安装包"按钮（portable 替换运行）。
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
    // 同步远端版本到 store（Settings.vue / 侧栏底部展示用）
    updateStore.latestVersion = info.version
    if (isDismissed(info.version)) return

    const mode = info.mode ?? 'portable' // 老主进程没带 mode → 当 portable 处理（最安全）

    void ElMessageBox.confirm(
      `当前版本 v${info.currentVersion}，发现新版本 v${info.version}。\n\n点击「立即更新」后会自动下载到本地，下载完成后双击安装即可。`,
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
        // 统一调主进程下到 %TEMP%；NSIS 选 installer，portable 选 portable
        void window.updater!.startManualDownload(info, mode === 'nsis' ? 'fallback' : 'portable')
      })
      .catch(() => {
        rememberDismiss(info.version)
      })
  })

  // ---- 进度（单例 + 节流，避免堆 N 条 ElMessage） ----
  // 主进程下载回调频率很高（~每秒十几到几十次），直接 ElMessage 必堆。
  // 改成：节流到 200ms，第一次建一条带 CSS 进度条的 Notification，
  // 后续只更新同一条 vnode 的 innerHTML；下载完成/失败时主动关掉。
  type ProgressRef = { close: () => void; setHtml: (html: string) => void }
  let progressNotif: ProgressRef | null = null
  let lastProgressUpdate = 0
  window.updater.onUpdateProgress((p) => {
    if (p.percent >= 100) return
    const now = Date.now()
    // 节流：200ms 内不重复刷新 DOM（人眼分辨 5fps 足够）
    if (progressNotif && now - lastProgressUpdate < 200) return
    lastProgressUpdate = now

    const percent = Math.max(0, Math.min(100, p.percent))
    const transferred = formatBytes(p.transferred)
    const total = formatBytes(p.total)
    const html = renderProgressHtml(percent, transferred, total)

    // 首次：建一条长驻 Notification（vnode 内放 div，用 innerHTML 写入进度条）
    if (!progressNotif) {
      const root = document.createElement('div')
      root.className = 'updater-progress-root'
      root.innerHTML = html
      progressNotif = createProgressNotif(root)
      return
    }
    // 后续：直接更新同一份 DOM（不重建 Notification）
    progressNotif.setHtml(html)
  })

  // ---- 下载完成 ----
  window.updater.onUpdateDownloaded((d) => {
    // 关掉进度条 Notification
    progressNotif?.close()
    progressNotif = null
    // 统一路径：提示用户打开本地 .exe（NSIS 装包 / portable 替换都是它）
    if (!d.localPath) {
      ElMessage({ message: '下载完成但未拿到本地路径，请重试或去 GitHub 下载。', type: 'error', duration: 0, showClose: true })
      return
    }
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
  })

  // ---- 错误（带 fallback 信息） ----
  window.updater.onUpdateError((e) => {
    // 关掉进度条 Notification
    progressNotif?.close()
    progressNotif = null
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

/**
 * 渲染进度条 HTML（避免依赖 Vue runtime，把进度条直接画成原生 HTML）
 * - 顶部一行：百分比 + 已传/总大小
 * - 下方：CSS 渐变进度条，按 percent 走
 */
function renderProgressHtml(percent: number, transferred: string, total: string): string {
  const pct = percent.toFixed(1)
  return `
    <div class="updater-progress-row">
      <span class="updater-progress-pct">${pct}%</span>
      <span class="updater-progress-size">${transferred} / ${total}</span>
    </div>
    <div class="updater-progress-track">
      <div class="updater-progress-bar" style="width: ${pct}%"></div>
    </div>
  `
}

/**
 * 创建一条长驻的 ElNotification，里面是一个 div 容器，进度回调通过 setHtml 改 innerHTML。
 * 返回 close / setHtml 供后续节流更新。
 *
 * 为什么不直接用 VNode + ref：Element Plus 内部对 message vnode 的 ref 钩子调用时序
 * 不可靠（不同时机下 hostRef 可能为 null），导致 root 永远塞不进去 → 进度条完全看不到。
 * 改用 setTimeout 0 + document.querySelector 拿 .el-notification__content，时序确定。
 */
function createProgressNotif(root: HTMLDivElement): { close: () => void; setHtml: (html: string) => void } {
  const handler = ElNotification({
    title: '正在下载新版本',
    message: h('div'),
    type: 'info',
    duration: 0,         // 不自动关，等下载完成或失败
    showClose: true,
    position: 'bottom-right',
    customClass: 'updater-progress',
  })
  // 等 Notification 挂到 DOM（下一 macrotask 时机最稳）后把 root 塞进 content 容器
  setTimeout(() => {
    const content = document.querySelector(
      '.updater-progress .el-notification__content',
    ) as HTMLDivElement | null
    if (content) {
      content.innerHTML = ''
      content.appendChild(root)
    } else {
      // 兜底：拿不到容器时降级为 body append（至少用户能看见）
      document.body.appendChild(root)
    }
  }, 0)
  return {
    close: () => handler.close(),
    setHtml: (html: string) => {
      if (root) root.innerHTML = html
    },
  }
}

onMounted(() => {
  registerUpdater()
  // 拉当前版本到 store（Settings.vue / 关于卡展示用）
  void updateStore.loadCurrentVersion()
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
    <!-- 登录后同步业务数据：loading 只占内容区，侧栏立即可见（不再全屏盖白） -->
    <div v-if="initializing" class="content-splash">
      <div class="glass-card content-loading-card">
        <div class="loading-orb">🌱</div>
        <p class="loading-title">正在同步你的数据…</p>
        <p class="loading-sub">宝贝档案 · 课程 · 打卡记录</p>
      </div>
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
/* 启动兜底（未登录且非登录页的极短过渡帧）：暗色，不闪白 */
.boot-splash {
  position: fixed;
  inset: 0;
  background: var(--text-on-primary);
}

/* 登录后同步业务数据：只盖内容区（AppLayout 的 main 需 position:relative），侧栏保持可见 */
.content-splash {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.content-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 36px 56px;
  animation: splash-card-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.loading-orb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  font-size: 26px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(63, 184, 122, 0.28) 0%, rgba(63, 184, 122, 0.1) 100%);
  border: 1px solid rgba(63, 184, 122, 0.35);
  box-shadow:
    0 8px 24px -6px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 var(--text-body);
  animation: orb-breathe 1.8s ease-in-out infinite;
}

.loading-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-title);
  letter-spacing: 0.02em;
}

.loading-sub {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
}

@keyframes splash-card-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes orb-breathe {
  0%, 100% {
    transform: scale(1);
    box-shadow:
      0 8px 24px -6px rgba(0, 0, 0, 0.5),
      0 0 0 0 rgba(63, 184, 122, 0.35),
      inset 0 1px 0 var(--text-body);
  }
  50% {
    transform: scale(1.05);
    box-shadow:
      0 8px 24px -6px rgba(0, 0, 0, 0.5),
      0 0 0 14px rgba(63, 184, 122, 0),
      inset 0 1px 0 var(--text-body);
  }
}

/* ====== 更新下载进度条 Notification（脱 scope，作用于 body 末端）====== */
:deep(.updater-progress) {
  min-width: 320px;
}
.updater-progress :deep(.el-notification__content) {
  margin-left: 0;
  padding: 0;
}
.updater-progress :deep(.el-notification__content),
.updater-progress .updater-progress-row,
.updater-progress .updater-progress-track,
.updater-progress .updater-progress-bar {
  /* 变量：用户主题色 */
  --bar-color: var(--brand, #3FB87A);
}
.updater-progress .updater-progress-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 13px;
  line-height: 1.4;
}
.updater-progress .updater-progress-pct {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-title);
}
.updater-progress .updater-progress-size {
  font-size: 12px;
  color: var(--text-soft);
  font-variant-numeric: tabular-nums;
}
.updater-progress .updater-progress-track {
  position: relative;
  width: 100%;
  height: 6px;
  background: rgba(63, 184, 122, 0.15);
  border-radius: 999px;
  overflow: hidden;
}
.updater-progress .updater-progress-bar {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  background: linear-gradient(90deg, #3FB87A 0%, #E08A1E 100%);
  border-radius: 999px;
  transition: width 0.15s linear;
  box-shadow: 0 0 8px rgba(63, 184, 122, 0.5);
}
</style>
