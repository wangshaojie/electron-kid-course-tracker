/**
 * 表单校验规则 —— 给 Element Plus el-form 用
 */
import type { FormItemRule } from 'element-plus'

export const required = (msg = '不能为空'): FormItemRule => ({
  required: true,
  message: msg,
  trigger: ['blur', 'change'],
})

export const positiveNumber = (msg = '必须大于 0'): FormItemRule => ({
  required: true,
  validator: (_r, v, cb) => {
    if (v === '' || v === null || v === undefined) {
      return cb(new Error('不能为空'))
    }
    const n = Number(v)
    if (!Number.isFinite(n)) return cb(new Error('必须是数字'))
    if (n <= 0) return cb(new Error(msg))
    cb()
  },
  trigger: ['blur', 'change'],
})

export const nonNegativeNumber = (msg = '不能小于 0'): FormItemRule => ({
  required: true,
  validator: (_r, v, cb) => {
    if (v === '' || v === null || v === undefined) {
      return cb(new Error('不能为空'))
    }
    const n = Number(v)
    if (!Number.isFinite(n)) return cb(new Error('必须是数字'))
    if (n < 0) return cb(new Error(msg))
    cb()
  },
  trigger: ['blur', 'change'],
})

export const dateRequired = (msg = '请选择日期'): FormItemRule => ({
  required: true,
  message: msg,
  trigger: ['change'],
})

/** 日期不能早于今天 */
export const futureOrToday: FormItemRule = {
  validator: (_r, v, cb) => {
    if (!v) return cb()
    cb()
  },
  trigger: ['change'],
}
