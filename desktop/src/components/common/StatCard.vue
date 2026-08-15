<script setup lang="ts">
/**
 * 汇总卡片 —— 首页用
 */
interface Props {
  label: string
  value: string | number
  unit?: string
  icon?: string
  /** 颜色：brand/sun/danger/ink */
  tone?: 'brand' | 'sun' | 'danger' | 'ink' | 'sky'
  hint?: string
}

withDefaults(defineProps<Props>(), {
  tone: 'brand',
  unit: '',
  icon: '',
  hint: '',
})

const toneClass: Record<NonNullable<Props['tone']>, string> = {
  brand: 'text-brand-500',
  sun: 'text-sun-500',
  danger: 'text-danger',
  ink: 'text-ink',
  sky: 'text-sky-500',
}

const iconBg: Record<NonNullable<Props['tone']>, string> = {
  brand: 'bg-brand-50 text-brand-500',
  sun: 'bg-orange-50 text-sun-500',
  danger: 'bg-red-50 text-danger',
  ink: 'bg-gray-100 text-ink',
  sky: 'bg-sky-50 text-sky-500',
}
</script>

<template>
  <div class="card-base flex items-center gap-4">
    <div
      v-if="icon"
      :class="[
        'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-2xl',
        iconBg[tone],
      ]"
    >
      {{ icon }}
    </div>
    <div class="flex-1">
      <p class="stat-label">{{ label }}</p>
      <p :class="['stat-num', toneClass[tone]]">
        {{ value }}<span v-if="unit" class="ml-1 text-base font-normal text-ink-soft">{{ unit }}</span>
      </p>
      <p v-if="hint" class="mt-0.5 text-xs text-ink-ghost">{{ hint }}</p>
    </div>
  </div>
</template>
