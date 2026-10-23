<script setup lang="ts">
/**
 * 统计分析（暗色玻璃版）
 *  1) 课程开销饼图 —— 按"期间内打卡日"筛，期间内某课程的开销 = 该课程单价 × 期间内打卡 hours
 *  2) 课时消耗柱图 —— 同期间筛，只展示期间内有过打卡的课程，used = 期间内 hours，remain = total - used
 *  3) 时间段筛选
 *  4) 期间内打卡明细 + 期间内统计文字
 */
import { ref, computed, onMounted } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'
import { todayStr } from '@/utils/date'
import { formatMoney } from '@/utils/money'
import CostPieChart from '@/components/stats/CostPieChart.vue'
import HoursBarChart from '@/components/stats/HoursBarChart.vue'

const courses = useCoursesStore()
const checkins = useCheckinsStore()

const dateRange = ref<[string, string] | null>(null)
const preset = ref<'all' | 'month' | 'quarter' | 'year' | 'custom'>('all')

function applyPreset(p: typeof preset.value) {
  preset.value = p
  if (p === 'all') {
    dateRange.value = null
    return
  }
  const now = new Date()
  const from = new Date(now)
  // ⚠️ 必须用 setDate 减天数，不能用 setMonth：
  //    JS 的 setMonth 会做月末钳位（3/31 - 1 月 → 2/31 → 溢出成 3/03），
  //    「近 30 天」实际只剩 28 天，整个 2 月被漏掉；季度档同理。
  if (p === 'month') from.setDate(from.getDate() - 30)
  if (p === 'quarter') from.setDate(from.getDate() - 90)
  if (p === 'year') from.setDate(from.getDate() - 365)
  dateRange.value = [toDateStr(from), todayStr()]
}

