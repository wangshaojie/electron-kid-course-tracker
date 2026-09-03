<script setup lang="ts">
import { computed } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { formatMoney } from '@/utils/money'
import ChartBase from './ChartBase.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const courses = useCoursesStore()

const totalAmount = computed(() =>
  courses.summaries.reduce((s, c) => s + c.total_amount, 0),
)

const option = computed(() => {
  const data = courses.summaries.map((c) => ({
    name: c.name,
    value: c.total_amount,
  }))
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(20, 25, 40, 0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      textStyle: { color: '#fff' },
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${formatMoney(p.value)} (${p.percent}%)`,
    },
    legend: {
      orient: 'vertical',
      right: 4,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 10,
      textStyle: { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
    },
    graphic: [
      {
        type: 'text',
        left: '32%',
        top: '46%',
        style: {
          text: '总投入',
          fill: 'rgba(255,255,255,0.45)',
          fontSize: 12,
        },
      },
      {
        type: 'text',
        left: '32%',
        top: '52%',
        style: {
          text: formatMoney(totalAmount.value),
          fill: '#fff',
          fontSize: 16,
          fontWeight: 600,
        },
      },
    ],
    series: [
      {
        name: '课程开销',
        type: 'pie',
        radius: ['38%', '62%'],
        center: ['32%', '52%'],
        avoidLabelOverlap: true,
        minShowLabelAngle: 5,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#0a0e1a',
          borderWidth: 2,
        },
        label: {
          show: true,
          position: 'outside',
          formatter: (p: { name: string; percent: number }) =>
            `${p.name}\n${p.percent.toFixed(1)}%`,
          color: 'rgba(255,255,255,0.85)',
          fontSize: 12,
          lineHeight: 16,
          padding: [4, 4, 4, 4],
        },
        labelLine: {
          show: true,
          length: 10,
          length2: 14,
          lineStyle: {
            color: 'rgba(255,255,255,0.25)',
            width: 1,
          },
        },
        labelLayout: {
          hideOverlap: true,
          moveOverlap: 'shiftY',
        },
        data,
        color: ['#5FCE89', '#7AC7FF', '#FFB347', '#B58BFF', '#FF9DB5', '#94DFB0', '#E08A1E', '#7B6BAA'],
      },
    ],
  }
})
</script>

<template>
  <EmptyState v-if="courses.count === 0" icon="🥧" title="还没有课程数据" />
  <div v-else class="h-full w-full">
    <ChartBase :option="option" />
  </div>
</template>
