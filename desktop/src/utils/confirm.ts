/**
 * 二次确认弹窗 —— 包装 Element Plus MessageBox
 * 在 .ts 工具里就能用，不依赖组件
 */
import { ElMessageBox } from 'element-plus'

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'warning' | 'info' | 'error' | 'success'
}

export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  try {
    await ElMessageBox.confirm(opts.message, opts.title ?? '请确认', {
      confirmButtonText: opts.confirmText ?? '确定',
      cancelButtonText: opts.cancelText ?? '取消',
      type: opts.type ?? 'warning',
      draggable: true,
    })
    return true
  } catch {
    return false
  }
}

/**
 * 转义正则元字符
 * --------------------------------------------------------------
 * keyword 来自课程名 / 宝贝名，用户可以随便起名（含 ( ) [ ] + * ? 等）。
 * 直接拼进 new RegExp() 会有两个后果：
 *   1. 「数学(基础)」→ /^数学(基础)$/ 匹配不上用户输入 → 确认按钮永久禁用
 *   2. 「美术(」→ new RegExp 抛 SyntaxError → 被 catch 吞掉 → 弹窗都不弹
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 强确认：用户必须输入指定 keyword 才放行 */
export async function dangerousConfirm(
  opts: ConfirmOptions & { keyword: string },
): Promise<boolean> {
  try {
    const { value } = await ElMessageBox.prompt(
      `${opts.message}\n\n请输入「${opts.keyword}」以确认：`,
      opts.title ?? '⚠️ 危险操作',
      {
        confirmButtonText: opts.confirmText ?? '确认执行',
        cancelButtonText: opts.cancelText ?? '取消',
        type: 'warning',
        inputPattern: new RegExp(`^${escapeRegExp(opts.keyword)}$`),
        inputErrorMessage: `请准确输入「${opts.keyword}」`,
        draggable: true,
      },
    )
    return value === opts.keyword
  } catch {
    return false
  }
}
