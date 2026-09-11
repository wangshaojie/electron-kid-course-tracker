/**
 * stores/update.ts —— 版本更新 store
 *
 * 暴露给 Settings.vue / AppLayout.vue 等组件：
 *  - currentVersion: 当前应用版本（启动时从主进程 package.json 读）
 *  - latestVersion:  远端最新版本（启动时自动 check；用户手动 check 后更新）
 *  - hasUpdate:      currentVersion !== latestVersion 且 latestVersion 非空
 *  - checking:       手动检测更新进行中
 *  - lastCheckAt:    上一次手动 check 的时间（null = 从未手动 check）
 *  - lastCheckResult: 'has-update' | 'up-to-date' | 'failed' | null
 *
 * 下载弹框（UpdateDialog.vue 消费）状态机 phase：
 *   idle → preparing（已点"立即更新"，主进程在拉 release/建连接）
 *        → downloading（收到第一份进度）
 *        → downloaded（.exe 落到 %TEMP%，等用户点"重启并安装"）
 *        → error（网络/asset 缺失，可重试或去 GitHub）
 *
 * IPC 监听挂在 bindUpdater() 里，App.vue 在 onMounted 时调一次
 * （返回解绑函数；避免每个组件都挂监听，也避免热更新时监听叠加）。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

export type ManualCheckResult = 'has-update' | 'up-to-date' | 'failed'

/** 下载弹框状态机 */
export type UpdatePhase = 'idle' | 'preparing' | 'downloading' | 'downloaded' | 'error'

/** 同版本只提醒一次（避免每次启动都弹） */
const DISMISS_KEY = 'update.dismissed'

