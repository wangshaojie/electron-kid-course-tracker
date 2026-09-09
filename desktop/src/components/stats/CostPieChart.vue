<script setup lang="ts">
import { computed } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { formatMoney } from '@/utils/money'
import { useChartTheme } from '@/utils/chartTheme'
import ChartBase from './ChartBase.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const courses = useCoursesStore()
const { mode, get } = useChartTheme()  // mode 建立响应依赖

const totalAmount = computed(() =>
  courses.summaries.reduce((s, c) => s + c.total_amount, 0),
)

const option = computed(() => {
  void mode.value
  const c = get()
  const data = courses.summaries.map((s) => ({
    name: s.name,
    value: s.total_amount,
  }))
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: c.textTitle },
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
      textStyle: { color: c.textBody, fontSize: 11 },
    },
    graphic: [
      {
        type: 'text',
        left: '32%',
        top: '46%',
        style: {
          text: '总投入',
          fill: c.textSoft,
          fontSize: 12,
        },
      },
      {
        type: 'text',
        left: '32%',
        top: '52%',
        style: {
          text: formatMoney(totalAmount.value),
          fill: c.textTitle,
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
          borderColor: c.tooltipBg,
          borderWidth: 2,
        },
        label: {
          show: true,
          position: 'outside',
          formatter: (p: { name: string; percent: number }) =>
            `${p.name}\n${p.percent.toFixed(1)}%`,
          color: c.textBody,
          fontSize: 12,
          lineHeight: 16,
          padding: [4, 4, 4, 4],
        },
        labelLine: {
          show: true,
          length: 10,
          length2: 14,
          lineStyle: {
            color: c.axisLine,
            width: 1,
          },
        },
        labelLayout: {
          hideOverlap: true,
          moveOverlap: 'shiftY',
        },
        data,
        // 调色板:固定几个语义色,跨主题一致(品牌色 + 几个分类色)
        color: [c.brand1, '#7AC7FF', '#FFB347', '#B58BFF', '#FF9DB5', c.brand2, '#E08A1E', '#7B6BAA'],
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
