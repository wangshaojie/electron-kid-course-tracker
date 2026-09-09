<script setup lang="ts">
import { computed } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { useChartTheme } from '@/utils/chartTheme'
import ChartBase from './ChartBase.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const courses = useCoursesStore()
const { mode, get } = useChartTheme()  // mode 建立响应依赖

const option = computed(() => {
  void mode.value  // 主题切换时重算
  const c = get()
  const summaries = courses.summaries
  const names = summaries.map((s) => s.name)
  const used = summaries.map((s) => s.used_hours)
  const remain = summaries.map((s) => s.remain_hours)

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: c.textTitle },
    },
    legend: {
      data: ['已用', '剩余'],
      top: 10,
      textStyle: { color: c.textBody },
    },
    grid: { left: 50, right: 30, top: 50, bottom: 60 },
    xAxis: {
      type: 'category',
      data: names,
      axisLine: { lineStyle: { color: c.axisLine } },
      axisLabel: { color: c.textBody, interval: 0, rotate: names.length > 4 ? 20 : 0 },
    },
    yAxis: {
      type: 'value',
      name: '节',
      nameTextStyle: { color: c.textSoft },
      axisLine: { show: false },
      axisLabel: { color: c.textSoft },
      splitLine: { lineStyle: { color: c.splitLine } },
    },
    series: [
      {
        name: '已用',
        type: 'bar',
        stack: 'total',
        data: used,
        itemStyle: { color: c.brand1, borderRadius: [0, 0, 0, 0] },
        barWidth: 28,
      },
      {
        name: '剩余',
        type: 'bar',
        stack: 'total',
        data: remain,
        itemStyle: { color: c.brandSoft, borderRadius: [6, 6, 0, 0] },
        barWidth: 28,
      },
    ],
  }
})
</script>

<template>
  <EmptyState v-if="courses.count === 0" icon="📊" title="还没有课程数据" />
  <div v-else class="h-full w-full">
    <ChartBase :option="option" />
  </div>
</template>
