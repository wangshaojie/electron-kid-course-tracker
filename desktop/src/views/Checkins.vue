<script setup lang="ts">
/**
 * 上课记录 —— 日历 / 列表 双视图（暗色玻璃版）
 */
import { computed, ref } from 'vue'
import { useCheckinsStore } from '@/stores/checkins'
import { useCoursesStore } from '@/stores/courses'
import { useChildrenStore } from '@/stores/children'
import { todayStr } from '@/utils/date'
import { courseColorOf } from '@/utils/courseColor'
import { confirm } from '@/utils/confirm'
import CheckinCalendar from '@/components/checkin/CheckinCalendar.vue'
import CheckinTable from '@/components/checkin/CheckinTable.vue'
import CheckinFormDialog from '@/components/checkin/CheckinFormDialog.vue'

const checkins = useCheckinsStore()
const courses = useCoursesStore()
const children = useChildrenStore()

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth() + 1)
const selectedDate = ref(todayStr())

const checkinDialogOpen = ref(false)
const dialogDate = ref(todayStr())

const viewMode = ref<'calendar' | 'list'>('calendar')
const isCalendar = computed(() => viewMode.value === 'calendar')
function toggleView() {
  viewMode.value = viewMode.value === 'calendar' ? 'list' : 'calendar'
}

const monthPrefix = computed(() => `${year.value}-${String(month.value).padStart(2, '0')}`)

const monthCheckins = computed(() => checkins.items.filter((c) => c.date.startsWith(monthPrefix.value)))
const monthCount = computed(() => monthCheckins.value.length)
const monthHours = computed(() => monthCheckins.value.reduce((s, c) => s + Number(c.hours), 0))

const dayList = computed(() => checkins.items.filter((c) => c.date === selectedDate.value))
const dayHours = computed(() => dayList.value.reduce((s, c) => s + Number(c.hours), 0))

const dayLabel = computed(() => {
  const [, m, d] = selectedDate.value.split('-')
  return `${Number(m)}月${Number(d)}日`
})
const weekdayText = computed(() => {
  const [y, m, d] = selectedDate.value.split('-').map(Number)
  return `星期${'日一二三四五六'[new Date(y!, m! - 1, d!).getDay()]!}`
})

