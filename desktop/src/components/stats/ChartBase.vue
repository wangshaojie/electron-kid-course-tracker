<script setup lang="ts">
/**
 * ECharts 通用封装 —— 自动 resize + 卸载释放
 */
import { ref, onMounted, onUnmounted, watch, shallowRef } from 'vue'
import * as echarts from 'echarts/core'
import type { ECharts } from 'echarts/core'
import { PieChart, BarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  PieChart,
  BarChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  CanvasRenderer,
])

interface Props {
  option: Record<string, unknown>
}
const props = defineProps<Props>()

const containerRef = ref<HTMLDivElement | null>(null)
const chart = shallowRef<ECharts | null>(null)

function init() {
  if (!containerRef.value) return
  chart.value = echarts.init(containerRef.value)
  chart.value.setOption(props.option)
}

function handleResize() {
  chart.value?.resize()
}

onMounted(() => {
  init()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chart.value?.dispose()
  chart.value = null
})

watch(
  () => props.option,
  (v) => {
    chart.value?.setOption(v, true)
  },
  { deep: true },
)
</script>

<template>
  <div ref="containerRef" class="h-full w-full" />
</template>
