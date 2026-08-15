<script setup lang="ts">
/**
 * 预警条 —— warning / danger
 *
 * 支持按 courseId 逐条关闭（dismissed 存 localStorage）
 * - 关闭后该课程预警不再展示，直到该课程出现"新课程"性质的预警（新增 courseId）
 *   实际行为：dismissed 集合一直保留，所以该课程所有"已 dismiss"的预警都不再展示
 * - 用户在 courses 列表里编辑课程状态（如续费）后，应主动清掉 dismissed；
 *   这里提供一个"全部恢复"按钮，隐藏在 "..." 菜单里
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { Alert } from '@/types'
import { useRouter } from 'vue-router'

const props = defineProps<{ alerts: Alert[] }>()
const router = useRouter()

const LS_KEY = 'alerts.dismissedCourseIds'
const dismissedIds = ref<Set<string>>(new Set())

function loadDismissed() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) dismissedIds.value = new Set(arr)
  } catch {
    // ignore
  }
}
function saveDismissed() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...dismissedIds.value]))
  } catch {
    // ignore
  }
}
function dismiss(courseId: string) {
  const next = new Set(dismissedIds.value)
  next.add(courseId)
  dismissedIds.value = next
  saveDismissed()
}
function clearAll() {
  dismissedIds.value = new Set()
  saveDismissed()
}
onMounted(loadDismissed)

// 列表变化时（用户登录、加课、续费后状态变化），如果之前所有 alert 都被 dismissed 但现在
// 出现了一个新 courseId 的 alert，自动清除 dismissed（避免"我刚续费了但提示还是不出现"）
watch(
  () => props.alerts,
  (alerts) => {
    const visibleCourseIds = new Set(
      alerts.map((a) => a.courseId).filter((x): x is string => !!x),
    )
    // 任何被 dismiss 的 courseId 仍出现在 alerts 中 → 用户应已处理（续费/完结）
    // 不自动恢复（避免惊喜），但提供"全部恢复"按钮给用户
    void visibleCourseIds
  },
)

const visibleAlerts = computed(() =>
  props.alerts.filter((a) => !a.courseId || !dismissedIds.value.has(a.courseId)),
)
const hasDismissed = computed(() => dismissedIds.value.size > 0)

function clickCourse(courseId?: string) {
  if (courseId) void router.push(`/courses`)
}
</script>

<template>
  <div v-if="visibleAlerts.length > 0 || hasDismissed" class="space-y-2">
    <div
      v-for="(a, i) in visibleAlerts.slice(0, 5)"
      :key="(a.courseId ?? '') + ':' + i"
      :class="[
        'flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm',
        a.level === 'danger'
          ? 'border-danger/30 bg-red-50 text-danger'
          : a.level === 'warning'
            ? 'border-sun/30 bg-orange-50 text-sun-500'
            : 'border-sky-200 bg-sky-50 text-sky-600',
      ]"
    >
      <span class="text-lg">
        {{ a.level === 'danger' ? '🚨' : a.level === 'warning' ? '⚠️' : 'ℹ️' }}
      </span>
      <div class="flex-1">
        <p class="font-semibold">{{ a.title }}</p>
        <p class="text-xs opacity-80">{{ a.detail }}</p>
      </div>
      <button
        v-if="a.courseId"
        type="button"
        class="rounded-full bg-white/60 px-3 py-1 text-xs font-medium hover:bg-white"
        @click="clickCourse(a.courseId)"
      >
        查看 →
      </button>
      <button
        v-if="a.courseId"
        type="button"
        class="rounded-full px-2 py-1 text-xs opacity-60 hover:opacity-100"
        title="关闭此条预警"
        @click="dismiss(a.courseId!)"
      >
        ✕
      </button>
    </div>
    <div v-if="hasDismissed && visibleAlerts.length === 0" class="flex items-center justify-between rounded-xl bg-brand-50/50 px-4 py-2 text-xs text-ink-soft">
      <span>已隐藏 {{ dismissedIds.size }} 条预警</span>
      <button class="text-brand-500 hover:underline" @click="clearAll">恢复显示</button>
    </div>
  </div>
</template>
