<script setup lang="ts">
/**
 * BrandLogo —— 「一寸光阴」品牌 logo
 *
 * 视觉：圆环内嵌一本书 + 时钟指针意象，呼应"一寸光阴一寸金"
 * - 外圆：薄荷绿渐变（品牌主色）
 * - 书页：白色半透明，描边亮色
 * - 指针：暖橙（品牌点缀色）
 * - hover：缓慢自转 8s
 *
 * 用法：<BrandLogo :size="64" />
 */
defineProps<{
  size?: number
}>()
</script>

<template>
  <svg
    :width="size ?? 64"
    :height="size ?? 64"
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="brand-logo"
    aria-label="一寸光阴 logo"
  >
    <defs>
      <!-- 外圆渐变：薄荷绿 -->
      <linearGradient id="brand-ring" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#5FCE89" />
        <stop offset="1" stop-color="#2A9D63" />
      </linearGradient>
      <!-- 书页渐变：白到薄荷 -->
      <linearGradient id="brand-page" x1="20" y1="22" x2="44" y2="44" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95" />
        <stop offset="1" stop-color="#EAF8F0" stop-opacity="0.85" />
      </linearGradient>
      <!-- 指针渐变：暖橙 -->
      <linearGradient id="brand-hand" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FFB347" />
        <stop offset="1" stop-color="#E08A1E" />
      </linearGradient>
      <!-- 阴影 -->
      <filter id="brand-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- 外圆环（品牌主色） -->
    <circle cx="32" cy="32" r="28" fill="url(#brand-ring)" />
    <!-- 内圈描边，营造厚度感 -->
    <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1" />

    <!-- 书页（左侧翻起 + 右侧平铺） -->
    <g filter="url(#brand-glow)">
      <!-- 左页 -->
      <path
        d="M32 20 L20 22 L20 44 L32 42 Z"
        fill="url(#brand-page)"
        stroke="rgba(255,255,255,0.6)"
        stroke-width="0.6"
      />
      <!-- 右页 -->
      <path
        d="M32 20 L44 22 L44 44 L32 42 Z"
        fill="url(#brand-page)"
        stroke="rgba(255,255,255,0.6)"
        stroke-width="0.6"
      />
      <!-- 书脊 -->
      <line x1="32" y1="20" x2="32" y2="42" stroke="rgba(63,184,122,0.5)" stroke-width="0.8" />
      <!-- 书页文字线 -->
      <line x1="23" y1="28" x2="29" y2="27.4" stroke="rgba(63,184,122,0.55)" stroke-width="0.7" stroke-linecap="round" />
      <line x1="23" y1="31" x2="29" y2="30.4" stroke="rgba(63,184,122,0.55)" stroke-width="0.7" stroke-linecap="round" />
      <line x1="23" y1="34" x2="29" y2="33.4" stroke="rgba(63,184,122,0.55)" stroke-width="0.7" stroke-linecap="round" />
      <line x1="35" y1="27.4" x2="41" y2="28" stroke="rgba(63,184,122,0.55)" stroke-width="0.7" stroke-linecap="round" />
      <line x1="35" y1="30.4" x2="41" y2="31" stroke="rgba(63,184,122,0.55)" stroke-width="0.7" stroke-linecap="round" />
      <line x1="35" y1="33.4" x2="41" y2="34" stroke="rgba(63,184,122,0.55)" stroke-width="0.7" stroke-linecap="round" />
    </g>

    <!-- 时钟指针（小时 + 分钟），从书脊顶部出发 -->
    <g filter="url(#brand-glow)">
      <!-- 中心圆 -->
      <circle cx="32" cy="20" r="1.6" fill="url(#brand-hand)" />
      <!-- 时针 -->
      <line x1="32" y1="20" x2="27" y2="14" stroke="url(#brand-hand)" stroke-width="1.6" stroke-linecap="round" />
      <!-- 分针 -->
      <line x1="32" y1="20" x2="40" y2="14" stroke="url(#brand-hand)" stroke-width="1.2" stroke-linecap="round" />
    </g>
  </svg>
</template>

<style scoped>
.brand-logo {
  filter: drop-shadow(0 4px 16px rgba(63, 184, 122, 0.45));
  animation: brand-rotate 24s linear infinite;
  transform-origin: 50% 50%;
}

@keyframes brand-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .brand-logo {
    animation: none;
  }
}
</style>
