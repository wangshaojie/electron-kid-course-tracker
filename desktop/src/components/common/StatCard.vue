<script setup lang="ts">
/**
 * 汇总卡片 —— 首页用(主题感知版)
 *  - 高度统一:外层 grid 拉伸 + 内部 flex-col min-h 撑满
 *  - icon 底色:跟主题走(浅色版用浅色高亮,深色版用半透明)
 */
interface Props {
  label: string
  value: string | number
  unit?: string
  icon?: string
  /** 颜色:brand/sun/danger/ink/sky */
  tone?: 'brand' | 'sun' | 'danger' | 'ink' | 'sky'
  hint?: string
}

withDefaults(defineProps<Props>(), {
  tone: 'brand',
  unit: '',
  icon: '',
  hint: '',
})

/** 图标底色 —— 走 CSS 变量,浅色下是淡彩,深色下是半透明色块 */
const iconBg: Record<NonNullable<Props['tone']>, string> = {
  brand:  'var(--brand-soft-bg-2)',
  sun:    'rgba(224,138,30,0.15)',     // 浅色下也是浅橙
  danger: 'var(--danger-soft-bg)',
  ink:    'var(--btn-ghost-bg)',
  sky:    'rgba(125,179,255,0.15)',
}
</script>

<template>
  <div class="glass-card stat-card h-full p-4">
    <div
      v-if="icon"
      class="stat-icon flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
      :style="{ background: iconBg[tone] }"
    >
      {{ icon }}
    </div>
    <div class="stat-body">
      <p class="stat-label text-xs" style="color: var(--text-soft); letter-spacing: 0.04em;">{{ label }}</p>
      <p
        class="glass-num text-[28px] leading-tight tracking-tight num-fade"
        :class="{
          'tone-sun': tone === 'sun',
          'tone-danger': tone === 'danger',
        }"
      >
        {{ value }}<span v-if="unit" class="ml-1.5 text-sm font-normal" style="color: var(--text-soft); -webkit-text-fill-color: var(--text-soft); background: none;">{{ unit }}</span>
      </p>
      <p v-if="hint" class="mt-1 text-xs" style="color: var(--text-soft);">{{ hint }}</p>
      <!-- 没有 hint 时用占位元素撑高,保证 4 张卡高度一致 -->
      <p v-else class="mt-1 text-xs invisible" aria-hidden="true">·</p>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  /* 高度自适应内容即可,无需 stretch —— grid 父级已 stretch 到最高 item */
  min-height: 88px;
}
/* grid 布局:左 icon(固定) + 右 body(占满 + 垂直居中) */
.stat-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}
.stat-body {
  /* flex-col + justify-center 让内容真正垂直居中(高度由 grid 撑满) */
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}
.stat-label {
  /* 强制一行,过长截断 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
