import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import { getApiConfigError } from './lib/cloudbase'
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

/**
 * 渲染"启动失败"错误页
 * --------------------------------------------------------------
 * 不用 Vue / Element Plus 渲染 —— 出问题时挂掉的正是 Vue 启动链路本身。
 * 直接写 DOM + 内联样式，保证在任何构建产物里都能显示出来（替代白屏）。
 */
function renderFatalError(title: string, detail: string, hint: string) {
  const root = document.getElementById('app') ?? document.body
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F7FAF8;padding:24px;box-sizing:border-box">
      <div style="max-width:560px;width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px 32px;box-shadow:0 2px 12px rgba(0,0,0,.06);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#1F2937">
        <div style="font-size:18px;font-weight:600;color:#1F2937;margin-bottom:12px">${title}</div>
        <div style="font-size:14px;line-height:1.7;margin-bottom:16px">${detail}</div>
        <div style="background:#F0FDF4;border-left:3px solid #3FB87A;border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.7;color:#374151">${hint}</div>
      </div>
    </div>
  `
}

async function bootstrap() {
  mark('start')

  // 0) 启动自检：接口地址缺失时给出可读错误页，而不是白屏
  //    （GitHub Secret 被删会解析成空串并覆盖 .env，历史上一度导致打包产物白屏）
  const cfgError = getApiConfigError()
  if (cfgError) {
    renderFatalError(
      '应用配置缺失，无法启动',
      `${cfgError}。<br>这两个地址需要在<strong>构建时</strong>注入，运行后再改配置文件无效。`,
      '如果你是自己打包安装的程序：请到仓库 Settings → Secrets and variables → Actions 确认 '
        + '<code>VITE_AUTH_OTP_URL</code> 与 <code>VITE_DATA_API_URL</code> 都已设置，然后重新打包安装。<br>'
        + '注意：secret 被删除时会被解析成空字符串并覆盖 .env，产物里地址会变成空值。',
    )
    return
  }

  const app = createApp(App)
  mark('createApp')
  const pinia = createPinia()
  app.use(pinia)
  mark('pinia')
  app.use(router)
  mark('router')
  // 日期组件 / 分页 / 弹窗等内置文案 → 改为中文
  // 按需引入场景下 element-plus 的 i18n 用 <el-config-provider :locale="zhCn"> 包裹根组件
  // 全局配置不依赖 globalProperties.$ELEMENT 兜底（按需引入下 fallback 不稳）
  // 文档：https://element-plus.org/zh-CN/guide/i18n.html#configprovider
  mark('element-plus locale (via ElConfigProvider in App.vue)')

  // 1) 鉴权初始化：尝试从 SDK 持久化的 session 恢复登录态
  const auth = useAuthStore()
  await auth.bootstrap()
  mark('auth.bootstrap')

  // 调试日志：方便排查"重启又被弹回登录页"
  // ⚠️ 不要打印 JWT / 邮箱内容：生产包虽然默认不开 DevTools，但日志会进
  //    userData/boot.log（用户可查看、可外发），泄露登录凭证没有意义。
  // eslint-disable-next-line no-console
  console.log('[main] bootstrap result', {
    hasJwt: !!auth.token,
    hasUser: !!auth.user,
    isAuthenticated: auth.isAuthenticated,
    status: auth.status,
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
    // 连兜底挂载都失败了 —— 别留白屏，把原因显示出来
    renderFatalError(
      '应用启动失败',
      `启动过程中出现异常，且兜底挂载也失败了：${String(e2)}`,
      '可以打开开发者工具（Ctrl+Shift+I）查看 Console 里的完整错误日志。',
    )
  }
})



