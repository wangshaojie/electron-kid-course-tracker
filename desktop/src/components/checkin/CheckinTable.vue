<script setup lang="ts">
/**
 * 打卡记录表 —— 上课记录「列表」视图
 */
import { ref, computed } from 'vue'
import { useCheckinsStore } from '@/stores/checkins'
import { useCoursesStore } from '@/stores/courses'
import { confirm } from '@/utils/confirm'
import { todayStr, toDateStr } from '@/utils/date'
import CheckinFormDialog from './CheckinFormDialog.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import type { Checkin } from '@/stores/checkins'

const checkins = useCheckinsStore()
const courses = useCoursesStore()

const dialogOpen = ref(false)
const filterCourse = ref<string | null>(null)
const dateRange = ref<[string, string] | null>(null)

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
