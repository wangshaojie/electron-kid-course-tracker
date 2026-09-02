<script setup lang="ts">
/**
 * 设置
 *  - 宝贝档案管理
 *  - 清空指引（云端控制台）
 *  - 软件信息
 *
 * 导出 Excel 已迁移到「上课记录 → 列表」工具栏的「导出」按钮，
 * 按当前筛选（课程 + 时间范围）直接导出，无需再选宝贝/课程。
 */
import { ref } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'
import { useChildrenStore, type Child } from '@/stores/children'
import { dangerousConfirm } from '@/utils/confirm'
import { ElMessage } from 'element-plus'
import ChildCreateDialog from '@/components/child/ChildCreateDialog.vue'
import PasswordStatusCard from '@/components/account/PasswordStatusCard.vue'

const courses = useCoursesStore()
const checkins = useCheckinsStore()
const children = useChildrenStore()

const createOpen = ref(false)
const editingChild = ref<Child | null>(null)

function openCreate() {
  editingChild.value = null
  createOpen.value = true
}

function openEdit(c: Child) {
  editingChild.value = c
  createOpen.value = true
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
  // 强提示：必须输入宝贝名才放行；与课程级 dangerousConfirm 一致的二次保险
  const ok = await dangerousConfirm({
    title: '⚠️ 删除宝贝档案',
    message: `将删除「${c.name}」及其名下的所有课程和打卡记录，此操作不可恢复。`,
    keyword: c.name,
    confirmText: '我已了解风险，删除',
  })
  if (!ok) return
  // remove 内部已级联删 courses + checkins 并切换 active，这里再补一次业务 store 刷新以防脏数据
  await children.remove(c.id)
  await courses.refresh()
  await checkins.refresh()
}

function onWipe() {
  ElMessage.warning('请到 CloudBase 控制台清空数据（左侧导航 → 数据库 → 选表 → 删除行）')
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg p-6">
    <header class="mb-5">
      <h1 class="text-2xl font-bold text-ink">设置</h1>
      <p class="text-sm text-ink-soft">宝贝管理 / 数据备份 / 关于</p>
    </header>

    <div class="space-y-4">
      <!-- 宝贝档案管理 -->
      <div class="card-base">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h3 class="font-bold text-ink">👶 宝贝档案</h3>
            <p class="mt-0.5 text-sm text-ink-soft">
              当前激活：<b class="text-moss-600">{{ children.active?.name }}</b>
              ，共 {{ children.count }} 个
            </p>
          </div>
          <el-button type="primary" @click="openCreate">
            <span class="mr-1">+</span> 新增宝贝
          </el-button>
        </div>

        <div v-if="children.count === 0" class="py-6 text-center text-sm text-ink-soft">
          <p>当前账号下没有宝贝数据</p>
          <p class="mt-1 text-xs">你之前的录入可能用了别的邮箱，或数据还没拉过来</p>
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="c in children.items"
            :key="c.id"
            :class="[
              'flex items-center gap-3 rounded-xl border p-3 transition-colors',
              c.id === children.activeId
                ? 'border-moss-200 bg-moss-50/50'
                : 'border-brand-50 hover:bg-moss-50/30',
            ]"
          >
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-2xl"
              :style="{ background: c.color + '22', border: `2px solid ${c.color}` }"
            >
              {{ c.emoji }}
            </div>
            <div class="flex-1">
              <p class="font-bold text-ink">{{ c.name }}</p>
              <p class="text-xs text-ink-soft">
                <span v-if="c.id === children.activeId" class="text-moss-600">当前激活</span>
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
        <p class="mt-3 text-xs text-ink-ghost">
          删除宝贝会同时删除其所有课程和打卡记录（ON DELETE CASCADE）
        </p>
      </div>

      <!-- 账号安全（密码状态 + 修改/忘记密码入口） -->
      <PasswordStatusCard />

      <!-- 数据存储说明 -->
      <div class="card-base">
        <h3 class="mb-1 font-bold text-ink">☁️ 数据存储</h3>
        <p class="mb-1 text-sm text-ink-soft">
          所有数据实时保存在云端 CloudBase PostgreSQL，多设备登录看到同一份数据，本地不维护副本。
        </p>
        <p class="text-xs text-ink-ghost">
          导出 Excel 请到「上课记录 → 列表」工具栏的「📊 导出 Excel」按钮，按当前筛选直接导出。
          完整数据可到 CloudBase 控制台 → 数据库 手动导出。
        </p>
      </div>

      <!-- 清空指引 -->
      <div class="card-base border border-danger/30">
        <h3 class="mb-1 font-bold text-danger">🚨 清空所有数据</h3>
        <p class="mb-3 text-sm text-ink-soft">
          数据存储在云端，本应用不提供一键清空（防止误删）。如需删除全部数据，请到 CloudBase 控制台操作。
        </p>
        <el-button type="danger" plain @click="onWipe">
          查看清空指引
        </el-button>
      </div>

      <!-- 软件信息 -->
      <div class="card-base">
        <h3 class="mb-1 font-bold text-ink">ℹ️ 关于</h3>
        <dl class="grid grid-cols-2 gap-2 text-sm">
          <dt class="text-ink-soft">软件名称</dt><dd>一寸光阴</dd>
          <dt class="text-ink-soft">版本</dt><dd>v0.4.0 · 密码为主</dd>
          <dt class="text-ink-soft">技术栈</dt><dd>Electron + Vue 3 + CloudBase PG + Element Plus + ECharts</dd>
          <dt class="text-ink-soft">数据位置</dt>
          <dd>云端 CloudBase PostgreSQL（多设备同步）</dd>
          <dt class="text-ink-soft">说明</dt>
          <dd>需联网，支持 OTP 邮箱验证码登录、多设备登录看到同一份数据</dd>
        </dl>
      </div>
    </div>

    <ChildCreateDialog
      v-model="createOpen"
      :child="editingChild"
      @saved="courses.refresh(); checkins.refresh()"
    />
  </div>
</template>

<style scoped>
/* no styles */
</style>
