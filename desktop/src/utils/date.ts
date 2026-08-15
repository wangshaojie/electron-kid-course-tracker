/** 日期工具 */

export function todayStr(): string {
  return toDateStr(new Date())
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromDateStr(s: string): Date {
  // 'YYYY-MM-DD' → 本地 0 时区
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y!, (m! - 1), d!)
}

export function daysBetween(a: string, b: string): number {
  const da = fromDateStr(a).getTime()
  const db = fromDateStr(b).getTime()
  return Math.round((db - da) / 86_400_000)
}

export function daysFromToday(s: string): number {
  return daysBetween(todayStr(), s)
}

export function formatMonthDay(s: string): string {
  // 'YYYY-MM-DD' → 'MM-DD'
  return s.slice(5)
}

export function shortDate(s: string): string {
  return s
}
