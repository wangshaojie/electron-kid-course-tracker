<script setup lang="ts">
/**
 * 主布局：侧栏菜单 + 内容区（暗色玻璃风 v2）
 *  v2: 加宝贝切换器 + 首次启动强制建第一个宝贝
 *  v3: 加当前用户 + 登出
 *  v4: 全暗色玻璃风，匹配 Login 暗色背景
 */
import { useRoute, useRouter } from 'vue-router'
import { computed, ref, onMounted, watch } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useDBStore } from '@/stores/db'
import { useChildrenStore } from '@/stores/children'
import { useAuthStore } from '@/stores/auth'
import ChildSwitcher from '@/components/child/ChildSwitcher.vue'
import ChildCreateDialog from '@/components/child/ChildCreateDialog.vue'
import BrandLogo from '@/components/brand/BrandLogo.vue'

const route = useRoute()
const router = useRouter()
const db = useDBStore()
const children = useChildrenStore()
const auth = useAuthStore()

const firstRunDialogOpen = ref(false)

interface MenuItem {
  path: string
  label: string
  icon: string  // SVG path
}

const menus: MenuItem[] = [
  { path: '/',         label: '首页总览', icon: 'home' },
  { path: '/courses',  label: '课程管理', icon: 'book' },
  { path: '/checkins', label: '上课记录', icon: 'check' },
  { path: '/stats',    label: '统计分析', icon: 'chart' },
  { path: '/settings', label: '设置',     icon: 'cog' },
]

const isAdmin = computed(() => auth.user?.role === 'admin')
const activePath = computed(() => route.path)
const isFirstRun = computed(() => db.ready && children.loaded && children.count === 0)

function go(p: string) {
  if (p === route.path) return
  void router.push(p)
}

function onFirstChildCreated() {
  firstRunDialogOpen.value = false
}

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要登出吗？', '提示', {
      type: 'warning',
      confirmButtonText: '登出',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await auth.signOut()
  ElMessage.success('已登出')
  await router.replace('/login')
}

onMounted(() => {
  setTimeout(() => {
    if (isFirstRun.value) firstRunDialogOpen.value = true
  }, 600)
})

watch(
  () => children.loaded,
  (loaded) => {
    if (loaded && isFirstRun.value) firstRunDialogOpen.value = true
  },
)
</script>

<template>
  <!-- 首次启动全屏引导（盖住一切） -->
  <div
    v-if="isFirstRun"
    class="fixed inset-0 z-40 flex flex-col items-center justify-center p-6"
    style="background: #0a0e1a; color: #fff;"
  >
    <div class="max-w-md text-center">
      <div class="mb-6 text-7xl">🌱</div>
      <h1 class="mb-3 text-3xl font-extrabold" style="color: #fff;">
        欢迎使用《一寸光阴》
      </h1>
      <p class="mb-8 text-base" style="color: rgba(255,255,255,0.65);">
        先建一个宝贝档案<br />可以为家里多个宝贝分别记录
      </p>
      <button
        type="button"
        class="btn-dark-primary"
        style="padding: 12px 24px; font-size: 16px;"
        @click="firstRunDialogOpen = true"
      >
        ➕ 创建第一个宝贝
      </button>
    </div>
  </div>

  <div
    v-show="!isFirstRun"
    class="flex h-full w-full dark-page"
  >
    <!-- 侧栏：暗色玻璃 -->
    <aside class="glass-aside flex w-60 flex-col">
      <!-- 品牌区 -->
      <div class="flex items-center gap-3 px-5 py-5">
        <BrandLogo :size="40" />
        <div>
          <p class="font-bold" style="color: #fff;">一寸光阴</p>
          <p class="text-xs" style="color: rgba(255,255,255,0.45);">云端同步</p>
        </div>
      </div>

      <!-- 宝贝切换器 -->
      <div class="px-3 pb-3">
        <ChildSwitcher />
      </div>

      <!-- 导航 -->
      <nav class="flex-1 px-3 py-2">
        <button
          v-for="m in menus"
          :key="m.path"
          type="button"
          :class="[
            'btn-press mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all',
            activePath === m.path
              ? 'text-white'
              : 'text-white/55 hover:text-white/85',
          ]"
          :style="activePath === m.path ? {
            background: 'linear-gradient(135deg, rgba(63,184,122,0.18) 0%, rgba(63,184,122,0.08) 100%)',
            border: '1px solid rgba(63,184,122,0.25)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          } : { border: '1px solid transparent' }"
          @click="go(m.path)"
        >
          <span class="flex h-5 w-5 items-center justify-center" v-html="iconSvg(m.icon)" />
          <span>{{ m.label }}</span>
        </button>
      </nav>

      <!-- 底部：用户 + 登出 -->
      <div class="border-t px-4 py-3 text-xs" style="border-color: rgba(255,255,255,0.06); color: rgba(255,255,255,0.55);">
        <div v-if="auth.user" class="mb-2 flex items-center gap-2">
          <div
            class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style="background: rgba(63,184,122,0.2); color: #5FCE89;"
          >
            {{ (auth.user.email ?? auth.user.uid).slice(0, 1).toUpperCase() }}
          </div>
          <span class="truncate" :title="auth.user.email ?? auth.user.uid">
            {{ auth.user.email ?? auth.user.uid }}
          </span>
        </div>
        <button
          v-if="isAdmin"
          type="button"
          :class="[
            'btn-press mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs',
            activePath === '/admin'
              ? 'font-semibold'
              : 'hover:text-white',
          ]"
          :style="activePath === '/admin' ? {
            background: 'rgba(63,184,122,0.2)',
            color: '#5FCE89',
          } : { color: 'rgba(95,206,137,0.7)' }"
          @click="go('/admin')"
        >
          🛡 管理员后台
        </button>
        <button
          type="button"
          class="btn-press w-full rounded-md px-2 py-1.5 text-left text-xs hover:text-white"
          style="color: rgba(255,255,255,0.55);"
          @click="handleLogout"
        >
          🚪 登出
        </button>
        <p class="mt-1.5 text-[10px]" style="color: rgba(255,255,255,0.25);">v0.4.0 · 暗色玻璃</p>
      </div>
    </aside>

    <!-- 内容区 -->
    <main class="flex flex-1 flex-col overflow-hidden">
      <slot />
    </main>
  </div>

  <!-- 首次启动弹窗 -->
  <ChildCreateDialog
    v-if="isFirstRun"
    v-model="firstRunDialogOpen"
    :is-first-child="true"
    @saved="onFirstChildCreated"
  />
</template>

<script lang="ts">
/** 内联 SVG 图标（heroicons-style, 24x24） */
const ICONS: Record<string, string> = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2v-9z"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
}
export function iconSvg(name: string): string {
  return ICONS[name] ?? ''
}
</script>

<style scoped>
.btn-press {
  transition: all 0.15s ease;
}
.btn-press:active {
  transform: scale(0.98);
}
</style>