export const useUpdateStore = defineStore('update', () => {
  const currentVersion = ref('')
  const latestVersion = ref('')
  const checking = ref(false)
  const lastCheckAt = ref<number | null>(null)
  const lastCheckResult = ref<ManualCheckResult | null>(null)

  // ================= 下载弹框状态 =================
  const phase = ref<UpdatePhase>('idle')
  /** 弹框是否可见（下载中可手动关掉让它后台跑，完成后会再次自动弹） */
  const dialogVisible = ref(false)
  /** 正在下载/安装的目标版本 */
  const targetVersion = ref('')
  const progress = ref({ percent: 0, transferred: 0, total: 0, speed: 0 })
  /** 下载好的 .exe 本地路径 */
  const localPath = ref('')
  const errorMessage = ref('')
  const errorUrl = ref('')
  /** 已点"重启并安装"，等主进程退出 */
  const restarting = ref(false)
  /** 主进程最后推过来的版本信息（Settings.vue 的"立即更新"按钮复用） */
  const pendingInfo = ref<UpdateInfoPayload | null>(null)

  /** 下载中（preparing + downloading） */
  const busy = computed(() => phase.value === 'preparing' || phase.value === 'downloading')

  /** 当前安装形态：nsis 装包 / portable 绿色版（决定重启安装怎么走） */
  let activeMode: 'nsis' | 'portable' = 'portable'
  /** 进度节流用（主进程回调频率很高，直接刷 ref 会打满渲染） */
  let lastProgressAt = 0
  let speedSample: { at: number; bytes: number } | null = null

  /** 启动时拉一次当前版本（主进程从 package.json 读，dev 也准） */
  async function loadCurrentVersion() {
    if (!window.updater?.getAppVersion) return
    try {
      currentVersion.value = await window.updater.getAppVersion()
    } catch {
      // 留空
    }
  }

  /** 主动检查更新，返回结果给调用方决定是否再弹 Toast */
  async function checkNow(): Promise<ManualCheckResult> {
    if (!window.updater?.manualCheck) return 'failed'
    if (checking.value) return lastCheckResult.value ?? 'failed'
    checking.value = true
    try {
      const r = await window.updater.manualCheck()
      lastCheckAt.value = Date.now()
      lastCheckResult.value = r
      if (r === 'has-update') {
        // update:available 事件会带最新版本过来，这里抢一个保守值
        latestVersion.value = latestVersion.value || '?'
      }
      return r
    } catch {
      lastCheckAt.value = Date.now()
      lastCheckResult.value = 'failed'
      return 'failed'
    } finally {
      checking.value = false
    }
  }

  function rememberDismiss(version: string) {
    try { localStorage.setItem(DISMISS_KEY, version) } catch { /* ignore */ }
  }
  function isDismissed(version: string): boolean {
    try { return localStorage.getItem(DISMISS_KEY) === version } catch { return false }
  }

  /**
   * 挂 IPC 监听（App.vue onMounted 调一次）。
   * 返回解绑函数。
   */
  function bindUpdater(): () => void {
    const api = window.updater
    if (!api) return () => { /* noop */ }

    const offAvailable = api.onUpdateAvailable((info) => {
      // eslint-disable-next-line no-console
      console.log('[updater] 收到新版本提醒', info.version, 'mode=', info.mode)
      latestVersion.value = info.version
      pendingInfo.value = info
      if (isDismissed(info.version)) return
      void promptUpdate(info)
    })

    const offProgress = api.onUpdateProgress((p) => {
      if (phase.value === 'idle' || phase.value === 'error') return
      // 100% 由 update:downloaded 收尾，这里不刷
      if (p.percent >= 100) return
      phase.value = 'downloading'
      const now = Date.now()
      // 节流：120ms 一次足够顺滑，还能避免几十 Hz 的 DOM 刷新
      if (now - lastProgressAt < 120) return
      lastProgressAt = now

      // 瞬时速度 + 指数平滑（人眼看波动小的数字更舒服）
      let speed = progress.value.speed
      if (speedSample) {
        const dt = (now - speedSample.at) / 1000
        if (dt > 0) {
          const inst = (p.transferred - speedSample.bytes) / dt
          speed = speed > 0 ? speed * 0.6 + inst * 0.4 : inst
        }
      }
      speedSample = { at: now, bytes: p.transferred }

      progress.value = {
        percent: Math.max(0, Math.min(100, p.percent)),
        transferred: p.transferred,
        total: p.total,
        speed: Math.max(0, speed),
      }
    })

    const offDownloaded = api.onUpdateDownloaded((d) => {
      phase.value = 'downloaded'
      localPath.value = d.localPath ?? ''
      progress.value = { ...progress.value, percent: 100, speed: 0 }
      dialogVisible.value = true   // 后台下载时也要把弹框拉回来
      if (!d.localPath) {
        phase.value = 'error'
        errorMessage.value = '下载完成但没拿到本地路径，请重试或去 GitHub 下载'
      }
    })

    const offError = api.onUpdateError((e) => {
      phase.value = 'error'
      errorMessage.value = e.message
      errorUrl.value = e.url ?? ''
      dialogVisible.value = true
    })

    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }

  /** "发现新版本"确认框 → 点"立即更新"进入下载弹框 */
  async function promptUpdate(info: UpdateInfoPayload) {
    try {
      await ElMessageBox.confirm(
        `当前版本 v${info.currentVersion}，发现新版本 v${info.version}。\n\n点击「立即更新」开始下载，下载完成后可直接重启安装。`,
        '发现新版本',
        {
          confirmButtonText: '立即更新',
          cancelButtonText: '稍后再说',
          type: 'info',
          closeOnClickModal: false,
          closeOnPressEscape: false,
        },
      )
    } catch {
      rememberDismiss(info.version)
      return
    }
    rememberDismiss(info.version)
    startDownload(info)
  }

  /** 开始下载（也供 Settings.vue "重新下载" 复用） */
  function startDownload(info: UpdateInfoPayload) {
    if (busy.value) return
    const api = window.updater
    if (!api?.startManualDownload) {
      ElMessage.warning('当前环境不支持自动更新')
      return
    }
    activeMode = info.mode === 'nsis' ? 'nsis' : 'portable'
    targetVersion.value = info.version
    errorMessage.value = ''
    errorUrl.value = info.url ?? ''
    localPath.value = ''
    restarting.value = false
    progress.value = { percent: 0, transferred: 0, total: 0, speed: 0 }
    speedSample = null
    lastProgressAt = 0
    phase.value = 'preparing'
    dialogVisible.value = true

    // 'fallback' = 让主进程按 NSIS installer asset 取包（历史命名）
    void api.startManualDownload(info, activeMode === 'nsis' ? 'fallback' : 'portable')
  }

  /** 下载失败后重试（拿当前 targetVersion 重来） */
  function retryDownload() {
    if (!targetVersion.value) return
    startDownload({
      version: targetVersion.value,
      currentVersion: currentVersion.value,
      tag: `v${targetVersion.value}`,
      url: errorUrl.value,
      mode: activeMode,
    })
  }

  /** Settings.vue "立即更新"：直接用主进程刚推过来的版本信息开始下载 */
  function updateNow() {
    if (pendingInfo.value) {
      startDownload(pendingInfo.value)
    } else {
      ElMessage.warning('还没拿到新版本信息，请先点「检测更新」')
    }
  }

  /** 关键动作：重启并安装（主进程退出 + 拉起装包） */
  async function restartAndInstall() {
    if (restarting.value) return
    const api = window.updater
    if (!api?.restartAndInstall) {
      // 老主进程无此接口 → 退化为手动打开安装包
      ElMessage.warning('当前版本不支持一键安装，请手动打开安装包')
      await openLocalFile()
      return
    }
    if (!localPath.value) return
    restarting.value = true
    try {
      const r = await api.restartAndInstall(localPath.value, activeMode)
      if (!r?.ok) {
        restarting.value = false
        ElMessage.error(r?.error ?? '启动安装包失败，请手动打开安装包')
      }
      // ok：主进程约 320ms 后退出，这里保持"正在重启…"
    } catch (e) {
      restarting.value = false
      ElMessage.error((e as Error)?.message ?? '启动安装包失败')
    }
  }

  /** 手动打开下载好的安装包（用户不想重启时用） */
  async function openLocalFile() {
    if (!localPath.value || !window.updater?.openLocalFile) return
    await window.updater.openLocalFile(localPath.value)
  }

  /** 兜底：浏览器打开 GitHub Release 页面 */
  async function openReleasePage() {
    if (!errorUrl.value || !window.updater?.openExternal) return
    await window.updater.openExternal(errorUrl.value)
  }

  /** 关掉弹框（下载中关掉不中断下载，完成后会再弹） */
  function hideDialog() {
    dialogVisible.value = false
  }

  const hasUpdate = computed(
    () => Boolean(latestVersion.value && currentVersion.value && latestVersion.value !== currentVersion.value),
  )

  return {
    currentVersion,
    latestVersion,
    checking,
    lastCheckAt,
    lastCheckResult,
    hasUpdate,
    // 下载弹框
    phase,
    busy,
    dialogVisible,
    targetVersion,
    progress,
    localPath,
    errorMessage,
    errorUrl,
    restarting,
    pendingInfo,
    // actions
    loadCurrentVersion,
    checkNow,
    bindUpdater,
    startDownload,
    retryDownload,
    updateNow,
    restartAndInstall,
    openLocalFile,
    openReleasePage,
    hideDialog,
  }
})
