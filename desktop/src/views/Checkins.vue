<script setup lang="ts">
/**
 * 上课记录 —— 日历 / 列表 双视图
 * 日历：左月历（每天内嵌课程胶囊）+ 右选中日打卡详情
 * 列表：打卡记录表（可按课程 / 时间筛选）
 * 右上角按钮在两种视图间切换
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
const month = ref(now.getMonth() + 1) // 1-12
const selectedDate = ref(todayStr())

const checkinDialogOpen = ref(false)
const dialogDate = ref(todayStr())

/** 展示模式：calendar 日历 / list 列表 */
const viewMode = ref<'calendar' | 'list'>('calendar')
const isCalendar = computed(() => viewMode.value === 'calendar')
function toggleView() {
  viewMode.value = viewMode.value === 'calendar' ? 'list' : 'calendar'
}

const monthPrefix = computed(() => `${year.value}-${String(month.value).padStart(2, '0')}`)

const monthCheckins = computed(() => checkins.items.filter((c) => c.date.startsWith(monthPrefix.value)))
const monthCount = computed(() => monthCheckins.value.length)
const monthHours = computed(() => monthCheckins.value.reduce((s, c) => s + Number(c.hours), 0))

const dayList = computed(() =>
  checkins.items.filter((c) => c.date === selectedDate.value),
)
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
  <div class="flex h-full flex-col gap-4 bg-bg p-6">
    <!-- 没宝贝：引导去设置页创建 -->
    <div
      v-if="children.loaded && children.count === 0"
      class="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center"
    >
      <div class="mb-4 text-6xl">🌱</div>
      <h2 class="mb-2 text-xl font-bold text-ink">还没有宝贝档案</h2>
      <p class="mb-6 text-sm text-ink-soft">先去「设置」创建一个宝贝，再回来记录上课情况吧。</p>
    </div>

    <template v-else>
      <header class="flex items-end justify-between">
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-bold text-ink">
            <span>{{ children.active?.emoji ?? '🗓' }}</span>
            <span v-if="isCalendar">{{ children.active?.name ?? '' }}的打卡日历</span>
            <span v-else>{{ children.active?.name ?? '' }}的打卡记录</span>
          </h1>
          <p v-if="isCalendar" class="mt-1 text-sm text-ink-soft">
            本月打卡 {{ monthCount }} 次 · 共 {{ monthHours }} 节，点击日期查看当天详情
          </p>
          <p v-else class="mt-1 text-sm text-ink-soft">
            共 {{ checkins.items.length }} 条记录，可按课程和时间筛选
          </p>
        </div>
        <el-button type="primary" plain @click="toggleView">
          {{ isCalendar ? '📋 列表' : '📅 日历' }}
        </el-button>
      </header>

      <!-- 日历视图 -->
      <div v-if="isCalendar" class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-4">
        <!-- 左：月历 -->
        <div class="card-base flex min-h-0 flex-col p-4">
          <div class="mb-3 flex items-center justify-between">
            <el-button-group>
              <el-button class="month-nav" @click="prevMonth">‹</el-button>
              <el-button class="!px-8 font-semibold text-ink">
                {{ year }} 年 {{ month }} 月
              </el-button>
              <el-button class="month-nav" @click="nextMonth">›</el-button>
            </el-button-group>
            <el-button size="small" :disabled="selectedDate === todayStr()" @click="goToday">
              回到今天
            </el-button>
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

        <!-- 右：选中日详情 -->
        <div class="card-base flex min-h-0 flex-col p-4">

          <div class="mb-3 flex items-center justify-between">
            <div>
              <h3 class="font-bold text-ink">{{ dayLabel }} · {{ weekdayText }}</h3>
              <p v-if="dayList.length > 0" class="mt-0.5 text-xs text-ink-soft">
                共 {{ dayList.length }} 次打卡 · {{ dayHours }} 节
              </p>
            </div>
            <el-button type="primary" plain size="small" @click="openCheckin(selectedDate)">
              ＋ 打卡
            </el-button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div
              v-if="dayList.length === 0"
              class="flex h-full flex-col items-center justify-center py-10 text-center"
            >
              <div class="mb-2 text-3xl">🌱</div>
              <p class="text-sm text-ink-soft">这一天还没有打卡</p>
              <el-button class="mt-3" type="primary" plain size="small" @click="openCheckin(selectedDate)">
                记录一次
              </el-button>
            </div>

            <ul v-else class="space-y-2">
              <li
                v-for="c in dayList"
                :key="c.id"
                class="rounded-lg bg-white p-3 ring-1 ring-brand-100"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <span
                        class="h-2 w-2 shrink-0 rounded-full"
                        :style="{ backgroundColor: courseColorOf(c.course_id).text }"
                      />
                      <span class="truncate">{{ courses.byId(c.course_id)?.name ?? '已删除课程' }}</span>
                      <span class="shrink-0 rounded bg-brand-50 px-1.5 py-px text-[11px] font-semibold text-brand-600">
                        -{{ c.hours }} 节
                      </span>
                    </p>
                    <p v-if="c.feedback" class="mt-1 text-xs text-ink-soft">{{ c.feedback }}</p>
                    <p v-else class="mt-1 text-xs text-ink-ghost">（无反馈）</p>
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
      <div v-else class="card-base min-h-0 flex-1 overflow-y-auto p-4">
        <CheckinTable />
      </div>
    </template>

    <CheckinFormDialog v-model="checkinDialogOpen" :preselected-date="dialogDate" />
  </div>
</template>

<style scoped>
.month-nav {
  font-size: 18px;
  line-height: 1;
}
</style>
