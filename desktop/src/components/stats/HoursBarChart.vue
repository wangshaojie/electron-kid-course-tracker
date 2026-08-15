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
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['已用', '剩余'], top: 10, textStyle: { color: '#6B7280' } },
    grid: { left: 50, right: 30, top: 50, bottom: 60 },
    xAxis: {
      type: 'category',
      data: names,
      axisLine: { lineStyle: { color: '#E5E7EB' } },
      axisLabel: { color: '#6B7280', interval: 0, rotate: names.length > 4 ? 20 : 0 },
    },
    yAxis: {
      type: 'value',
      name: '节',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#F3F4F6' } },
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
        itemStyle: { color: '#C5EFD5', borderRadius: [6, 6, 0, 0] },
        barWidth: 28,
      },
    ],
  }
})
</script>

<template>
  <EmptyState v-if="courses.count === 0" icon="📊" title="还没有课程数据" />
  <ChartBase v-else :option="option" />
</template>
