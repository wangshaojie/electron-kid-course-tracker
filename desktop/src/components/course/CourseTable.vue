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

const rows = computed(() => courses.summaries)

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
  if (s.status === 'expired') return { text: '已过期', cls: '#FF7A7A' }
  if (s.status === 'done') return { text: '已完结', cls: 'rgba(255,255,255,0.4)' }
  if (s.status === 'low') return { text: `仅剩 ${s.remain_hours} 节`, cls: '#FFB347' }
  return { text: '正常', cls: 'rgba(255,255,255,0.6)' }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-bold" style="color: #fff;">课程列表</h2>
        <p class="text-sm" style="color: rgba(255,255,255,0.5);">共 {{ courses.count }} 个课程</p>
      </div>
      <button class="btn-dark-primary" @click="openCreate">
        <span class="mr-1">+</span> 新增课程
      </button>
    </div>

    <EmptyState
      v-if="rows.length === 0"
      icon="📚"
      title="还没有课程"
      desc="点击右上角「新增课程」开始记录"
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
            <p class="font-medium" style="color: #fff;">{{ row.name }}</p>
            <p v-if="row.institution" class="text-xs" style="color: rgba(255,255,255,0.4);">
              {{ row.institution }}
            </p>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="费用 / 课时" width="220">
        <template #default="{ row }">
          <div class="text-sm">
            <p style="color: rgba(255,255,255,0.85);">
              {{ formatMoney(row.total_amount) }} · {{ formatHours(row.total_hours) }}
            </p>
            <p class="text-xs" style="color: rgba(255,255,255,0.4);">
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
            <p class="text-xs" style="color: rgba(255,255,255,0.4);">
              已用 {{ formatHours(row.used_hours) }} / 剩 {{ formatHours(row.remain_hours) }}
            </p>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="日期" width="180">
        <template #default="{ row }">
          <div class="text-xs" style="color: rgba(255,255,255,0.6);">
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
