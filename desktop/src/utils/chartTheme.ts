/**
 * utils/chartTheme.ts —— ECharts 主题感知
 *
 * ECharts option 里的颜色不能直接写 var(--xxx)(那是 CSS 变量,ECharts 解析不了)
 * 这里从 document.documentElement 读 computedStyle,把 CSS 变量转成实际颜色给 ECharts
 *
 * 响应主题切换:
 *   - chart option 写成 computed,内部调用 useChartTheme()
 *   - 当 themeStore.mode 变化时,computed 重算 → 重新生成 option → ECharts 重渲染
 */

import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'

/** 读 CSS 变量的实际值 */
function cssVar(name: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * 给 ECharts 用的主题色板
 * - 每次取最新值(主题切换后 chart 重 render 时自动拿到新色)
 * - 不缓存:不同主题下值不同,缓存会脏
 */
export function getEchartsTheme() {
  return {
    // 文字
    textTitle:  cssVar('--text-title',  '#1f2937'),
    textBody:   cssVar('--text-body',   '#4b5563'),
    textSoft:   cssVar('--text-soft',   '#6b7280'),
    textGhost:  cssVar('--text-ghost',  '#9ca3af'),
    // 分割线 / 轴线
    axisLine:   cssVar('--divider',     'rgba(0,0,0,0.1)'),
    splitLine:  cssVar('--table-border','rgba(0,0,0,0.06)'),
    // tooltip
    tooltipBg:  cssVar('--dialog-bg',   '#ffffff'),
    tooltipBorder: cssVar('--divider',  'rgba(0,0,0,0.1)'),
    // 主色
    brand1:     cssVar('--brand-1',     '#3FB87A'),
    brand2:     cssVar('--brand-2',     '#5FCE89'),
    brandSoft:  cssVar('--brand-soft-bg','rgba(63,184,122,0.35)'),
    // 危险
    danger1:    cssVar('--danger-1',    '#D94545'),
  }
}

/** 在 chart option computed 里用:依赖 theme.mode 让重算生效 */
export function useChartTheme() {
  const theme = useThemeStore()
  return {
    mode: computed(() => theme.mode),
    resolved: computed(() => theme.resolved),
    get: getEchartsTheme,
  }
}
