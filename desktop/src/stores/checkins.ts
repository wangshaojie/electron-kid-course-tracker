/**
 * stores/checkins.ts —— CloudBase PG 适配版
 *
 * 课时扣减：本期先在客户端做 SUM 校验，避免超扣。
 * 后期想严谨可以建一个 PG RPC（security definer）做事务。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { db, getActiveUid } from '@/lib/cloudbase'
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

  async function refresh(filter?: { courseId?: string; from?: string; to?: string }) {
    const uid = requireUid()
    const children = useChildrenStore()
    const cid = children.activeIdSafe
    if (!cid) { items.value = []; return }

    let q = db.from('checkins').select('*').eq('owner_id', uid).eq('child_id', cid)
    if (filter?.courseId) q = q.eq('course_id', filter.courseId)
    if (filter?.from) q = q.gte('date', filter.from)
    if (filter?.to) q = q.lte('date', filter.to)
    const { data, error } = await q.order('date', { ascending: false })
    if (error) { console.error('[checkins] refresh', error); throw error }
    items.value = (data ?? []) as Checkin[]
  }

  async function create(input: CheckinInput): Promise<Checkin> {
    const uid = requireUid()
    const children = useChildrenStore()
    const cid = children.activeIdSafe
    if (!cid) throw new Error('请先创建孩子档案')

    // 客户端预校验剩余课时（直接用 store 已聚合的 used_hours，避免重复查询）
    const courses = useCoursesStore()
    const course = courses.byId(input.course_id)
    if (course) {
      const used = course.used_hours
      if (used + input.hours > course.total_hours) {
        throw new Error(`剩余课时不足（剩 ${round2(course.total_hours - used)} 节，要扣 ${input.hours}）`)
      }
    }

    const payload: Record<string, unknown> = {
      owner_id: uid,
      child_id: cid,
      course_id: input.course_id,
      date: input.date,
      hours: input.hours,
      feedback: input.feedback ?? '',
    }
    const { data, error } = await db.from('checkins').insert(payload).select('*').single()
    if (error) throw error
    const c = data as Checkin
    items.value.unshift(c)
    ElMessage.success('已打卡')
    // 刷新 courses 聚合（已用/剩余/单价都变）
    await courses.refresh()
    return c
  }

  async function remove(id: string) {
    const uid = requireUid()
    const { error } = await db.from('checkins').delete().eq('id', id).eq('owner_id', uid)
    if (error) throw error
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