function prevMonth() {
  if (month.value === 1) { month.value = 12; year.value -= 1 } else { month.value -= 1 }
}
function nextMonth() {
  if (month.value === 12) { month.value = 1; year.value += 1 } else { month.value += 1 }
}
function goToday() {
  const t = todayStr()
  const [y, m] = t.split('-').map(Number)
  year.value = y!
  month.value = m!
  selectedDate.value = t
}
function onSelect(date: string) {
  selectedDate.value = date
  const [y, m] = date.split('-').map(Number)
  year.value = y!
  month.value = m!
}
function openCheckin(date: string) {
  dialogDate.value = date
  checkinDialogOpen.value = true
}
async function removeCheckin(id: string) {
  const ok = await confirm({
    title: '删除打卡',
    message: '删除后该节课时会计回课程剩余课时，确定删除这条打卡记录吗？',
    confirmText: '删除',
    cancelText: '取消',
  })
  if (!ok) return
  await checkins.remove(id)
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 dark-page p-6">
    <!-- 没宝贝 -->
    <div
      v-if="children.loaded && children.count === 0"
      class="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center"
    >
      <div class="mb-4 text-6xl">🌱</div>
      <h2 class="mb-2 text-xl font-bold" style="color: #fff;">还没有宝贝档案</h2>
      <p class="mb-6 text-sm" style="color: rgba(255,255,255,0.6);">先去「设置」创建一个宝贝，再回来记录上课情况吧。</p>
    </div>

    <template v-else>
      <header class="flex items-end justify-between">
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-bold" style="color: #fff;">
            <span>{{ children.active?.emoji ?? '🗓' }}</span>
            <span v-if="isCalendar">{{ children.active?.name ?? '' }}的打卡日历</span>
            <span v-else>{{ children.active?.name ?? '' }}的打卡记录</span>
          </h1>
          <p v-if="isCalendar" class="mt-1 text-sm" style="color: rgba(255,255,255,0.5);">
            本月打卡 {{ monthCount }} 次 · 共 {{ monthHours }} 节，点击日期查看当天详情
          </p>
          <p v-else class="mt-1 text-sm" style="color: rgba(255,255,255,0.5);">
            共 {{ checkins.items.length }} 条记录，可按课程和时间筛选后直接导出 Excel
          </p>
        </div>
        <button class="btn-dark-ghost" @click="toggleView">
          {{ isCalendar ? '📋 列表' : '📅 日历' }}
        </button>
      </header>

      <!-- 日历视图 -->
      <div v-if="isCalendar" class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-4">
        <div class="glass-card flex min-h-0 flex-col p-5">
          <div class="mb-3 flex items-center justify-between">
            <div class="el-button-group" style="display: inline-flex;">
              <button class="btn-dark-ghost" style="border-radius: 10px 0 0 10px; padding: 6px 12px;" @click="prevMonth">‹</button>
              <button
                class="btn-dark-ghost"
                style="border-radius: 0; padding: 6px 24px; font-weight: 600; color: #fff; border-left: 0;"
              >
                {{ year }} 年 {{ month }} 月
              </button>
              <button class="btn-dark-ghost" style="border-radius: 0 10px 10px 0; padding: 6px 12px; border-left: 0;" @click="nextMonth">›</button>
            </div>
            <button
              class="btn-dark-ghost"
              :disabled="selectedDate === todayStr()"
              style="font-size: 12px; padding: 4px 12px;"
              @click="goToday"
            >
              回到今天
            </button>
          </div>
          <div class="min-h-0 flex-1">
            <CheckinCalendar
              :year="year"
              :month="month"
              :selected-date="selectedDate"
              :checkins="checkins.items"
              @select-date="onSelect"
            />
          </div>
        </div>

        <div class="glass-card flex min-h-0 flex-col p-5">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <h3 class="font-bold" style="color: #fff;">{{ dayLabel }} · {{ weekdayText }}</h3>
              <p v-if="dayList.length > 0" class="mt-0.5 text-xs" style="color: rgba(255,255,255,0.5);">
                共 {{ dayList.length }} 次打卡 · {{ dayHours }} 节
              </p>
            </div>
            <button class="btn-dark-primary" style="font-size: 12px; padding: 4px 12px;" @click="openCheckin(selectedDate)">
              ＋ 打卡
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div
              v-if="dayList.length === 0"
              class="flex h-full flex-col items-center justify-center py-10 text-center"
            >
              <div class="mb-2 text-3xl">🌱</div>
              <p class="text-sm" style="color: rgba(255,255,255,0.5);">这一天还没有打卡</p>
              <button class="btn-dark-ghost mt-3" style="font-size: 12px; padding: 4px 12px;" @click="openCheckin(selectedDate)">
                记录一次
              </button>
            </div>

            <ul v-else class="space-y-2">
              <li
                v-for="c in dayList"
                :key="c.id"
                class="rounded-lg p-3"
                style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="flex items-center gap-1.5 text-sm font-medium" style="color: #fff;">
                      <span
                        class="h-2 w-2 shrink-0 rounded-full"
                        :style="{ backgroundColor: courseColorOf(c.course_id).text }"
                      />
                      <span class="truncate">{{ courses.byId(c.course_id)?.name ?? '已删除课程' }}</span>
                      <span
                        class="shrink-0 rounded px-1.5 py-px text-[11px] font-semibold"
                        style="background: rgba(63,184,122,0.15); color: #5FCE89;"
                      >
                        -{{ c.hours }} 节
                      </span>
                    </p>
                    <p v-if="c.feedback" class="mt-1 text-xs" style="color: rgba(255,255,255,0.55);">{{ c.feedback }}</p>
                    <p v-else class="mt-1 text-xs" style="color: rgba(255,255,255,0.3);">（无反馈）</p>
                  </div>
                  <el-button link type="danger" size="small" class="!-mt-1 shrink-0" @click="removeCheckin(c.id)">
                    删除
                  </el-button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 列表视图 -->
      <div v-else class="glass-card min-h-0 flex-1 overflow-y-auto p-5">
        <CheckinTable />
      </div>
    </template>

    <CheckinFormDialog v-model="checkinDialogOpen" :preselected-date="dialogDate" />
  </div>
</template>
