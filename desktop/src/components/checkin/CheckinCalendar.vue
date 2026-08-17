<script setup lang="ts">
/**
 * 月历组件 —— 打卡日历网格
 * 周一开头、42 格；每格显示日期 + 当天打卡课程胶囊（最多 2 个 + N）
 */
import { computed } from 'vue'
import type { Checkin } from '@/stores/checkins'
import { useCoursesStore } from '@/stores/courses'
import { todayStr, toDateStr } from '@/utils/date'
import { courseColorOf } from '@/utils/courseColor'

const props = defineProps<{
  year: number
  month: number // 1-12
  selectedDate: string
  checkins: Checkin[]
}>()

const emit = defineEmits<{
  'select-date': [date: string]
}>()

const courses = useCoursesStore()

const WEEK_HEADS = ['一', '二', '三', '四', '五', '六', '日']

interface DayCell {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
}

const today = todayStr()

const grid = computed<DayCell[]>(() => {
  const first = new Date(props.year, props.month - 1, 1)
  const startOffset = (first.getDay() + 6) % 7 // 周一 = 0
  const cells: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(props.year, props.month - 1, 1 - startOffset + i)
    const date = toDateStr(d)
    cells.push({
      date,
      day: d.getDate(),
      inMonth: d.getMonth() === props.month - 1,
      isToday: date === today,
      isSelected: date === props.selectedDate,
    })
  }
  return cells
})

const byDate = computed(() => {
  const m = new Map<string, Checkin[]>()
  for (const c of props.checkins) {
    const arr = m.get(c.date)
    if (arr) arr.push(c)
    else m.set(c.date, [c])
  }
  return m
})

function dayCheckins(date: string): Checkin[] {
  return byDate.value.get(date) ?? []
}

function courseName(cid: string): string {
  return courses.byId(cid)?.name ?? '已删除课程'
}

/** 按课程聚合当天打卡（同课程多条合并课时） */
interface DayAgg {
  course_id: string
  hours: number
  count: number
}

function dayAggs(date: string): DayAgg[] {
  const list = byDate.value.get(date) ?? []
  const m = new Map<string, DayAgg>()
  for (const c of list) {
    const cur = m.get(c.course_id)
    if (cur) {
      cur.hours += Number(c.hours)
      cur.count += 1
    } else {
      m.set(c.course_id, { course_id: c.course_id, hours: Number(c.hours), count: 1 })
    }
  }
  return [...m.values()]
}

function dayClass(c: DayCell): string {
  const base =
    'relative flex min-h-[56px] cursor-pointer flex-col rounded-lg border p-1 text-left transition-colors duration-100 focus:outline-none'
  const border = c.isSelected
    ? 'border-brand-400'
    : dayCheckins(c.date).length > 0
      ? 'border-brand-200'
      : 'border-transparent'
  const bg = c.isSelected
    ? 'bg-brand-50'
    : dayCheckins(c.date).length > 0
      ? 'bg-brand-50/70'
      : 'bg-white hover:bg-brand-50/40'
  const shadow = c.isSelected ? 'ring-2 ring-brand-400/70' : ''
  return `${base} ${border} ${bg} ${shadow}`
}

function dayNumClass(c: DayCell): string {
  if (c.isToday) {
    return 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-400 text-[11px] font-bold text-white'
  }
  return `text-[12px] font-medium ${c.inMonth ? 'text-ink' : 'text-ink-ghost/60'}`
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="mb-1 grid grid-cols-7 gap-1">
      <div v-for="w in WEEK_HEADS" :key="w" class="py-1 text-center text-xs font-medium text-ink-ghost">
        周{{ w }}
      </div>
    </div>
    <div class="grid flex-1 grid-cols-7 gap-1">
      <button
        v-for="c in grid"
        :key="c.date"
        type="button"
        :class="dayClass(c)"
        @click="emit('select-date', c.date)"
      >
        <span :class="dayNumClass(c)">{{ c.day }}</span>
        <div class="mt-0.5 flex min-h-[30px] flex-col gap-[3px] overflow-hidden">
          <template v-for="a in dayAggs(c.date).slice(0, 2)" :key="a.course_id">
            <span
              class="flex items-center justify-between gap-0.5 rounded px-1 py-px text-[10px] font-medium leading-4"
              :style="{
                backgroundColor: courseColorOf(a.course_id).bg,
                color: courseColorOf(a.course_id).text,
              }"
            >
              <span class="min-w-0 truncate">{{ courseName(a.course_id) }}</span>
              <span class="shrink-0 font-semibold">
                {{ a.hours > 0 ? '-' : '+' }}{{ Math.abs(a.hours) }}节<template v-if="a.count > 1">×{{ a.count }}</template>
              </span>
            </span>
          </template>
          <span
            v-if="dayAggs(c.date).length > 2"
            class="px-1 text-[10px] font-medium leading-4 text-ink-ghost"
          >
            +{{ dayAggs(c.date).length - 2 }}
          </span>
        </div>
      </button>
    </div>
  </div>
</template>
