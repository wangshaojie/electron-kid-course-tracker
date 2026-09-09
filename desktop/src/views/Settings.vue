<script setup lang="ts">
/**
 * 设置(主题感知版)
 *  - 宝贝档案管理
 *  - 外观(主题切换)
 *  - 账号安全
 *  - 数据存储说明
 *  - 清空指引(云端控制台)
 *  - 软件信息
 *  v7: 颜色全走 CSS 变量(深/浅主题通用),主题切换在外观卡片里
 */
import { ref, computed } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'
import { useChildrenStore, type Child } from '@/stores/children'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useUpdateStore } from '@/stores/update'
import { dangerousConfirm } from '@/utils/confirm'
import { ElMessage } from 'element-plus'
import ChildCreateDialog from '@/components/child/ChildCreateDialog.vue'
import PasswordStatusCard from '@/components/account/PasswordStatusCard.vue'

const courses = useCoursesStore()
const checkins = useCheckinsStore()
const children = useChildrenStore()
const theme = useThemeStore()
const updateStore = useUpdateStore()

/** 主题选项 —— 顺序:浅色 / 深色 / 跟随系统(从用户主动选择到被动跟随) */
const themeOptions: Array<{
  value: ThemeMode
  label: string
  icon: string
  desc: string
}> = [
  { value: 'light',  label: '浅色',     icon: '☀️', desc: '明亮白底' },
  { value: 'dark',   label: '深色',     icon: '🌙', desc: '暗色玻璃' },
  { value: 'system', label: '跟随系统', icon: '🖥', desc: '跟操作系统设置' },
]

/** 当前主题对应的"实际生效"描述(给 system 模式一个直观说明) */
const themeHint = computed(() => {
  if (theme.mode === 'system') {
    return `当前系统: ${theme.resolved === 'dark' ? '深色' : '浅色'}`
  }
  return ''
})

async function pickTheme(m: ThemeMode) {
  if (theme.mode === m) return
  await theme.setMode(m)
  ElMessage.success(`已切换到${themeOptions.find((o) => o.value === m)?.label ?? m}`)
}

const createOpen = ref(false)
const editingChild = ref<Child | null>(null)
const dialogKey = ref(0)

function openCreate() {
  editingChild.value = null
  createOpen.value = true
  dialogKey.value++
}

function openEdit(c: Child) {
  editingChild.value = c
  createOpen.value = true
  dialogKey.value++
}

function onDialogClosed() {
  editingChild.value = null
}

async function onSetActive(c: Child) {
  if (c.id === children.activeId) return
  await children.setActive(c.id)
  await courses.refresh()
  await checkins.refresh()
  ElMessage.success(`已切换到「${c.name}」`)
}

async function onDelete(c: Child) {
  if (children.count <= 1) {
    ElMessage.warning('至少需要保留一个宝贝档案')
    return
  }
  const ok = await dangerousConfirm({
    title: '⚠️ 删除宝贝档案',
    message: `将删除「${c.name}」及其名下的所有课程和打卡记录，此操作不可恢复。`,
    keyword: c.name,
    confirmText: '我已了解风险，删除',
  })
  if (!ok) return
  await children.remove(c.id)
  await courses.refresh()
  await checkins.refresh()
}

function onWipe() {
  ElMessage.warning('请到 Supabase 控制台清空数据（Table Editor → 选表 → 删除行）')
}

/**
 * 用户点"检测更新"按钮。
 * 注意：发现新版本时主进程会主动 emit `update:available`，App.vue 已经会弹"立即更新"弹窗，
 * 这里只做结果反馈（"已是最新" / "网络失败"）；不重复弹发现新版本。
 */
async function onCheckUpdate() {
  if (updateStore.checking) return
  if (!window.updater?.manualCheck) {
    ElMessage.warning('当前环境不支持检测更新')
    return
  }
  const r = await updateStore.checkNow()
  if (r === 'up-to-date') {
    ElMessage.success(`已是最新版本 v${updateStore.currentVersion}`)
  } else if (r === 'failed') {
    ElMessage.error('检测更新失败，请检查网络后重试')
  }
  // 'has-update' 由 App.vue 监听 update:available 自动弹"立即更新"弹窗，这里不重复
}
</script>

