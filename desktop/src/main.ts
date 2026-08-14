import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import './styles/index.css'

const T0 = performance.now()
const mark = (label: string) => {
  const dt = (performance.now() - T0).toFixed(0)
  // eslint-disable-next-line no-console
  console.log(`[boot] +${dt}ms ${label}`)
}

async function bootstrap() {
  mark('start')
  const app = createApp(App)
  mark('createApp')
  const pinia = createPinia()
  app.use(pinia)
  mark('pinia')
  app.use(router)
  mark('router')
  app.use(ElementPlus)
  mark('element-plus')

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
    app.use(ElementPlus)
    app.mount('#app')
  } catch (e2) {
    console.error('[main] fallback mount also failed:', e2)
  }
})



