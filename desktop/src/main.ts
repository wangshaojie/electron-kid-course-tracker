import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
// 手动 import 函数式弹窗样式：unplugin 按需不会处理 JS 直接调用的 ElMessageBox / ElMessage
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-message.css'
// 主题变量必须在 index.css 之前,这样组件样式里 var(--xxx) 才有定义
import './styles/theme.css'
import './styles/index.css'

const T0 = performance.now()
const mark = (label: string) => {
  const dt = (performance.now() - T0).toFixed(0)
  // eslint-disable-next-line no-console
  console.log(`[boot] +${dt}ms ${label}`)
}

/**
 * 早期初始化主题(必须在 createApp 之前)
 *  读 localStorage 'app.theme' → 设 <html data-theme>
 *  避免首屏闪白/闪黑
 *
 * 不依赖 Pinia 实例,直接用裸函数。Pinia 启动后 useThemeStore() 会接管。
 */
function applyEarlyTheme() {
  if (typeof document === 'undefined') return
  let mode: 'dark' | 'light' | 'system' = 'system'
  try {
    const v = localStorage.getItem('app.theme')
    if (v === 'dark' || v === 'light' || v === 'system') mode = v
  } catch { /* ignore */ }
  if (mode === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }
}
applyEarlyTheme()

async function bootstrap() {
  mark('start')
  const app = createApp(App)
  mark('createApp')
  const pinia = createPinia()
  app.use(pinia)
  mark('pinia')
  app.use(router)
  mark('router')

  // 1) 鉴权初始化：尝试从 SDK 持久化的 session 恢复登录态
  const auth = useAuthStore()
  await auth.bootstrap()
  mark('auth.bootstrap')

  // 调试日志：方便排查"重启又被弹回登录页"
  // eslint-disable-next-line no-console
  console.log('[main] bootstrap result', {
    hasJwt: !!auth.token,
    hasUser: !!auth.user,
    isAuthenticated: auth.isAuthenticated,
    status: auth.status,
    ls_jwt: localStorage.getItem('auth.jwt')?.slice(0, 30),
    ls_user: localStorage.getItem('auth.user'),
    ss_jwt: sessionStorage.getItem('auth.jwt')?.slice(0, 30),
  })

  // 2) 等路由首次走完（isReady 只在 status=bootstrapping 时放行）
  await router.isReady()
  mark('router.isReady')

  // 3) bootstrap 后兜底：守卫在 bootstrapping 期只能放行，
  //    这里根据已落定的 auth 状态主动纠偏
  const cur = router.currentRoute.value
  const onPublic = cur.meta?.public === true
  if (!auth.isAuthenticated && !onPublic) {
    await router.replace({ path: '/login', query: { redirect: cur.fullPath } })
  } else if (auth.isAuthenticated && cur.name === 'login') {
    await router.replace('/')
  }
  mark('redirect done')

  app.mount('#app')
  mark('app.mount')
}

bootstrap().catch((err) => {
  console.error('[main] bootstrap failed:', err)
  // 即便鉴权初始化失败也要把页面挂出来，至少能看 /login
  try {
    const app = createApp(App)
    app.use(createPinia())
    app.use(router)
    app.mount('#app')
  } catch (e2) {
    console.error('[main] fallback mount also failed:', e2)
  }
})



