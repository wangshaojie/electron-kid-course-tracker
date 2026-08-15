<script setup lang="ts">
import { computed } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { formatMoney } from '@/utils/money'
import ChartBase from './ChartBase.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const courses = useCoursesStore()

const option = computed(() => {
  const data = courses.summaries.map((c) => ({
    name: c.name,
    value: c.total_amount,
  }))
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${formatMoney(p.value)} (${p.percent}%)`,
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { color: '#6B7280' },
    },
    series: [
      {
        name: '课程开销',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: { show: false },
        labelLine: { show: false },
        data,
        color: ['#3FB87A', '#7AC7FF', '#FFB347', '#B58BFF', '#FF9DB5', '#5FCE89', '#E08A1E', '#7B6BAA'],
      },
    ],
  }
})
</script>

<template>
  <EmptyState v-if="courses.count === 0" icon="🥧" title="还没有课程数据" />
  <ChartBase v-else :option="option" />
</template>