<template>
  <div class="h-full overflow-y-auto dark-page p-6">
    <header class="mb-5">
      <h1 class="text-2xl font-bold text-dark-title">设置</h1>
      <p class="text-sm text-dark-soft">宝贝管理 / 数据备份 / 关于</p>
    </header>

    <div class="space-y-4">
      <!-- 宝贝档案管理 -->
      <div class="glass-card p-5">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h3 class="font-bold text-dark-title">👶 宝贝档案</h3>
            <p class="mt-0.5 text-sm text-dark-body">
              当前激活：<b class="settings-active-name">{{ children.active?.name }}</b>
              ，共 {{ children.count }} 个
            </p>
          </div>
          <button class="btn-dark-primary" @click="openCreate">
            <span class="mr-1">+</span> 新增宝贝
          </button>
        </div>

        <div
          v-if="children.count === 0"
          class="py-6 text-center text-sm text-dark-body"
        >
          <p>当前账号下没有宝贝数据</p>
          <p class="mt-1 text-xs text-dark-ghost">
            你之前的录入可能用了别的邮箱，或数据还没拉过来
          </p>
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="c in children.items"
            :key="c.id"
            :class="[
              'settings-child-item',
              c.id === children.activeId ? 'settings-child-active' : 'settings-child-idle',
            ]"
          >
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-2xl"
              :style="{ background: c.color + '22', border: `2px solid ${c.color}` }"
            >
              {{ c.emoji }}
            </div>
            <div class="flex-1">
              <p class="font-bold text-dark-title">{{ c.name }}</p>
              <p class="text-xs text-dark-body">
                <span v-if="c.id === children.activeId" class="settings-active-label">当前激活</span>
                <span v-else>未激活</span>
              </p>
            </div>
            <div class="flex gap-1">
              <el-button
                v-if="c.id !== children.activeId"
                size="small"
                plain
                @click="onSetActive(c)"
              >
                切到此档案
              </el-button>
              <el-button size="small" link @click="openEdit(c)">编辑</el-button>
              <el-button size="small" link type="danger" @click="onDelete(c)">删除</el-button>
            </div>
          </li>
        </ul>
        <p class="mt-3 text-xs text-dark-ghost">
          删除宝贝会同时删除其所有课程和打卡记录（ON DELETE CASCADE）
        </p>
      </div>

      <!-- 账号安全 -->
      <PasswordStatusCard />

      <!-- 外观(主题) -->
      <div class="glass-card p-5">
        <div class="mb-3">
          <h3 class="font-bold text-dark-title">🎨 外观</h3>
          <p class="mt-0.5 text-sm text-dark-body">
            选择界面主题
            <span v-if="themeHint" class="theme-hint">· {{ themeHint }}</span>
          </p>
        </div>
        <div class="theme-grid">
          <button
            v-for="opt in themeOptions"
            :key="opt.value"
            type="button"
            class="theme-card"
            :class="theme.mode === opt.value ? 'theme-card-active' : ''"
            @click="pickTheme(opt.value)"
          >
            <span class="theme-card-icon">{{ opt.icon }}</span>
            <span class="theme-card-label">{{ opt.label }}</span>
            <span class="theme-card-desc">{{ opt.desc }}</span>
            <span v-if="theme.mode === opt.value" class="theme-card-check">✓</span>
          </button>
        </div>
      </div>

      <!-- 数据存储说明 -->
      <div class="glass-card p-5">
        <h3 class="mb-1 font-bold text-dark-title">☁️ 数据存储</h3>
        <p class="mb-1 text-sm text-dark-body">
          所有数据实时保存在云端 Supabase PostgreSQL，多设备登录看到同一份数据，本地不维护副本。
        </p>
        <p class="text-xs text-dark-soft">
          导出 Excel 请到「上课记录 → 列表」工具栏的「📊 导出 Excel」按钮，按当前筛选直接导出。
          完整数据可到 Supabase 控制台 → Table Editor 手动导出。
        </p>
      </div>

      <!-- 清空指引 -->
      <div class="glass-card settings-warn-card p-5">
        <h3 class="mb-1 font-bold settings-warn-title">🚨 清空所有数据</h3>
        <p class="mb-3 text-sm text-dark-body">
          数据存储在云端，本应用不提供一键清空（防止误删）。如需删除全部数据，请到 Supabase 控制台操作。
        </p>
        <el-button type="danger" plain @click="onWipe">
          查看清空指引
        </el-button>
      </div>

      <!-- 软件信息 -->
      <div class="glass-card p-5">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-bold text-dark-title">ℹ️ 关于</h3>
          <button
            type="button"
            class="btn-press settings-check-btn"
            :disabled="updateStore.checking"
            @click="onCheckUpdate"
          >
            <span v-if="updateStore.checking" class="settings-check-spinner" />
            <span>{{ updateStore.checking ? '检测中…' : '检测更新' }}</span>
          </button>
        </div>

        <!-- 有新版本提示条 -->
        <div
          v-if="updateStore.hasUpdate && updateStore.latestVersion"
          class="settings-update-banner"
        >
          🎉 发现新版本 <b>v{{ updateStore.latestVersion }}</b>，点击右上角「检测更新」旁的系统弹窗立即升级
        </div>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm text-dark-body">
          <dt class="text-dark-soft">软件名称</dt><dd>一寸光阴</dd>
          <dt class="text-dark-soft">当前版本</dt>
          <dd>
            <span class="settings-mono">v{{ updateStore.currentVersion || '…' }}</span>
            <span
              v-if="updateStore.hasUpdate && updateStore.latestVersion"
              class="settings-new-ver"
            >→ v{{ updateStore.latestVersion }} 可更新</span>
          </dd>
          <dt class="text-dark-soft">技术栈</dt>
          <dd>Electron 33 + Vue 3.5 + TypeScript + Vite + Pinia + Vue Router + Element Plus + Tailwind CSS + ECharts + ExcelJS</dd>
          <dt class="text-dark-soft">后端</dt>
          <dd>Vercel HTTP Function（auth-otp / data-api）→ Supabase PostgreSQL（多设备同步）</dd>
          <dt class="text-dark-soft">鉴权方式</dt>
          <dd>邮箱 + 密码（首次注册设密；忘记密码可重置）</dd>
          <dt class="text-dark-soft">同步能力</dt>
          <dd>多设备登录看到同一份数据；激活孩子/主题偏好跨设备保持一致</dd>
        </dl>
      </div>
    </div>

    <ChildCreateDialog
      :key="dialogKey"
      v-if="createOpen"
      v-model="createOpen"
      :child="editingChild"
      @saved="courses.refresh(); checkins.refresh()"
      @closed="onDialogClosed"
    />
  </div>
