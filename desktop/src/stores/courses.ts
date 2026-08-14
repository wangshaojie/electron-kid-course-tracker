/**
 * stores/courses.ts —— CloudBase PG 适配版
 *
 * 字段形态：snake_case，与 PG 列名一致（不再 camelCase 互转）
 *  业务计算（已用课时 / 剩余课时 / 单价）通过 RLS 安全读取后客户端聚合
 *
 * 注意：原 view 用了 c.total_amount 等 snake_case，所以这里一致即可
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { db, getActiveUid } from '@/lib/cloudbase'
import type { CourseSummary, Alert } from '@/types'
import { daysFromToday } from '@/utils/date'
import { useCheckinsStore } from './checkins'
import { useChildrenStore } from './children'

function requireUid(): string {
  const uid = getActiveUid()
  if (!uid) throw new Error('未登录：无法操作 courses 表')
  return uid
}

export interface Course {
  id: string
  owner_id: string
  child_id: string
  name: string
  institution: string
  total_amount: number
  total_hours: number
  paid_at: string
  expires_at: string | null
  tags: string
  note: string
  created_at: string
  updated_at: string
  used_hours: number
  remain_hours: number
  price_per_hour: number
}

export interface CourseInput {
  name: string
  institution?: string
  total_amount: number
  total_hours: number
  paid_at: string
  expires_at?: string | null
  tags?: string
  note?: string
}

export const useCoursesStore = defineStore('courses', () => {
  const items = ref<Course[]>([])

  const count = computed(() => items.value.length)
  const totalAmount = computed(() => items.value.reduce((s, c) => s + c.total_amount, 0))
  const totalHours = computed(() => items.value.reduce((s, c) => s + c.total_hours, 0))
  const summaries = computed<CourseSummary[]>(() => items.value.map((c) => buildSummary(c)))
  const remainHours = computed(() => summaries.value.reduce((s, c) => s + c.remain_hours, 0))
  const usedHours = computed(() => summaries.value.reduce((s, c) => s + c.used_hours, 0))

  const alerts = computed<Alert[]>(() => {
    const out: Alert[] = []
    for (const s of summaries.value) {
      if (s.status === 'expired') {
        out.push({
          level: 'danger',
          title: `${s.name} 已过期`,
          detail: s.expires_at ? `到期日 ${s.expires_at}` : '请检查日期',
          courseId: s.id,
        })
      } else if (s.status === 'low') {
        out.push({
          level: 'warning',
          title: `${s.name} 课时不足`,
          detail: `仅剩 ${s.remain_hours} 节，建议续费`,
          courseId: s.id,
        })
      }
      if (
        s.days_to_expire !== null &&
        s.days_to_expire >= 0 &&
        s.days_to_expire <= 14 &&
        s.status !== 'expired'
      ) {
        out.push({
          level: 'warning',
          title: `${s.name} 即将到期`,
          detail: `还有 ${s.days_to_expire} 天到期`,
          courseId: s.id,
        })
      }
    }
    return out
  })

  async function refresh() {
    const uid = requireUid()
    const children = useChildrenStore()
    const cid = children.activeIdSafe
    if (!cid) { items.value = []; return }
    // 客户端聚合 used_hours：先查本 child 的 courses + checkins 再合并
    // 为简化（避免双查询），本版本让 PG 在 SQL 中做 SUM；这里拆两次查
    const { data: courseRows, error } = await db.from('courses')
      .select('*')
      .eq('owner_id', uid)
      .eq('child_id', cid)
      .order('paid_at', { ascending: false })
    if (error) { console.error('[courses] refresh error', error); throw error }
    const list = (courseRows ?? []) as Array<Omit<Course, 'used_hours' | 'remain_hours' | 'price_per_hour'>>
    if (list.length === 0) { items.value = []; return }

    // 拉 checkins 聚合
    const { data: checkinRows } = await db.from('checkins')
      .select('course_id, hours')
      .eq('owner_id', uid)
      .eq('child_id', cid)
    const usedMap = new Map<string, number>()
    for (const r of (checkinRows ?? []) as Array<{ course_id: string; hours: number }>) {
      usedMap.set(r.course_id, (usedMap.get(r.course_id) ?? 0) + Number(r.hours))
    }
    items.value = list.map((c) => {
      const used = usedMap.get(c.id) ?? 0
      const remain = Math.max(0, Number(c.total_hours) - used)
      return {
        ...c,
        used_hours: used,
        remain_hours: round2(remain),
        price_per_hour: Number(c.total_hours) > 0 ? round2(Number(c.total_amount) / Number(c.total_hours)) : 0,
      }
    })
  }

  async function create(input: CourseInput): Promise<Course> {
    const uid = requireUid()
    const children = useChildrenStore()
    const cid = children.activeIdSafe
    if (!cid) throw new Error('请先创建孩子档案')

    const payload: Record<string, unknown> = {
      owner_id: uid,
      child_id: cid,
      name: input.name,
      institution: input.institution ?? '',
      total_amount: input.total_amount,
      total_hours: input.total_hours,
      paid_at: input.paid_at,
      expires_at: input.expires_at ?? null,
      tags: input.tags ?? '',
      note: input.note ?? '',
    }
    const { data, error } = await db.from('courses').insert(payload).select('*').single()
    if (error) throw error
    const c = data as Course
    // 补聚合字段
    c.used_hours = 0
    c.remain_hours = c.total_hours
    c.price_per_hour = c.total_hours > 0 ? round2(c.total_amount / c.total_hours) : 0
    items.value.unshift(c)
    ElMessage.success('已添加课程')
    return c
  }

  async function update(id: string, input: Partial<CourseInput>) {
    const uid = requireUid()
    const { data, error } = await db.from('courses')
      .update({ ...input })
      .eq('id', id)
      .eq('owner_id', uid)
      .select('*')
      .single()
    if (error) throw error
    void data
    await refresh()
    ElMessage.success('已更新')
  }

  async function remove(id: string) {
    const uid = requireUid()
    const { error } = await db.from('courses').delete().eq('id', id).eq('owner_id', uid)
    if (error) throw error
    await refresh()
    const checkins = useCheckinsStore()
    await checkins.refresh()
    ElMessage.success('已删除课程')
  }

  function byId(id: string): Course | undefined {
    return items.value.find((c) => c.id === id)
  }

  return {
    items,
    count,
    totalAmount,
    totalHours,
    summaries,
    remainHours,
    usedHours,
    alerts,
    refresh,
    create,
    update,
    remove,
    byId,
  }
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function buildSummary(c: Course): CourseSummary {
  const remain = Math.max(0, c.total_hours - c.used_hours)
  const daysToExpire = c.expires_at ? daysFromToday(c.expires_at) : null
  const status: CourseSummary['status'] =
    c.expires_at && daysToExpire !== null && daysToExpire < 0
      ? 'expired'
      : remain <= 0
        ? 'done'
        : remain <= 3
          ? 'low'
          : 'ok'
  return {
    id: c.id,
    name: c.name,
    institution: c.institution,
    total_amount: c.total_amount,
    total_hours: c.total_hours,
    used_hours: c.used_hours,
    remain_hours: remain,
    price_per_hour: c.price_per_hour,
    paid_at: c.paid_at,
    expires_at: c.expires_at,
    tags: c.tags ? c.tags.split(',').map((s) => s.trim()).filter(Boolean) : [],
    note: c.note,
    status,
    days_to_expire: daysToExpire,
  }
}
