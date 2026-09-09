/**
 * stores/theme.ts —— 主题 store
 *
 * 三档: dark | light | system
 *   dark   - 强制深色
 *   light  - 强制浅色
 *   system - 跟随操作系统 prefers-color-scheme
 *
 * 持久化: 写云端 user_prefs.theme(best-effort),本地 localStorage 'app.theme' 做兜底
 *  应用:   设置 <html data-theme="..."> 让 theme.css 切换
 *   - 'dark' / 'light' → 显式设 data-theme
 *   - 'system'         → 不设 data-theme,让 @media (prefers-color-scheme) 接管
 *
 * 关键设计:
 *   - applyTheme() 是纯本地操作,不依赖网络,立即生效
 *   - persistRemote() 是 best-effort 写云端,失败打 warn 不影响 UI
 *   - 启动早期 main.ts 直接调 applyTheme() 走 localStorage 兜底,避免闪屏
 *   - 登录后 auth 变化 / uid 变化时,再读一次云端 prefs 同步过来(多设备一致)
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { businessApi } from '@/lib/cloudbase'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const LS_KEY = 'app.theme'
const VALID_MODES: ThemeMode[] = ['dark', 'light', 'system']

function readLS(): ThemeMode {
  try {
    const v = localStorage.getItem(LS_KEY) as ThemeMode | null
    if (v && VALID_MODES.includes(v)) return v
  } catch { /* ignore */ }
  return 'system'
}

function writeLS(m: ThemeMode) {
  try { localStorage.setItem(LS_KEY, m) } catch { /* ignore */ }
}

/** 操作系统当前的暗/亮偏好 */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useThemeStore = defineStore('theme', () => {
  /** 用户选的 mode(可能是 system) */
  const mode = ref<ThemeMode>(readLS())

  /** 解析后真正生效的(去除 system 后的) */
  const resolved = computed<ResolvedTheme>(() => {
    if (mode.value === 'system') return systemPrefersDark() ? 'dark' : 'light'
    return mode.value
  })

  /**
   * 应用到 DOM: 设 <html data-theme="dark|light">;system 模式不设让 CSS media 接管
   * 调用方: main.ts 早期 / mode watcher / 系统变化 watcher
   */
  function applyTheme(): void {
    if (typeof document === 'undefined') return
    const html = document.documentElement
    if (mode.value === 'system') {
      html.removeAttribute('data-theme')
    } else {
      html.setAttribute('data-theme', mode.value)
    }
  }

  /** 监听系统暗/亮切换(只在 system 模式有意义) */
  let mql: MediaQueryList | null = null
  let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null

  function bindSystemListener() {
    if (typeof window === 'undefined' || !window.matchMedia) return
    if (mql) return // 已绑定
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    mqlHandler = () => {
      // 系统变化时只在 system 模式下重算 resolved
      // 依赖 Pinia 的 computed 自动触发,这里不需要手动 apply
    }
    // 现代浏览器 addEventListener,老 Safari 用 addListener
    if (mql.addEventListener) mql.addEventListener('change', mqlHandler)
    else if ((mql as any).addListener) (mql as any).addListener(mqlHandler)
  }

  function unbindSystemListener() {
    if (!mql || !mqlHandler) return
    if (mql.removeEventListener) mql.removeEventListener('change', mqlHandler)
    else if ((mql as any).removeListener) (mql as any).removeListener(mqlHandler)
    mql = null
    mqlHandler = null
  }

  // mode 变化 → 立即应用 + 写 localStorage
  watch(mode, (m) => {
    writeLS(m)
    applyTheme()
  })

  bindSystemListener()

  /**
   * 设置模式 + best-effort 写云端 user_prefs
   * 调用场景: 用户在侧栏点切换按钮
   */
  async function setMode(m: ThemeMode): Promise<void> {
    mode.value = m
    writeLS(m)
    applyTheme()
    await persistRemote(m)
  }

  /**
   * Capability: server-side user_prefs.theme 列是否可用
   * - 不知道 → 视为 false,本地 LS 单独生效
   * - 检测到 → 设 true,后续读/写都走云端
   * - 400/500/列不存在 → 永久降级为 false(同一进程内不再尝试),不刷屏 warn
   */
  let _remoteAvailable: boolean | null = null
  function _markRemoteUnavailable() {
    if (_remoteAvailable !== false) {
      _remoteAvailable = false
      console.warn(
        '[theme] 云端 user_prefs.theme 不可用(migration 未跑?),降级为只本地 localStorage. ' +
        '多设备同步需先在 Supabase 跑 supabase/migrations/20260909140000_user_prefs_theme.sql',
      )
    }
  }
  function _isRemoteColMissing(e: unknown): boolean {
    // businessApi 错误格式: { error: 'db_error' | 'bad_query' | 'not_found' | 'internal', detail: string }
    const msg = String((e as any)?.detail || (e as any)?.message || e || '')
    return (
      msg.includes('theme') ||
      msg.includes('column') && msg.includes('does not exist') ||
      msg.includes('42703') // PG undefined_column
    )
  }

  /**
   * 读云端 user_prefs.theme 并同步到本地
   * - 调用场景: 登录后 / uid 变化时(从 App.vue 触发)
   * - 没记录 / 读失败 → 保持本地 LS,不动
   * - 服务端字段类型是 'dark' | 'light' | 'system',其他值忽略
   * - 远端不可用(列不存在)→ 静默,后续不再尝试
   */
  async function syncFromCloud(): Promise<void> {
    if (_remoteAvailable === false) return
    try {
      const rows = await businessApi<Array<{ theme: string | null }>>(
        'GET',
        '/b/user_prefs?select=theme',
      )
      _remoteAvailable = true
      const cloud = rows[0]?.theme
      if (cloud && VALID_MODES.includes(cloud as ThemeMode)) {
        const next = cloud as ThemeMode
        if (next !== mode.value) {
          mode.value = next
          writeLS(next)
          applyTheme()
        }
      }
    } catch (e) {
      if (_isRemoteColMissing(e)) _markRemoteUnavailable()
      else console.warn('[theme] syncFromCloud failed, keep local LS', e)
    }
  }

  /**
   * 写云端 user_prefs.theme
   * - 调用场景: 用户切换主题
   * - 没 owner_id(未登录)时静默跳过
   * - 失败只 warn 不抛
   * - 远端不可用(列不存在)→ 静默,后续不再尝试
   */
  async function persistRemote(m: ThemeMode): Promise<void> {
    if (_remoteAvailable === false) return
    try {
      await businessApi<{ theme: string }>('PATCH', '/b/user_prefs', {
        theme: m,
        updated_at: new Date().toISOString(),
      })
      _remoteAvailable = true
    } catch (e) {
      if (_isRemoteColMissing(e)) _markRemoteUnavailable()
      else console.warn('[theme] persistRemote failed', e)
    }
  }

  return {
    mode,
    resolved,
    setMode,
    applyTheme,
    syncFromCloud,
    persistRemote,
    unbindSystemListener,
  }
})