/** 日期选择器变化：清空时回到「全部」，否则标题写"期间内"但数据其实是全量 */
function onDateRangeChange(v: [string, string] | null | undefined) {
  preset.value = v && v.length === 2 ? 'custom' : 'all'
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const filteredCheckins = computed(() => {
  if (!dateRange.value) return checkins.items
  const [from, to] = dateRange.value
  return checkins.items.filter((c) => c.date >= from && c.date <= to)
})

const periodStats = computed(() => {
  const hours = filteredCheckins.value.reduce((s, c) => s + c.hours, 0)
  const sum = filteredCheckins.value.reduce((s, c) => {
    const course = courses.byId(c.course_id)
    if (!course || !course.total_hours) return s
    return s + (course.total_amount / course.total_hours) * c.hours
  }, 0)
  return { hours, amount: sum, count: filteredCheckins.value.length }
})

/**
 * 饼图数据：按 course_id 聚合期间内 hours，乘以单价折算金额
 *   - 只显示期间内有过打卡的课程
 *   - 没有单价 (total_hours=0) 的课程会被跳过，避免金额 = NaN
 */
const pieRows = computed<Array<{ name: string; value: number }>>(() => {
  const acc = new Map<string, { name: string; amount: number; hours: number }>()
  for (const ck of filteredCheckins.value) {
    const course = courses.byId(ck.course_id)
    if (!course || !course.total_hours) continue
    const pricePerHour = course.total_amount / course.total_hours
    const cur = acc.get(ck.course_id) ?? {
      name: course.name,
      amount: 0,
      hours: 0,
    }
    cur.amount += pricePerHour * ck.hours
    cur.hours += ck.hours
    acc.set(ck.course_id, cur)
  }
  return Array.from(acc.values())
    .filter((r) => r.amount > 0)
    .map((r) => ({ name: r.name, value: Math.round(r.amount) }))
})

/**
 * 柱图数据：used = 期间内 hours；remain = 该课程**当前真实剩余**
 *   - ⚠️ 原来 remain = total_hours - 期间内used，把「期间之前就已经上掉的课时」
 *     也算进了"剩余"，数字虚高（堆叠柱看起来刚好到总课时，语义却是错的）。
 *     courses store 的 used_hours 是该 child 全量打卡的聚合 → 真实剩余 = total_hours - used_hours
 *   - 只显示期间内有过打卡的课程（remain 截断到 0 防止出现负数）
 */
const barRows = computed<Array<{ name: string; used: number; remain: number }>>(() => {
  const acc = new Map<string, { name: string; used: number; total: number; totalUsed: number }>()
  for (const ck of filteredCheckins.value) {
    const course = courses.byId(ck.course_id)
    if (!course) continue
    const cur = acc.get(ck.course_id) ?? {
      name: course.name,
      used: 0,
      total: course.total_hours,
      totalUsed: course.used_hours,
    }
    cur.used += ck.hours
    acc.set(ck.course_id, cur)
  }
  return Array.from(acc.values()).map((r) => ({
    name: r.name,
    used: Math.round(r.used * 100) / 100,
    remain: Math.max(0, Math.round((r.total - r.totalUsed) * 100) / 100),
  }))
})

const hasFilteredData = computed(() => pieRows.value.length > 0 && barRows.value.length > 0)
const isAllTime = computed(() => preset.value === 'all')
const isCustomRange = computed(() => preset.value === 'custom')

onMounted(() => {
  checkins.refresh()
  courses.refresh()
})
</script>

<template>
  <div class="h-full overflow-y-auto dark-page p-6">
    <header class="mb-5 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-dark-title">统计分析</h1>
        <p class="text-sm text-dark-soft">开销分布 + 课时消耗</p>
      </div>
    </header>

    <!-- 期间筛选 -->
    <div class="glass-card mb-4 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm font-medium" style="color: var(--text-body);">时间范围：</span>
        <div style="display: inline-flex;">
          <button
            class="btn-dark-ghost"
            :style="preset === 'all' ? 'background: rgba(63,184,122,0.15); color: var(--brand-text); border-color: rgba(63,184,122,0.4);' : ''"
            style="border-radius: 10px 0 0 10px; font-size: 12px; padding: 6px 12px;"
            @click="applyPreset('all')"
          >全部</button>
          <button
            class="btn-dark-ghost"
            :style="preset === 'month' ? 'background: rgba(63,184,122,0.15); color: var(--brand-text); border-color: rgba(63,184,122,0.4);' : ''"
            style="border-radius: 0; border-left: 0; font-size: 12px; padding: 6px 12px;"
            @click="applyPreset('month')"
          >近 30 天</button>
          <button
            class="btn-dark-ghost"
            :style="preset === 'quarter' ? 'background: rgba(63,184,122,0.15); color: var(--brand-text); border-color: rgba(63,184,122,0.4);' : ''"
            style="border-radius: 0; border-left: 0; font-size: 12px; padding: 6px 12px;"
            @click="applyPreset('quarter')"
          >近 90 天</button>
          <button
            class="btn-dark-ghost"
            :style="preset === 'year' ? 'background: rgba(63,184,122,0.15); color: var(--brand-text); border-color: rgba(63,184,122,0.4);' : ''"
            style="border-radius: 0 10px 10px 0; border-left: 0; font-size: 12px; padding: 6px 12px;"
            @click="applyPreset('year')"
          >近 1 年</button>
        </div>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          class="!w-72"
          @change="onDateRangeChange"
        />
        <div class="flex-1" />
        <span class="text-sm text-dark-soft">
          期间内：<b class="text-dark-title">{{ periodStats.count }}</b> 次打卡 ·
          <b class="text-dark-title">{{ periodStats.hours }}</b> 节 ·
          约 <b class="text-dark-title">{{ formatMoney(Math.round(periodStats.amount)) }}</b>
        </span>
      </div>
    </div>

    <!-- 饼图 + 柱图 -->
    <div class="grid grid-cols-2 gap-4">
      <div class="glass-card p-5">
        <h3 class="mb-3 font-bold text-dark-title">🥧 {{ isAllTime ? '各课程开销占比' : '期间内各课程开销占比' }}</h3>
        <div class="h-80">
          <CostPieChart
            :rows="pieRows"
            :center-label="isAllTime ? '已消耗（折算）' : '期间折算'"
            :empty-title="hasFilteredData ? '' : (isAllTime ? '还没有课程数据' : '该时段无打卡数据')"
            :empty-desc="hasFilteredData ? '' : (isAllTime ? '添加课程后会按缴费金额占比展示' : (isCustomRange ? '调整日期范围或到「打卡」页补录' : '试试「全部」或换一个时间段'))"
          />
        </div>
        <p class="mt-2 text-center text-xs text-dark-soft">
          <template v-if="isAllTime">
            总投入 {{ formatMoney(courses.totalAmount) }}（实际缴费）
          </template>
          <template v-else>
            期间内折算 {{ formatMoney(periodStats.amount) }}（{{ periodStats.hours }} 节）
          </template>
        </p>
      </div>
      <div class="glass-card p-5">
        <h3 class="mb-3 font-bold text-dark-title">📊 {{ isAllTime ? '各课程课时消耗 vs 剩余' : '期间内各课程消耗 vs 当前剩余' }}</h3>
        <div class="h-80">
          <HoursBarChart
            :rows="barRows"
            :empty-title="hasFilteredData ? '' : (isAllTime ? '还没有课程数据' : '该时段无打卡数据')"
            :empty-desc="hasFilteredData ? '' : (isAllTime ? '添加课程后会按 used / remain 堆叠展示' : (isCustomRange ? '调整日期范围或到「打卡」页补录' : '试试「全部」或换一个时间段'))"
          />
        </div>
        <p class="mt-2 text-center text-xs text-dark-soft">
          <template v-if="isAllTime">
            购 {{ courses.totalHours }} 节 · 已用 {{ courses.usedHours }} 节 · 剩 {{ courses.remainHours }} 节
          </template>
          <template v-else>
            期间内已用 {{ periodStats.hours }} 节 · 涉及 {{ barRows.length }} 门课 · 剩余为当前真实剩余
          </template>
        </p>
      </div>
    </div>

    <!-- 期间内打卡明细 -->
    <div class="glass-card mt-4 p-5">
      <h3 class="mb-3 font-bold text-dark-title">📅 期间内打卡明细</h3>
      <el-table :data="filteredCheckins.slice(0, 50)" stripe max-height="320">
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column label="课程" min-width="160">
          <template #default="{ row }">
            {{ courses.byId(row.course_id)?.name ?? '(已删除)' }}
          </template>
        </el-table-column>
        <el-table-column prop="hours" label="节数" width="80" align="center">
          <template #default="{ row }">
            <el-tag type="warning" effect="plain" round>{{ row.hours }} 节</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="feedback" label="课堂反馈" min-width="240">
          <template #default="{ row }">
            <span v-if="row.feedback" class="text-sm" style="color: var(--text-body);">{{ row.feedback }}</span>
            <span v-else class="text-xs" style="color: var(--text-ghost);">（无）</span>
          </template>
        </el-table-column>
      </el-table>
      <p v-if="filteredCheckins.length > 50" class="mt-2 text-center text-xs" style="color: var(--text-soft);">
        仅显示前 50 条，全部请到「打卡」页查看
      </p>
    </div>
  </div>
</template>
