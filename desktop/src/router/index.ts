import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true } },
  { path: '/', name: 'home', component: () => import('@/views/Home.vue') },
  { path: '/courses', name: 'courses', component: () => import('@/views/Courses.vue') },
  { path: '/checkins', name: 'checkins', component: () => import('@/views/Checkins.vue') },
  { path: '/stats', name: 'stats', component: () => import('@/views/Stats.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

/**
 * 导航守卫：
 *  - 启动期（auth.status === 'bootstrapping'）→ 放行到 / 让 App.vue 等
 *  - 已登录访问 /login → 跳 /
 *  - 未登录访问受保护页 → 跳 /login?redirect=xxx
 *  - bootstrap 阶段访问受保护页 → 等 bootstrap 完成后再判断
 */
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 启动期不应再触发（main.ts 会 await bootstrap 完才 mount，路由首次走 isReady 时
  // 守卫会被调用一次，但那时 status 一定是 'bootstrapping'，只能放行——main.ts 兜底 redirect）
  if (auth.status === 'bootstrapping') {
    return true
  }

  if (to.meta.public) {
    if (auth.isAuthenticated && to.name === 'login') {
      return { path: '/' }
    }
    return true
  }

  if (!auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  return true
})
