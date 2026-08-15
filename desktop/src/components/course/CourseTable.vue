<script setup lang="ts">
/**
 * 课程列表 —— Element Plus 表格
 */
import { computed, ref } from 'vue'
import { useCoursesStore, type Course } from '@/stores/courses'
import type { CourseSummary } from '@/types'
import { formatMoney, formatHours } from '@/utils/money'
import { confirm } from '@/utils/confirm'
import CourseFormDialog from './CourseFormDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'

const courses = useCoursesStore()

const dialogOpen = ref(false)
const editingCourse = ref<Course | null>(null)

const rows = computed(() => courses.summaries)

function openCreate() {
  editingCourse.value = null
  dialogOpen.value = true
}

function openEdit(c: Course) {
  editingCourse.value = c
  dialogOpen.value = true
}

async function onDelete(c: Course) {
  const ok = await confirm({
    title: '删除课程',
    message: `确定要删除「${c.name}」吗？该课程下的所有打卡记录也会一起删除。`,
    confirmText: '删除',
    type: 'warning',
  })
  if (!ok) return
  // remove 内部已刷新 courses + checkins，这里不再重复请求
  await courses.remove(c.id)
}

function statusLabel(s: CourseSummary) {
  if (s.status === 'expired') return { text: '已过期', cls: 'text-danger' }
  if (s.status === 'done') return { text: '已完结', cls: 'text-ink-ghost' }
  if (s.status === 'low') return { text: `仅剩 ${s.remain_hours} 节`, cls: 'text-sun-500' }
  return { text: '正常', cls: 'text-ink-soft' }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-bold text-ink">课程列表</h2>
        <p class="text-sm text-ink-soft">共 {{ courses.count }} 个课程</p>
      </div>
      <el-button type="primary" @click="openCreate">
        <span class="mr-1">+</span> 新增课程
      </el-button>
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
            <p class="font-medium text-ink">{{ row.name }}</p>
            <p v-if="row.institution" class="text-xs text-ink-ghost">{{ row.institution }}</p>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="费用 / 课时" width="220">
        <template #default="{ row }">
          <div class="text-sm">
            <p>{{ formatMoney(row.total_amount) }} · {{ formatHours(row.total_hours) }}</p>
            <p class="text-xs text-ink-ghost">
              单节 {{ formatMoney(row.price_per_hour) }}
            </p>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="剩余 / 已用" width="160" align="center">
        <template #default="{ row }">
          <div class="text-sm">
            <p :class="statusLabel(row).cls + ' font-semibold'">
              {{ statusLabel(row).text }}
            </p>
            <p class="text-xs text-ink-ghost">
              已用 {{ formatHours(row.used_hours) }} / 剩 {{ formatHours(row.remain_hours) }}
            </p>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="日期" width="180">
        <template #default="{ row }">
          <div class="text-xs text-ink-soft">
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
          <el-button
            size="small"
            link
            type="danger"
            @click="onDelete(courses.byId(row.id)!)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 保存后 courses store 已自行刷新，checkins 不受影响，无需额外请求 -->
    <CourseFormDialog v-model="dialogOpen" :course="editingCourse" />
  </div>
</template>
