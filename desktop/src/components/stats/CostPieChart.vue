<script setup lang="ts">
/**
 * 各课程开销占比饼图
 *
 * 数据源约定：父组件传一个 `rows: Array<{ name, value }>` 进来。
 *   - rows 为空时显示空状态
 *   - rows 由父组件根据"时间筛选"自行聚合（保持图表组件纯净，不依赖 store）
 */
import { computed } from 'vue'
import { formatMoney } from '@/utils/money'
import { useChartTheme } from '@/utils/chartTheme'
import ChartBase from './ChartBase.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const props = withDefaults(
  defineProps<{
    rows?: Array<{ name: string; value: number }>
    emptyTitle?: string
    emptyDesc?: string
  }>(),
  {
    rows: () => [],
    emptyTitle: '还没有课程数据',
    emptyDesc: '',
  },
)

const { mode, get } = useChartTheme()  // mode 建立响应依赖

const totalAmount = computed(() =>
  props.rows.reduce((s, r) => s + r.value, 0),
)

const option = computed(() => {
  void mode.value
  const c = get()
  const data = props.rows.map((r) => ({ name: r.name, value: r.value }))
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
  <EmptyState
    v-if="rows.length === 0"
    icon="🥧"
    :title="emptyTitle"
    :desc="emptyDesc"
  />
  <div v-else class="h-full w-full">
    <ChartBase :option="option" />
  </div>
</template>
