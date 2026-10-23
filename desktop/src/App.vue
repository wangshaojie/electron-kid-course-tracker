<script setup lang="ts">
/**
 * App.vue —— 顶层组件
 *
 * 启动期由 main.ts 完成 auth.bootstrap()，App.vue 主要负责挂业务数据
 *
 * 关键：watch auth.isAuthenticated，登录态变化时主动 load children
 * （App.vue 在登录时已经挂载，onMounted 不会再跑）
 */
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppLayout from '@/components/common/AppLayout.vue'
import UpdateDialog from '@/components/common/UpdateDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useDBStore } from '@/stores/db'
import { useChildrenStore } from '@/stores/children'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'
import { useThemeStore } from '@/stores/theme'
import { useUpdateStore } from '@/stores/update'
import { refreshClientMeta } from '@/lib/cloudbase'
// Element Plus 组件按需引入（unplugin-vue-components），
// 但 ElConfigProvider 是个组件壳，locale 是普通对象，必须手动 import
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { errorText } from '@/utils/error'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const db = useDBStore()
const children = useChildrenStore()
const courses = useCoursesStore()
const checkins = useCheckinsStore()
const theme = useThemeStore()
const updateStore = useUpdateStore()

const isLoginPage = computed(() => route.name === 'login')
const initError = ref<string | null>(null)
// 默认 true：登录后立即进入“内容区同步中”态，避免先闪一帧空页面再切 loading
const initializing = ref(true)
let loadingPromise: Promise<void> | null = null
// 本次加载属于哪个账号（uid）。用于区分「同一账号的并发调用」和「切换账号」
let loadingUid = ''
// 加载代次：只有最新一代的加载才能改 initializing / initError，
// 避免旧账号的加载收尾时把新账号的 loading 态关掉
let loadGeneration = 0

/**
 * 切换账号 / 登录前 —— 清空三个 store + 清 localStorage 残留
 * 不清空的话，新账号加载完成前 UI 还会显示前一个账号的数据
 */
function resetBusinessState() {
  try { localStorage.removeItem('kid_active_child_id') } catch { /* ignore */ }
  try { children.items.splice(0); children.activeId = ''; children.loaded = false } catch { /* ignore */ }
  try { courses.items.splice(0) } catch { /* ignore */ }
  try { checkins.items.splice(0) } catch { /* ignore */ }
}

async function loadBusinessData() {
  const uid = auth.user?.uid ?? ''

  if (loadingPromise) {
    // 同一账号的并发触发（onMounted + watch 几乎同时）→ 复用同一次加载
    if (loadingUid === uid) return loadingPromise
    // ⚠️ 换账号了：绝不能像以前那样 `return loadingPromise` 直接丢弃
    //    旧实现的问题：A 的加载在途时登录 B，B 的加载被丢弃且此后没有 watch
    //    会再触发 → 新账号数据永远不加载，界面一直显示 A 的数据，
    //    还会往 B 账号写入 child_id=A 的孤儿行。
    //    现在：等旧的彻底跑完再重跑 —— 旧的写完 store 之后才 reset，
    //    保证新账号的数据不会被旧账号的结果污染。
    const prev = loadingPromise
    try { await prev } catch { /* ignore */ }
    return loadBusinessData()
  }

  const gen = ++loadGeneration
  loadingUid = uid
  const p = (async () => {
    // 关键：先清空前一个账号的内存状态，再 load 新账号
    // 不然会出现"账号 A 退出 → 账号 B 登录 → 还看到 A 的数据"的 bug
    resetBusinessState()
    initializing.value = true
    initError.value = null
    try {
      await db.init()
      // 主题跟用户绑定:登录后从云端同步一次(多设备保持一致)
      // 跟 children 并行,不顺延启动
      void theme.syncFromCloud()
      await children.load()
      if (children.activeIdSafe) {
        await Promise.all([courses.refresh(), checkins.refresh()])
      }
    } catch (e: unknown) {
      const msg = errorText(e, '加载数据失败')
      // 只有最新一代才有权写错误提示（旧的收尾别覆盖新账号的状态）
      if (gen === loadGeneration) {
        initError.value = msg
        ElMessage.error(msg)
      }
    } finally {
      if (gen === loadGeneration) initializing.value = false
    }
  })()
  loadingPromise = p
  try {
    await p
  } finally {
    // 只清理自己发起的那一次，别把后来者的 loadingPromise 清掉
    if (loadingPromise === p) {
      loadingPromise = null
      loadingUid = ''
    }
  }
}

/**
 * 加载失败后的重试
 * --------------------------------------------------------------
 * 之前 initError 只写进 ref 从不渲染 → 加载失败时页面看起来像"数据被清空了"，
 * 用户完全不知道发生了什么，只能杀进程重开。现在错误卡片上带"重新加载"按钮。
 */
function retryLoad() {
  initError.value = null
  void loadBusinessData()
}

/**
 * 版本更新：状态机 + IPC 监听都在 stores/update.ts，UI 在 UpdateDialog.vue。
 *  发现新版本 → 确认框（立即更新 / 稍后再说）
 *  → 下载进度弹框（百分比 / 大小 / 速度）
 *  → 下载完成 → "立即重启并安装"（主进程退出 + 拉起装包，装完自动开新版本）
 * 这里只负责把监听挂上（onMounted 调一次，卸载时解绑）。
 */
