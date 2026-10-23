/**
 * stores/checkins.ts —— Supabase PG 适配版（走 data-api HTTP Function）
 *
 * 课时扣减：本期先在客户端做 SUM 校验，避免超扣。
 * 后期想严谨可以建一个 PG RPC（security definer）做事务。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { businessApi, getActiveUid } from '@/lib/cloudbase'
import { useChildrenStore } from './children'
import { useCoursesStore } from './courses'

function requireUid(): string {
  const uid = getActiveUid()
  if (!uid) throw new Error('未登录：无法操作 checkins 表')
  return uid
}

export interface Checkin {
  id: string
  owner_id: string
  child_id: string
  course_id: string
  date: string
  hours: number
  feedback: string
  created_at: string
}

export interface CheckinInput {
  course_id: string
  date: string
  hours: number
  feedback?: string
}

export const useCheckinsStore = defineStore('checkins', () => {
  const items = ref<Checkin[]>([])

  const count = computed(() => items.value.length)
  const byCourse = computed(() => (cid: string) => items.value.filter((c) => c.course_id === cid))

  /**
   * 刷新打卡记录（默认当前宝贝，可选按课程 / 日期区间过滤）
   * ⚠️ 代次守卫（seq）：切换宝贝时多个 refresh 可能同时在飞，
   *    旧请求晚返回会覆盖新宝贝的数据 → 只有最新那次的响应才写 store。
   */
  let refreshSeq = 0
  async function refresh(filter?: { courseId?: string; from?: string; to?: string }) {
    requireUid()
    const children = useChildrenStore()
    const cid = children.activeIdSafe
    if (!cid) { items.value = []; return }

    const seq = ++refreshSeq
    const params = new URLSearchParams({ child_id: cid, order: 'date', asc: 'false' })
    if (filter?.courseId) params.set('course_id', filter.courseId)
    if (filter?.from) params.set('date_gte', filter.from)
    if (filter?.to) params.set('date_lte', filter.to)
    const rows = await businessApi<Checkin[]>('GET', `/b/checkins?${params.toString()}`)
    if (seq !== refreshSeq) return
    items.value = rows
  }

  async function create(input: CheckinInput): Promise<Checkin> {
    requireUid()
    const children = useChildrenStore()
    const cid = children.activeIdSafe
    if (!cid) throw new Error('请先创建宝贝档案')

    // 客户端预校验剩余课时（直接用 store 已聚合的 used_hours，避免重复查询）
    const courses = useCoursesStore()
    const course = courses.byId(input.course_id)
    // ⚠️ 课程必须属于当前宝贝：用户在打卡弹窗开着的时候切了宝贝，
    //    这时 course_id 还指着上一个孩子的课，child_id 却已经是新孩子 →
    //    写出去就是一条"课程和孩子对不上"的脏数据。这里直接拦掉。
    if (!course) {
      throw new Error('课程不存在或不属于当前宝贝，请重新选择')
    }
    if (course.child_id !== cid) {
      throw new Error('该课程不属于当前宝贝，请先切换到对应宝贝再打卡')
    }
    // 剩余课时预校验（直接用 store 已聚合的 used_hours，避免重复查询）
    const used = course.used_hours
    if (used + input.hours > course.total_hours) {
      throw new Error(`剩余课时不足（剩 ${round2(course.total_hours - used)} 节，要扣 ${input.hours}）`)
    }

    const c = await businessApi<Checkin>('POST', '/b/checkins', {
      child_id: cid,
      course_id: input.course_id,
      date: input.date,
      hours: input.hours,
      feedback: input.feedback ?? '',
    })
    items.value.unshift(c)
    ElMessage.success('已打卡')
    // 刷新 courses 聚合（已用/剩余/单价都变）
    await courses.refresh()
    return c
  }

  async function remove(id: string) {
    requireUid()
    await businessApi<{ deleted: number }>('DELETE', `/b/checkins/${encodeURIComponent(id)}`)
    items.value = items.value.filter((c) => c.id !== id)
    const courses = useCoursesStore()
    await courses.refresh()
    ElMessage.success('已删除打卡')
  }

  return {
    items,
    count,
    byCourse,
    refresh,
    create,
    remove,
  }
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
