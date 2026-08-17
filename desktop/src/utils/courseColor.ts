/** 课程取色 —— 课程无 color 字段，按 course_id 稳定哈希到柔和调色板 */
const PALETTE: Array<{ bg: string; text: string }> = [
  { bg: '#E3F5EA', text: '#1F7D4E' }, // 薄荷绿
  { bg: '#FDF0DC', text: '#C77417' }, // 暖橙
  { bg: '#E5F0FB', text: '#2B6CB0' }, // 蓝
  { bg: '#F1EAFD', text: '#7C3AED' }, // 紫
  { bg: '#FCE7F0', text: '#BE4D80' }, // 粉
  { bg: '#E0F5F2', text: '#0E7C6B' }, // 青
  { bg: '#FBEEDD', text: '#B45309' }, // 棕
  { bg: '#EAEFEA', text: '#4A6F52' }, // 灰绿
]

export function courseColorOf(courseId: string): { bg: string; text: string } {
  let h = 0
  for (let i = 0; i < courseId.length; i++) h = (h * 31 + courseId.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}
