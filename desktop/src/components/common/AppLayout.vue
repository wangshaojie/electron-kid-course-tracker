<script setup lang="ts">
/**
 * 主布局：侧栏菜单 + 顶栏 + 内容区
 *  v2: 加宝贝切换器 + 首次启动强制建第一个宝贝
 *  v3: 加当前用户 + 登出
 */
import { useRoute, useRouter } from 'vue-router'
import { computed, ref, onMounted, watch } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useDBStore } from '@/stores/db'
import { useChildrenStore } from '@/stores/children'
import { useAuthStore } from '@/stores/auth'
import ChildSwitcher from '@/components/child/ChildSwitcher.vue'
import ChildCreateDialog from '@/components/child/ChildCreateDialog.vue'

const route = useRoute()
const router = useRouter()
const db = useDBStore()
const children = useChildrenStore()
const auth = useAuthStore()

const firstRunDialogOpen = ref(false)

interface MenuItem {
  path: string
  label: string
  icon: string
}

const menus: MenuItem[] = [
  { path: '/', label: '首页总览', icon: '🏠' },
  { path: '/courses', label: '课程管理', icon: '📚' },
  { path: '/checkins', label: '上课记录', icon: '✅' },
  { path: '/stats', label: '统计分析', icon: '📈' },
  { path: '/settings', label: '设置', icon: '⚙️' },
]

// 管理员菜单（侧栏底部独立入口，仅 admin 角色可见）
// 路由守卫二次校验：非 admin 直接访问 /admin 也会被踢回 /
const isAdmin = computed(() => auth.user?.role === 'admin')

const activePath = computed(() => route.path)
const isFirstRun = computed(
  () => db.ready && children.loaded && children.count === 0,
)

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
    return // 用户取消
  }
  await auth.signOut()
  ElMessage.success('已登出')
  await router.replace('/login')
}

onMounted(() => {
  // 兜底：如果 App.vue 还没加载完，1.5s 后仍未就绪则打开首次启动
  setTimeout(() => {
    if (isFirstRun.value) firstRunDialogOpen.value = true
  }, 600)
})

// children.load() 完成后，如果仍处于首启（loaded=true 且 count=0）就开 dialog
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
    class="fixed inset-0 z-40 flex flex-col items-center justify-center bg-gradient-to-br from-moss-50 to-cream-DEFAULT p-6"
  >
    <div class="max-w-md text-center">
      <div class="mb-6 text-7xl animate-bounce">🌱</div>
      <h1 class="mb-3 font-display text-3xl font-extrabold text-ink">
        欢迎使用《一寸光阴》
      </h1>
      <p class="mb-8 text-base text-ink-soft">
        先建一个宝贝档案<br />可以为家里多个宝贝分别记录
      </p>
      <button
        type="button"
        class="btn-press rounded-full bg-moss-500 px-8 py-3 font-display text-lg font-bold text-white shadow-moss hover:bg-moss-600"
        @click="firstRunDialogOpen = true"
      >
        ➕ 创建第一个宝贝
      </button>
    </div>
  </div>

  <!-- 正常布局（首次启动时也渲染但被遮罩挡住；保证 ChildSwitcher 等组件挂载稳定） -->
  <div
    v-show="!isFirstRun"
    class="flex h-full w-full bg-bg"
  >
    <!-- 侧栏 -->
    <aside
      class="flex w-60 flex-col border-r border-brand-100 bg-white"
    >
      <div class="flex items-center gap-3 px-5 py-4">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-moss-400 text-2xl text-white shadow-soft"
        >
          📚
        </div>
        <div>
          <p class="font-bold text-ink">一寸光阴</p>
          <p class="text-xs text-ink-soft">云端同步</p>
        </div>
      </div>

      <!-- 宝贝切换器 -->
      <div class="px-3 pb-3">
        <ChildSwitcher />
      </div>

      <nav class="flex-1 px-3 py-2">
        <button
          v-for="m in menus"
          :key="m.path"
          type="button"
          :class="[
            'btn-press mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
            activePath === m.path
              ? 'bg-moss-50 text-moss-600'
              : 'text-ink-soft hover:bg-moss-50/50 hover:text-ink',
          ]"
          @click="go(m.path)"
        >
          <span class="text-lg">{{ m.icon }}</span>
          <span>{{ m.label }}</span>
        </button>
      </nav>

      <div class="border-t border-moss-50 px-5 py-3 text-xs text-ink-ghost">
        <div v-if="auth.user" class="mb-2 flex items-center gap-2">
          <div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-moss-100 text-xs font-bold text-moss-700">
            {{ (auth.user.email ?? auth.user.uid).slice(0, 1).toUpperCase() }}
          </div>
          <span class="truncate" :title="auth.user.email ?? auth.user.uid">{{ auth.user.email ?? auth.user.uid }}</span>
        </div>
        <button
          v-if="isAdmin"
          type="button"
          :class="[
            'btn-press mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs',
            activePath === '/admin'
              ? 'bg-moss-100 text-moss-700 font-semibold'
              : 'text-moss-600 hover:bg-moss-50',
          ]"
          @click="go('/admin')"
        >
          🛡 管理员后台
        </button>
        <button
          type="button"
          class="btn-press mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-soft hover:bg-moss-50 hover:text-moss-600"
          @click="handleLogout"
        >
          🚪 登出
        </button>
        <p class="mt-1.5 text-[10px] text-ink-ghost">v0.2.0 · 多宝贝支持</p>
        <p class="mt-0.5 truncate" :title="db.dbPath">{{ db.dbPath || '—' }}</p>
      </div>
    </aside>

    <!-- 内容区 -->
    <main class="flex flex-1 flex-col overflow-hidden">
      <slot />
    </main>
  </div>

  <!-- 首次启动弹窗 —— 必须在最顶层（z-50），且不在 v-else 内，否则首启时根本不渲染 -->
  <ChildCreateDialog
    v-if="isFirstRun"
    v-model="firstRunDialogOpen"
    :is-first-child="true"
    @saved="onFirstChildCreated"
  />
</template>

<style scoped>
.btn-press {
  transition: all 0.15s ease;
}
.btn-press:active {
  transform: scale(0.98);
}
</style>
