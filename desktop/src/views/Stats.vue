<script setup lang="ts">
/**
 * 统计分析（暗色玻璃版）
 *  1) 课程开销饼图
 *  2) 课时消耗柱图
 *  3) 时间段筛选
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
  if (p === 'month') from.setMonth(from.getMonth() - 1)
  if (p === 'quarter') from.setMonth(from.getMonth() - 3)
  if (p === 'year') from.setFullYear(from.getFullYear() - 1)
  dateRange.value = [toDateStr(from), todayStr()]
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

onMounted(() => {
  checkins.refresh()
  courses.refresh()
})
</script>

<template>
  <div class="h-full overflow-y-auto dark-page p-6">
    <header class="mb-5 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold" style="color: #fff;">统计分析</h1>
        <p class="text-sm" style="color: rgba(255,255,255,0.5);">开销分布 + 课时消耗</p>
      </div>
    </header>

    <!-- 期间筛选 -->
    <div class="glass-card mb-4 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm font-medium" style="color: rgba(255,255,255,0.7);">时间范围：</span>
        <div style="display: inline-flex;">
          <button
            class="btn-dark-ghost"
            :style="preset === 'all' ? 'background: rgba(63,184,122,0.15); color: #5FCE89; border-color: rgba(63,184,122,0.4);' : ''"
            style="border-radius: 10px 0 0 10px; font-size: 12px; padding: 6px 12px;"
            @click="applyPreset('all')"
          >全部</button>
          <button
            class="btn-dark-ghost"
            :style="preset === 'month' ? 'background: rgba(63,184,122,0.15); color: #5FCE89; border-color: rgba(63,184,122,0.4);' : ''"
            style="border-radius: 0; border-left: 0; font-size: 12px; padding: 6px 12px;"
            @click="applyPreset('month')"
          >近 30 天</button>
          <button
            class="btn-dark-ghost"
            :style="preset === 'quarter' ? 'background: rgba(63,184,122,0.15); color: #5FCE89; border-color: rgba(63,184,122,0.4);' : ''"
            style="border-radius: 0; border-left: 0; font-size: 12px; padding: 6px 12px;"
            @click="applyPreset('quarter')"
          >近 90 天</button>
          <button
            class="btn-dark-ghost"
            :style="preset === 'year' ? 'background: rgba(63,184,122,0.15); color: #5FCE89; border-color: rgba(63,184,122,0.4);' : ''"
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
          @change="preset = 'custom'"
        />
        <div class="flex-1" />
        <span class="text-sm" style="color: rgba(255,255,255,0.55);">
          期间内：<b style="color: #fff;">{{ periodStats.count }}</b> 次打卡 ·
          <b style="color: #fff;">{{ periodStats.hours }}</b> 节 ·
          约 <b style="color: #fff;">{{ formatMoney(Math.round(periodStats.amount)) }}</b>
        </span>
      </div>
    </div>

    <!-- 饼图 + 柱图 -->
    <div class="grid grid-cols-2 gap-4">
      <div class="glass-card p-5">
        <h3 class="mb-3 font-bold" style="color: #fff;">🥧 各课程开销占比</h3>
        <div class="h-80">
          <CostPieChart />
        </div>
        <p class="mt-2 text-center text-xs" style="color: rgba(255,255,255,0.4);">
          总投入 {{ formatMoney(courses.totalAmount) }}
        </p>
      </div>
      <div class="glass-card p-5">
        <h3 class="mb-3 font-bold" style="color: #fff;">📊 各课程课时消耗 vs 剩余</h3>
        <div class="h-80">
          <HoursBarChart />
        </div>
        <p class="mt-2 text-center text-xs" style="color: rgba(255,255,255,0.4);">
          购 {{ courses.totalHours }} 节 · 已用 {{ courses.usedHours }} 节 · 剩 {{ courses.remainHours }} 节
        </p>
      </div>
    </div>

    <!-- 期间内打卡明细 -->
    <div class="glass-card mt-4 p-5">
      <h3 class="mb-3 font-bold" style="color: #fff;">📅 期间内打卡明细</h3>
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
            <span v-if="row.feedback" class="text-sm" style="color: rgba(255,255,255,0.7);">{{ row.feedback }}</span>
            <span v-else class="text-xs" style="color: rgba(255,255,255,0.3);">（无）</span>
          </template>
        </el-table-column>
      </el-table>
      <p v-if="filteredCheckins.length > 50" class="mt-2 text-center text-xs" style="color: rgba(255,255,255,0.4);">
        仅显示前 50 条，全部请到「打卡」页查看
      </p>
    </div>
  </div>
</template>
