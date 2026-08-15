<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  desc?: string
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 py-12 text-center">
    <span class="text-5xl opacity-50">{{ icon || '🌱' }}</span>
    <p class="text-base font-medium text-ink-soft">{{ title }}</p>
    <p v-if="desc" class="max-w-md text-sm text-ink-ghost">{{ desc }}</p>
    <slot />
  </div>
</template>
