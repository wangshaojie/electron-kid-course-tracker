<script setup lang="ts">
/**
 * 设置（暗色玻璃版）
 *  - 宝贝档案管理
 *  - 清空指引（云端控制台）
 *  - 软件信息
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
  ElMessage.warning('请到 CloudBase 控制台清空数据（左侧导航 → 数据库 → 选表 → 删除行）')
}
</script>

<template>
  <div class="h-full overflow-y-auto dark-page p-6">
    <header class="mb-5">
      <h1 class="text-2xl font-bold" style="color: #fff;">设置</h1>
      <p class="text-sm" style="color: rgba(255,255,255,0.5);">宝贝管理 / 数据备份 / 关于</p>
    </header>

    <div class="space-y-4">
      <!-- 宝贝档案管理 -->
      <div class="glass-card p-5">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h3 class="font-bold" style="color: #fff;">👶 宝贝档案</h3>
            <p class="mt-0.5 text-sm" style="color: rgba(255,255,255,0.55);">
              当前激活：<b style="color: #5FCE89;">{{ children.active?.name }}</b>
              ，共 {{ children.count }} 个
            </p>
          </div>
          <button class="btn-dark-primary" @click="openCreate">
            <span class="mr-1">+</span> 新增宝贝
          </button>
        </div>

        <div
          v-if="children.count === 0"
          class="py-6 text-center text-sm"
          style="color: rgba(255,255,255,0.5);"
        >
          <p>当前账号下没有宝贝数据</p>
          <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.3);">
            你之前的录入可能用了别的邮箱，或数据还没拉过来
          </p>
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="c in children.items"
            :key="c.id"
            :style="{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              borderRadius: '12px',
              padding: '12px',
              border: c.id === children.activeId
                ? '1px solid rgba(63,184,122,0.35)'
                : '1px solid rgba(255,255,255,0.06)',
              background: c.id === children.activeId
                ? 'rgba(63,184,122,0.06)'
                : 'rgba(255,255,255,0.02)',
              transition: 'all 0.15s ease',
            }"
          >
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-2xl"
              :style="{ background: c.color + '22', border: `2px solid ${c.color}` }"
            >
              {{ c.emoji }}
            </div>
            <div class="flex-1">
              <p class="font-bold" style="color: #fff;">{{ c.name }}</p>
              <p class="text-xs" style="color: rgba(255,255,255,0.5);">
                <span v-if="c.id === children.activeId" style="color: #5FCE89;">当前激活</span>
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
        <p class="mt-3 text-xs" style="color: rgba(255,255,255,0.3);">
          删除宝贝会同时删除其所有课程和打卡记录（ON DELETE CASCADE）
        </p>
      </div>

      <!-- 账号安全 -->
      <PasswordStatusCard />

      <!-- 数据存储说明 -->
      <div class="glass-card p-5">
        <h3 class="mb-1 font-bold" style="color: #fff;">☁️ 数据存储</h3>
        <p class="mb-1 text-sm" style="color: rgba(255,255,255,0.6);">
          所有数据实时保存在云端 CloudBase PostgreSQL，多设备登录看到同一份数据，本地不维护副本。
        </p>
        <p class="text-xs" style="color: rgba(255,255,255,0.4);">
          导出 Excel 请到「上课记录 → 列表」工具栏的「📊 导出 Excel」按钮，按当前筛选直接导出。
          完整数据可到 CloudBase 控制台 → 数据库 手动导出。
        </p>
      </div>

      <!-- 清空指引 -->
      <div class="glass-card p-5" style="border-color: rgba(217,69,69,0.25);">
        <h3 class="mb-1 font-bold" style="color: #FF7A7A;">🚨 清空所有数据</h3>
        <p class="mb-3 text-sm" style="color: rgba(255,255,255,0.6);">
          数据存储在云端，本应用不提供一键清空（防止误删）。如需删除全部数据，请到 CloudBase 控制台操作。
        </p>
        <el-button type="danger" plain @click="onWipe">
          查看清空指引
        </el-button>
      </div>

      <!-- 软件信息 -->
      <div class="glass-card p-5">
        <h3 class="mb-1 font-bold" style="color: #fff;">ℹ️ 关于</h3>
        <dl class="grid grid-cols-2 gap-2 text-sm" style="color: rgba(255,255,255,0.75);">
          <dt style="color: rgba(255,255,255,0.5);">软件名称</dt><dd>一寸光阴</dd>
          <dt style="color: rgba(255,255,255,0.5);">版本</dt><dd>v0.4.0 · 暗色玻璃</dd>
          <dt style="color: rgba(255,255,255,0.5);">技术栈</dt><dd>Electron + Vue 3 + CloudBase PG + Element Plus + ECharts</dd>
          <dt style="color: rgba(255,255,255,0.5);">数据位置</dt>
          <dd>云端 CloudBase PostgreSQL（多设备同步）</dd>
          <dt style="color: rgba(255,255,255,0.5);">说明</dt>
          <dd>需联网，支持 OTP 邮箱验证码登录、多设备登录看到同一份数据</dd>
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
