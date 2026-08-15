/** 金额 / 数字工具 */

export function formatMoney(n: number): string {
  // 千分位 + 元
  if (!Number.isFinite(n)) return '—'
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatHours(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return `${n} 节`
  return `${n.toFixed(1)} 节`
}

export function pricePerHour(total: number, hours: number): number {
  if (!hours) return 0
  return Math.round((total / hours) * 100) / 100
}
