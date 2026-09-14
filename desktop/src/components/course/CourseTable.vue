<script setup lang="ts">
/**
 * 课程列表 —— Element Plus 表格（暗色玻璃版）
 */
import { computed, ref } from 'vue'
import { useCoursesStore, type Course } from '@/stores/courses'
import type { CourseSummary } from '@/types'
import { formatMoney, formatHours } from '@/utils/money'
import { dangerousConfirm } from '@/utils/confirm'
import CourseFormDialog from './CourseFormDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const courses = useCoursesStore()

const dialogOpen = ref(false)
const editingCourse = ref<Course | null>(null)
const dialogKey = ref(0)

/** 查询条件 —— 客户端过滤,不调后端 */
type StatusFilter = '' | 'ok' | 'low' | 'done' | 'expired'
const keyword = ref('')
const statusFilter = ref<StatusFilter>('')
const dateRange = ref<[string, string] | null>(null)

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const sf = statusFilter.value
  const dr = dateRange.value
  return courses.summaries.filter((s) => {
    if (kw && !s.name.toLowerCase().includes(kw) && !s.institution.toLowerCase().includes(kw)) return false
    if (sf && s.status !== sf) return false
    if (dr) {
      const [from, to] = dr
      if (s.paid_at < from || s.paid_at > to) return false
    }
    return true
  })
})

function resetFilter() {
  keyword.value = ''
  statusFilter.value = ''
  dateRange.value = null
}

function openCreate() {
  editingCourse.value = null
  dialogKey.value++
  dialogOpen.value = true
}

function openEdit(c: Course) {
  editingCourse.value = c
  dialogKey.value++
  dialogOpen.value = true
}

async function onDelete(c: Course) {
  let checkinCount = 0
  try {
    checkinCount = await courses.checkinCountByCourse(c.id)
  } catch (e) {
    console.error('[CourseTable] 查询打卡条数失败', e)
  }
  const detail =
    checkinCount > 0
      ? `「${c.name}」下还有 ${checkinCount} 条打卡记录，删除课程时这些记录会被一并删除，此操作不可恢复。`
      : `「${c.name}」下暂无打卡记录，但删除后无法恢复。`
  const ok = await dangerousConfirm({
    title: '⚠️ 删除课程',
    message: detail,
    keyword: c.name,
    confirmText: '我已了解风险，删除',
  })
  if (!ok) return
  await courses.remove(c.id)
}

function statusLabel(s: CourseSummary) {
  // 颜色用 CSS 变量,主题感知:浅色/深色都看得清
  // 不要再写死 rgba(255,255,255,*) —— 深色下勉强能看,浅色下完全瞎
  if (s.status === 'expired') return { text: '已过期', cls: 'var(--danger-text)' }
  if (s.status === 'done') return { text: '已完结', cls: 'var(--text-ghost)' }
  if (s.status === 'low') return { text: `仅剩 ${s.remain_hours} 节`, cls: 'var(--el-color-warning)' }
  return { text: '正常', cls: 'var(--text-body)' }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-bold text-dark-title">课程列表</h2>
        <p class="text-sm" style="color: var(--text-soft);">
          共 {{ courses.count }} 个课程
          <span v-if="rows.length !== courses.count" style="color: var(--brand-text);">
            · 已筛选 {{ rows.length }} 个
          </span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <!-- 课程名 / 机构模糊搜 -->
        <el-input
          v-model="keyword"
          placeholder="搜索课程名 / 机构"
          clearable
          size="default"
          class="!w-56"
        >
          <template #prefix>
            <span style="color: var(--text-soft);">🔍</span>
          </template>
        </el-input>
        <!-- 状态筛选 -->
        <el-select
          v-model="statusFilter"
          placeholder="状态"
          clearable
          size="default"
          class="!w-32"
        >
          <el-option label="全部状态" value="" />
          <el-option label="正常" value="ok" />
          <el-option label="仅剩几节" value="low" />
          <el-option label="已完结" value="done" />
          <el-option label="已过期" value="expired" />
        </el-select>
        <!-- 缴费日期范围 -->
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="缴费起"
          end-placeholder="缴费止"
          size="default"
          class="!w-72"
        />
        <!-- 重置 -->
        <button
          v-if="keyword || statusFilter || dateRange"
          class="btn-dark-ghost"
          style="padding: 6px 14px; font-size: 12px;"
          @click="resetFilter"
        >
          清空筛选
        </button>
        <button class="btn-dark-primary" @click="openCreate">
          <span class="mr-1">+</span> 新增课程
        </button>
      </div>
    </div>

    <EmptyState
      v-if="rows.length === 0 && courses.count === 0"
      icon="📚"
      title="还没有课程"
      desc="点击右上角「新增课程」开始记录"
    />
    <EmptyState
      v-else-if="rows.length === 0"
      icon="🔍"
      title="没有匹配的课程"
      desc="试试调整关键字 / 状态 / 时间范围,或点击「清空筛选」"
    />

    <el-table
      v-else
      :data="rows"
      stripe
      :default-sort="{ prop: 'paid_at', order: 'descending' }"
      class="!rounded-xl"
    >
      <el-table-column prop="name" label="课程名称" min-width="160">
        <template #default="{ row }">
          <div>
            <p class="font-medium text-dark-title">{{ row.name }}</p>
            <p v-if="row.institution" class="text-xs" style="color: var(--text-soft);">
              {{ row.institution }}
            </p>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="费用 / 课时" width="220">
        <template #default="{ row }">
          <div class="text-sm">
            <p style="color: var(--text-body);">
              {{ formatMoney(row.total_amount) }} · {{ formatHours(row.total_hours) }}
            </p>
            <p class="text-xs" style="color: var(--text-soft);">
              单节 {{ formatMoney(row.price_per_hour) }}
            </p>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="剩余 / 已用" width="160" align="center">
        <template #default="{ row }">
          <div class="text-sm">
            <p class="font-semibold" :style="{ color: statusLabel(row).cls }">
              {{ statusLabel(row).text }}
            </p>
            <p class="text-xs" style="color: var(--text-soft);">
              已用 {{ formatHours(row.used_hours) }} / 剩 {{ formatHours(row.remain_hours) }}
            </p>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="日期" width="180">
        <template #default="{ row }">
          <div class="text-xs" style="color: var(--text-body);">
            <p>缴费 {{ row.paid_at }}</p>
            <p v-if="row.expires_at">到期 {{ row.expires_at }}</p>
            <p v-else>无到期日</p>
          </div>
        </template>
      </el-table-column>

      <el-table-column v-if="rows[0]?.tags?.length" label="标签" min-width="140">
        <template #default="{ row }">
          <el-tag
            v-for="t in row.tags"
            :key="t"
            size="small"
            class="!mr-1 !mb-1"
            effect="plain"
          >
            {{ t }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click="openEdit(courses.byId(row.id)!)">
            编辑
          </el-button>
          <el-button size="small" link type="danger" @click="onDelete(courses.byId(row.id)!)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <CourseFormDialog
      :key="dialogKey"
      v-if="dialogOpen"
      v-model="dialogOpen"
      :course="editingCourse"
    />
  </div>
</template>
