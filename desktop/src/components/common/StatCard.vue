<script setup lang="ts">
/**
 * 汇总卡片 —— 首页用（暗色玻璃版）
 */
interface Props {
  label: string
  value: string | number
  unit?: string
  icon?: string
  /** 颜色：brand/sun/danger/ink/sky */
  tone?: 'brand' | 'sun' | 'danger' | 'ink' | 'sky'
  hint?: string
}

withDefaults(defineProps<Props>(), {
  tone: 'brand',
  unit: '',
  icon: '',
  hint: '',
})

const iconBg: Record<NonNullable<Props['tone']>, string> = {
  brand:  'rgba(63,184,122,0.18)',
  sun:    'rgba(224,138,30,0.18)',
  danger: 'rgba(217,69,69,0.18)',
  ink:    'rgba(255,255,255,0.08)',
  sky:    'rgba(125,179,255,0.18)',
}
</script>

<template>
  <div class="glass-card flex items-center gap-4 p-4">
    <div
      v-if="icon"
      class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-2xl"
      :style="{ background: iconBg[tone] }"
    >
      {{ icon }}
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-xs" style="color: rgba(255,255,255,0.55); letter-spacing: 0.04em;">{{ label }}</p>
      <p
        class="glass-num text-[28px] leading-tight tracking-tight num-fade"
        :class="{
          'tone-sun': tone === 'sun',
          'tone-danger': tone === 'danger',
        }"
      >
        {{ value }}<span v-if="unit" class="ml-1.5 text-sm font-normal" style="color: rgba(255,255,255,0.5); -webkit-text-fill-color: rgba(255,255,255,0.5); background: none;">{{ unit }}</span>
      </p>
      <p v-if="hint" class="mt-1 text-xs" style="color: rgba(255,255,255,0.35);">{{ hint }}</p>
    </div>
  </div>
</template>
