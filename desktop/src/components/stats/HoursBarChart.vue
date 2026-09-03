<script setup lang="ts">
import { computed } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import ChartBase from './ChartBase.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const courses = useCoursesStore()

const option = computed(() => {
  const summaries = courses.summaries
  const names = summaries.map((s) => s.name)
  const used = summaries.map((s) => s.used_hours)
  const remain = summaries.map((s) => s.remain_hours)

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(20, 25, 40, 0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      textStyle: { color: '#fff' },
    },
    legend: {
      data: ['已用', '剩余'],
      top: 10,
      textStyle: { color: 'rgba(255,255,255,0.75)' },
    },
    grid: { left: 50, right: 30, top: 50, bottom: 60 },
    xAxis: {
      type: 'category',
      data: names,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
      axisLabel: { color: 'rgba(255,255,255,0.65)', interval: 0, rotate: names.length > 4 ? 20 : 0 },
    },
    yAxis: {
      type: 'value',
      name: '节',
      nameTextStyle: { color: 'rgba(255,255,255,0.5)' },
      axisLine: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.5)' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [
      {
        name: '已用',
        type: 'bar',
        stack: 'total',
        data: used,
        itemStyle: { color: '#3FB87A', borderRadius: [0, 0, 0, 0] },
        barWidth: 28,
      },
      {
        name: '剩余',
        type: 'bar',
        stack: 'total',
        data: remain,
        itemStyle: { color: 'rgba(95,206,137,0.35)', borderRadius: [6, 6, 0, 0] },
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
