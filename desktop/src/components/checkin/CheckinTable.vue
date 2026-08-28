<script setup lang="ts">
/**
 * 打卡记录表 —— 上课记录「列表」视图
 * 工具栏右侧带「导出 Excel」按钮，按当前筛选（课程 + 日期范围）直接导出
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useCheckinsStore } from '@/stores/checkins'
import { useCoursesStore, type Course } from '@/stores/courses'
import { useChildrenStore } from '@/stores/children'
import { confirm } from '@/utils/confirm'
import { todayStr, toDateStr } from '@/utils/date'
import { exportToExcel, type CourseRow } from '@/utils/excel'
import CheckinFormDialog from './CheckinFormDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import type { Checkin } from '@/stores/checkins'

const checkins = useCheckinsStore()
const courses = useCoursesStore()
const children = useChildrenStore()

const dialogOpen = ref(false)
const filterCourse = ref<string | null>(null)
const dateRange = ref<[string, string] | null>(null)
const exporting = ref(false)

const rows = computed(() => {
  let arr = checkins.items
  if (filterCourse.value) {
    arr = arr.filter((c) => c.course_id === filterCourse.value)
  }
  if (dateRange.value && dateRange.value.length === 2) {
    const [from, to] = dateRange.value
    arr = arr.filter((c) => c.date >= from && c.date <= to)
  }
  return [...arr].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
})

const courseName = (id: string) => courses.byId(id)?.name ?? '(已删除)'

/** Course → CourseRow：去掉客户端聚合字段（exportToExcel 内部自己再聚合） */
function toCourseRow(c: Course): CourseRow {
  return {
    id: c.id,
    owner_id: c.owner_id,
    child_id: c.child_id,
    name: c.name,
    institution: c.institution,
    total_amount: c.total_amount,
    total_hours: c.total_hours,
    paid_at: c.paid_at,
    expires_at: c.expires_at,
    tags: c.tags,
    note: c.note,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }
}

async function onDelete(c: Checkin) {
  const ok = await confirm({
    title: '删除打卡',
    message: `删除这次打卡（${c.date}，${c.hours} 节）后，剩余课时会自动回滚。`,
    confirmText: '删除',
    type: 'warning',
  })
  if (!ok) return
  // remove 内部已刷新 courses 聚合，这里不再重复请求
  await checkins.remove(c.id)
}

function applyQuickRange(preset: 'week' | 'month' | 'all') {
  if (preset === 'all') {
    dateRange.value = null
    return
  }
  const now = new Date()
  const from = new Date(now)
  if (preset === 'week') from.setDate(from.getDate() - 7)
  if (preset === 'month') from.setMonth(from.getMonth() - 1)
  dateRange.value = [toDateStr(from), todayStr()]
}

/** 拼接筛选条件描述（写入汇总 sheet + 弹窗提示） */
function buildFilterLabel(): string {
  const parts: string[] = []
  if (filterCourse.value) {
    parts.push(`课程「${courseName(filterCourse.value)}」`)
  }
  const [from, to] = dateRange.value ?? []
  if (from && to) parts.push(`${from} ~ ${to}`)
  else if (from) parts.push(`${from} 起`)
  else if (to) parts.push(`截至 ${to}`)
  return parts.length > 0 ? parts.join(' · ') : '全部记录'
}

async function onExport() {
  if (exporting.value) return
  if (rows.value.length === 0) {
    ElMessage.warning('当前筛选下没有记录可导出')
    return
  }
  exporting.value = true
  try {
    // 选中的课程：单选就用那一门；未选 = 当前宝贝下所有课程
    const pickedCourse = filterCourse.value
      ? courses.byId(filterCourse.value)
      : null
    const pickedCourses: CourseRow[] = pickedCourse
      ? [pickedCourse]
      : courses.items.map(toCourseRow)

    const totalAmount = pickedCourses.reduce((s, c) => s + c.total_amount, 0)
    const totalHours = pickedCourses.reduce((s, c) => s + c.total_hours, 0)
    const usedHours = rows.value.reduce((s, c) => s + Number(c.hours), 0)
    const childLabel = `「${children.active?.name ?? '宝贝'}」`
    const filterLabel = buildFilterLabel()

    const blob = await exportToExcel(pickedCourses, rows.value, {
      childLabel,
      rangeLabel: filterLabel,
    })
    const file = `kid-course-tracker_${children.active?.name ?? '宝贝'}_${todayStr()}.xlsx`
    const path = await window.kidfs.saveDialog({
      defaultName: file,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })
    if (!path) return
    const buf = new Uint8Array(await blob.arrayBuffer())
    await window.kidfs.writeFile(path, buf)
    ElMessage.success(
      `已导出 ${childLabel} · ${pickedCourses.length} 门科目 · ${rows.value.length} 条打卡` +
        ` · 总投入 ${totalAmount} · 总课时 ${totalHours} · 已上 ${usedHours}`,
    )
  } catch (e) {
    ElMessage.error('导出失败：' + (e as Error).message)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <span class="text-sm text-ink-soft">共 {{ rows.length }} 条记录</span>
      <div class="flex-1" />
      <el-select
        v-model="filterCourse"
        placeholder="全部课程"
        clearable
        class="!w-44"
      >
        <el-option
          v-for="c in courses.summaries"
          :key="c.id"
          :label="c.name"
          :value="c.id"
        />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始"
        end-placeholder="结束"
        class="!w-72"
      />
      <el-button-group>
        <el-button size="small" @click="applyQuickRange('week')">近 7 天</el-button>
        <el-button size="small" @click="applyQuickRange('month')">近 30 天</el-button>
        <el-button size="small" @click="applyQuickRange('all')">全部</el-button>
      </el-button-group>
      <el-button
        type="success"
        :loading="exporting"
        :disabled="rows.length === 0"
        @click="onExport"
      >
        <span class="mr-1">📊</span> 导出 Excel
      </el-button>
      <el-button type="primary" @click="dialogOpen = true">
        <span class="mr-1">+</span> 打卡
      </el-button>
    </div>

    <EmptyState
      v-if="rows.length === 0"
      icon="✅"
      title="还没有打卡记录"
      desc="点击右上角「打卡」记录第一节课"
    />

    <el-table v-else :data="rows" stripe class="!rounded-xl">
      <el-table-column prop="date" label="日期" width="120" sortable />
      <el-table-column label="课程" min-width="160">
        <template #default="{ row }">
          <span class="font-medium text-ink">{{ courseName(row.course_id) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="hours" label="节数" width="80" align="center">
        <template #default="{ row }">
          <el-tag type="warning" effect="plain" round>{{ row.hours }} 节</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="feedback" label="课堂反馈" min-width="200">
        <template #default="{ row }">
          <span v-if="row.feedback" class="text-sm text-ink-soft">{{ row.feedback }}</span>
          <span v-else class="text-xs text-ink-ghost">（无）</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link type="danger" @click="onDelete(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <CheckinFormDialog v-model="dialogOpen" />
  </div>
</template>
