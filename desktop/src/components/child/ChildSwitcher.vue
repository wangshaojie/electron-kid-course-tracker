<script setup lang="ts">
/**
 * 宝贝切换器 —— 侧栏顶部的下拉（暗色玻璃风）
 *  显示当前宝贝的头像 + 名字，点击展开下拉（切宝贝 / 管理档案）
 */
import { computed, ref, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useChildrenStore } from '@/stores/children'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'

const children = useChildrenStore()
const courses = useCoursesStore()
const checkins = useCheckinsStore()
const router = useRouter()

const current = computed(() => children.active)
const open = ref(false)

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

async function pick(id: string) {
  if (id !== children.activeId) {
    await children.setActive(id)
    courses.refresh()
    checkins.refresh()
  }
  close()
}

function gotoSettings() {
  close()
  void router.push('/settings')
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (!target.closest('[data-child-switcher]')) close()
}

if (typeof window !== 'undefined') {
  document.addEventListener('click', onDocClick)
  onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
}
</script>

<template>
  <div v-if="current" data-child-switcher class="relative">
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
      style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);"
      @click.stop="toggle"
    >
      <div
        class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-2xl"
        :style="{ background: current.color + '22', border: `2px solid ${current.color}` }"
      >
        {{ current.emoji }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate font-bold" style="color: #fff;">{{ current.name }}</p>
        <p class="text-xs" style="color: rgba(255,255,255,0.5);">
          {{ children.count > 1 ? `${children.count} 个宝贝 · 切换` : '点击管理' }}
        </p>
      </div>
      <span
        class="text-xs transition-transform"
        style="color: rgba(255,255,255,0.5);"
        :class="{ 'rotate-180': open }"
      >▾</span>
    </button>

    <transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl py-1"
        style="background: #1a1f2e; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 8px 24px rgba(0,0,0,0.4);"
        @click.stop
      >
        <p
          v-if="children.count > 1"
          class="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wider"
          style="color: rgba(255,255,255,0.4);"
        >
          切换宝贝
        </p>
        <button
          v-for="c in children.items"
          :key="c.id"
          type="button"
          :class="[
            'mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
          ]"
          :style="c.id === children.activeId
            ? { background: 'rgba(63,184,122,0.15)', color: '#fff' }
            : { color: 'rgba(255,255,255,0.85)' }"
          @click="pick(c.id)"
        >
          <div
            class="flex h-7 w-7 items-center justify-center rounded-full text-lg"
            :style="{ background: c.color + '22' }"
          >
            {{ c.emoji }}
          </div>
          <span class="flex-1 truncate">{{ c.name }}</span>
          <span v-if="c.id === children.activeId" style="color: #5FCE89;">✓</span>
        </button>

        <div class="my-1 mx-2" style="border-top: 1px solid rgba(255,255,255,0.06);"></div>

        <button
          type="button"
          class="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors"
          style="color: rgba(255,255,255,0.7);"
          @click="gotoSettings"
        >
          <span class="text-base">⚙️</span>
          <span class="flex-1">管理宝贝档案</span>
          <span class="text-xs" style="color: rgba(255,255,255,0.4);">→</span>
        </button>
      </div>
    </transition>
  </div>
</template>