let unbindUpdater: (() => void) | null = null
function registerUpdater() {
  unbindUpdater = updateStore.bindUpdater()
}

onMounted(() => {
  registerUpdater()
  // 拉当前版本到 store（Settings.vue / 关于卡展示用）
  void updateStore.loadCurrentVersion()
  // 拉当前版本到 data-api 出口 header（X-Client-Version，调试 / 后续采集可用）
  void refreshClientMeta()
  if (auth.isAuthenticated) {
    void loadBusinessData()
  }
})

onUnmounted(() => {
  unbindUpdater?.()
  unbindUpdater = null
})

// 登录态从 false 变 true（用户刚登录）→ 重新加载业务数据
// 登录态从 true 变 false（token 过期被自动登出 / 主动退出）→ 回登录页
watch(
  () => auth.isAuthenticated,
  (now, prev) => {
    if (now && !prev) {
      void loadBusinessData()
    } else if (!now && prev) {
      // ⚠️ 不跳登录页的话，AppLayout 会被 v-else-if 卸掉，只剩一个 boot-splash 黑屏，
      //    用户既看不到错误也点不到"重新登录"。
      void router.replace('/login')
    }
  },
)

// 关键：账号切换（uid 变了）→ 强制重载业务数据
// 不然从 A 账号直接登录 B 账号（不退出）时，children/courses store 还是 A 的
watch(
  () => auth.user?.uid ?? '',
  (now, prev) => {
    if (now && now !== prev) {
      void loadBusinessData()
    }
  },
)
</script>

<template>
  <!--
    按需引入 Element Plus 场景下，全局 i18n 必须由 <el-config-provider> 显式注入
    不然 el-date-picker 弹出面板的月份 / 星期 / 确认按钮等会回退到英文
    文档：https://element-plus.org/zh-CN/guide/i18n.html#configprovider
  -->
  <el-config-provider :locale="zhCn">
    <router-view v-if="isLoginPage" />

    <AppLayout v-else-if="auth.isAuthenticated">
      <!-- 登录后同步业务数据：loading 只占内容区，侧栏立即可见（不再全屏盖白） -->
      <div v-if="initializing" class="content-splash">
        <div class="glass-card content-loading-card">
          <div class="loading-orb">🌱</div>
          <p class="loading-title">正在同步你的数据…</p>
          <p class="loading-sub">宝贝档案 · 课程 · 打卡记录</p>
        </div>
      </div>

      <!-- 加载失败：必须显式告诉用户 + 给重试入口，否则看起来像"数据被清空" -->
      <div v-else-if="initError" class="content-splash">
        <div class="glass-card content-loading-card">
          <div class="loading-orb error-orb">⚠️</div>
          <p class="loading-title">数据加载失败</p>
          <p class="loading-sub error-text">{{ initError }}</p>
          <el-button type="primary" class="retry-btn" @click="retryLoad">重新加载</el-button>
        </div>
      </div>

      <router-view v-else v-slot="{ Component, route }">
        <transition name="route" mode="out-in" appear>
          <component :is="Component" :key="route.fullPath" />
        </transition>
      </router-view>
    </AppLayout>

    <div v-else class="boot-splash" />

    <!-- 版本更新下载弹框（登录页也可见：更新不属于业务数据） -->
    <UpdateDialog />
  </el-config-provider>
</template>

<style scoped>
/* 启动兜底（未登录且非登录页的极短过渡帧）：暗色，不闪白 */
.boot-splash {
  position: fixed;
  inset: 0;
  background: var(--text-on-primary);
}

/* 登录后同步业务数据：只盖内容区（AppLayout 的 main 需 position:relative），侧栏保持可见 */
.content-splash {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.content-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 36px 56px;
  animation: splash-card-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.loading-orb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  font-size: 26px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(63, 184, 122, 0.28) 0%, rgba(63, 184, 122, 0.1) 100%);
  border: 1px solid rgba(63, 184, 122, 0.35);
  box-shadow:
    0 8px 24px -6px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 var(--text-body);
  animation: orb-breathe 1.8s ease-in-out infinite;
}

.loading-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-title);
  letter-spacing: 0.02em;
}

.loading-sub {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
}

/* 加载失败卡片：错误色 orb + 可读的错误文案 + 重试按钮 */
.error-orb {
  background: linear-gradient(135deg, rgba(224, 138, 30, 0.28) 0%, rgba(224, 138, 30, 0.1) 100%);
  border-color: rgba(224, 138, 30, 0.35);
}

.error-text {
  max-width: 420px;
  text-align: center;
  line-height: 1.6;
  color: var(--text-body);
}

.retry-btn {
  margin-top: 4px;
}

@keyframes splash-card-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes orb-breathe {
  0%, 100% {
    transform: scale(1);
    box-shadow:
      0 8px 24px -6px rgba(0, 0, 0, 0.5),
      0 0 0 0 rgba(63, 184, 122, 0.35),
      inset 0 1px 0 var(--text-body);
  }
  50% {
    transform: scale(1.05);
    box-shadow:
      0 8px 24px -6px rgba(0, 0, 0, 0.5),
      0 0 0 14px rgba(63, 184, 122, 0),
      inset 0 1px 0 var(--text-body);
  }
}
</style>
