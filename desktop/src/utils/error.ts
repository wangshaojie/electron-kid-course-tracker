/**
 * 错误文案工具
 * --------------------------------------------------------------
 * 到处 `ElMessage.error((e as Error).message)` 有两个问题：
 *   1. 抛出的不是 Error 时，message 是 undefined → 界面显示 "undefined"
 *   2. 抛出的对象有 message 字段但不是 Error 实例时，TS 断言骗过了检查
 * 统一走 errorText()。
 */
export function errorText(e: unknown, fallback = '操作失败，请稍后重试'): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e.trim()) return e
  const m = (e as { message?: unknown } | null)?.message
  if (typeof m === 'string' && m.trim()) return m
  return fallback
}
