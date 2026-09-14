<script setup lang="ts">
/**
 * 各课程"已用 vs 剩余"堆叠柱图
 *
 * 数据源约定：父组件传一个 `rows: Array<{ name, used, remain }>` 进来。
 *   - rows 为空时显示空状态
 *   - rows 由父组件根据"时间筛选"自行聚合（保持图表组件纯净，不依赖 store）
 */
import { computed } from 'vue'
import { useChartTheme } from '@/utils/chartTheme'
import ChartBase from './ChartBase.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const props = withDefaults(
  defineProps<{
    rows?: Array<{ name: string; used: number; remain: number }>
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

const option = computed(() => {
  void mode.value  // 主题切换时重算
  const c = get()
  const names = props.rows.map((r) => r.name)
  const used = props.rows.map((r) => r.used)
  const remain = props.rows.map((r) => r.remain)

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
  <EmptyState
    v-if="rows.length === 0"
    icon="📊"
    :title="emptyTitle"
    :desc="emptyDesc"
  />
  <div v-else class="h-full w-full">
    <ChartBase :option="option" />
  </div>
</template>
