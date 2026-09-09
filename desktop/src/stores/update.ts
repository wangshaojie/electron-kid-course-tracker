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
 * IPC 监听挂在一个独立 setup 函数里，App.vue 在 onMounted 时调一次
 * （与 registerUpdater 配套，避免每个组件都挂监听）。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ManualCheckResult = 'has-update' | 'up-to-date' | 'failed'

export const useUpdateStore = defineStore('update', () => {
  const currentVersion = ref('')
  const latestVersion = ref('')
  const checking = ref(false)
  const lastCheckAt = ref<number | null>(null)
  const lastCheckResult = ref<ManualCheckResult | null>(null)

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
    loadCurrentVersion,
    checkNow,
  }
})