</template>

<style scoped>
/* 宝贝档案子项 —— 用 class 替代内联 style */
.settings-child-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 12px;
  padding: 12px;
  border: 1px solid var(--divider);
  background: var(--card-bg);
  transition: all 0.15s ease;
}
.settings-child-item:hover {
  border-color: var(--card-border-hover);
}
.settings-child-active {
  border-color: var(--brand-soft-border);
  background: var(--brand-soft-bg);
}
.settings-child-idle {
  background: var(--btn-ghost-bg);
}
.settings-active-label {
  color: var(--brand-text);
  font-weight: 600;
}
.settings-active-name {
  color: var(--brand-text);
}

/* 清空数据卡(警告) */
.settings-warn-card {
  border-color: var(--danger-soft-border);
}
.settings-warn-title {
  color: var(--danger-text);
}

/* ---- 主题卡片 ---- */
.theme-hint {
  color: var(--text-soft);
  font-size: 12px;
  margin-left: 4px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 12px;
  border-radius: 12px;
  background: var(--btn-ghost-bg);
  border: 1px solid var(--input-border);
  color: var(--text-body);
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}
.theme-card:hover {
  background: var(--btn-ghost-bg-hover);
  border-color: var(--input-border-hover);
  color: var(--text-title);
  transform: translateY(-1px);
}
.theme-card-active {
  background: var(--brand-soft-bg);
  border-color: var(--brand-soft-border);
  color: var(--brand-text);
}
.theme-card-active:hover {
  background: var(--brand-soft-bg-2);
  border-color: var(--brand-1);
  color: var(--brand-text);
}
.theme-card-icon {
  font-size: 24px;
  line-height: 1;
  margin-bottom: 4px;
}
.theme-card-label {
  font-size: 14px;
  font-weight: 600;
  color: inherit;
}
.theme-card-desc {
  font-size: 11px;
  color: var(--text-soft);
}
.theme-card-active .theme-card-desc {
  color: var(--brand-text);
  opacity: 0.7;
}
.theme-card-check {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--brand-1);
}

/* ---- 检测更新按钮 ---- */
.settings-check-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  background: var(--btn-ghost-bg);
  border: 1px solid var(--input-border);
  color: var(--text-body);
  cursor: pointer;
  transition: all 0.15s ease;
}
.settings-check-btn:hover:not(:disabled) {
  background: var(--btn-ghost-bg-hover);
  border-color: var(--input-border-hover);
  color: var(--text-title);
}
.settings-check-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.settings-check-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--brand-1);
  border-top-color: transparent;
  border-radius: 50%;
  animation: settings-spin 0.8s linear infinite;
}
@keyframes settings-spin {
  to { transform: rotate(360deg); }
}

/* ---- 关于卡 · 新版本横幅 ---- */
.settings-update-banner {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--brand-soft-bg);
  border: 1px solid var(--brand-soft-border);
  color: var(--brand-text);
}

/* ---- 关于卡 · 版本号 / 新版本标识 ---- */
.settings-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  color: var(--text-title);
}
.settings-new-ver {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--brand-soft-bg);
  color: var(--brand-text);
}
</style>
