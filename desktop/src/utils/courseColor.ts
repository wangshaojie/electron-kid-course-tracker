/**
 * 课程取色 —— 课程无 color 字段,按 course_id 稳定哈希到调色板
 * 根据当前主题(深/浅)返回不同色板,保证在两种背景下都有足够的对比度
 *  - 浅色主题:浅色背景 + 深色文字(柔和、不刺眼)
 *  - 深色主题:半透明品牌色背景 + 浅色文字(融入玻璃风)
 */

import { useThemeStore } from '@/stores/theme'

interface ColorPair { bg: string; text: string }

/** 浅色调色板:8 种浅背景 + 深字 */
const LIGHT_PALETTE: ColorPair[] = [
  { bg: '#E3F5EA', text: '#1F7D4E' }, // 薄荷绿
  { bg: '#FDF0DC', text: '#C77417' }, // 暖橙
  { bg: '#E5F0FB', text: '#2B6CB0' }, // 蓝
  { bg: '#F1EAFD', text: '#7C3AED' }, // 紫
  { bg: '#FCE7F0', text: '#BE4D80' }, // 粉
  { bg: '#E0F5F2', text: '#0E7C6B' }, // 青
  { bg: '#FBEEDD', text: '#B45309' }, // 棕
  { bg: '#EAEFEA', text: '#4A6F52' }, // 灰绿
]

/** 深色调色板:半透明品牌色背景 + 浅文字,深色玻璃风不刺眼 */
const DARK_PALETTE: ColorPair[] = [
  { bg: 'rgba(63,184,122,0.22)', text: '#5FCE89' },   // 薄荷绿
  { bg: 'rgba(224,138,30,0.22)', text: '#FFB347' },   // 暖橙
  { bg: 'rgba(43,108,176,0.28)', text: '#7AC7FF' },   // 蓝
  { bg: 'rgba(124,58,237,0.25)', text: '#B58BFF' },   // 紫
  { bg: 'rgba(190,77,128,0.25)', text: '#FF9DB5' },   // 粉
  { bg: 'rgba(14,124,107,0.25)', text: '#5FDFC0' },   // 青
  { bg: 'rgba(180,83,9,0.28)',   text: '#FFB37A' },   // 棕
  { bg: 'rgba(74,111,82,0.28)',  text: '#A8C5AF' },   // 灰绿
]

/** 计算 hash(index) */
function indexOf(courseId: string): number {
  let h = 0
  for (let i = 0; i < courseId.length; i++) h = (h * 31 + courseId.charCodeAt(i)) >>> 0
  return h
}

/**
 * 取色:根据当前主题(从 store 拿,响应式)
 *  - 调用方需要响应主题切换时,应在 computed 内调
 *  - 非响应场景(login/preview)走默认深色
 */
export function courseColorOf(courseId: string): ColorPair {
  const idx = indexOf(courseId) % DARK_PALETTE.length
  let resolved: 'dark' | 'light' = 'dark'
  try {
    const theme = useThemeStore()
    resolved = theme.resolved
  } catch {
    // store 还未注册(极少数边界),走 dark
    resolved = 'dark'
  }
  return (resolved === 'light' ? LIGHT_PALETTE : DARK_PALETTE)[idx]!
}
