<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  desc?: string
}>()
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-3 py-12 text-center"
    style="color: var(--text-body);"
  >
    <span class="text-5xl opacity-60">{{ icon || '🌱' }}</span>
    <p class="text-base font-medium" style="color: var(--text-body);">{{ title }}</p>
    <p v-if="desc" class="max-w-md text-sm" style="color: var(--text-soft);">{{ desc }}</p>
    <slot />
  </div>
</template>
