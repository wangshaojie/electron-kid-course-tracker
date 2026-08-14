<script setup lang="ts">
/**
 * 首页总览
 */
import { computed, ref } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'
import { useChildrenStore } from '@/stores/children'
import { useAuthStore } from '@/stores/auth'
import { formatMoney } from '@/utils/money'
import { todayStr } from '@/utils/date'
import StatCard from '@/components/common/StatCard.vue'
import AlertBanner from '@/components/common/AlertBanner.vue'
import CheckinFormDialog from '@/components/checkin/CheckinFormDialog.vue'
import { useRouter } from 'vue-router'

const courses = useCoursesStore()
const checkins = useCheckinsStore()
const children = useChildrenStore()
const auth = useAuthStore()
const router = useRouter()

const checkinDialogOpen = ref(false)
const preselectedId = ref<string | null>(null)

const todayCheckinCount = computed(() => {
  const today = todayStr()
  return checkins.items.filter((c) => c.date === today).length
})

const recentCheckins = computed(() => checkins.items.slice(0, 5))

const lowSummary = computed(() =>
  courses.summaries.filter((s) => s.status === 'low' || s.status === 'expired'),
)

/** 没有孩子数据时的明确引导 —— 不让人误以为"必须新建" */
const noChildHint = computed(() => ({
  email: auth.user?.email ?? '',
}))

function quickCheckin(id: string) {
  preselectedId.value = id
  checkinDialogOpen.value = true
}

function onSaved() {
  // refresh
  courses.refresh()
  checkins.refresh()
}

function viewAll() {
  void router.push('/checkins')
}

function gotoSettings() {
  void router.push('/settings')
}

async function signOut() {
  await auth.signOut()
  void router.push('/login')
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg p-6">
    <!-- 没孩子：直接展示"创建孩子"引导（不再弹警告 Toast） -->
    <div
      v-if="children.loaded && children.count === 0"
      class="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center"
    >
      <div class="mb-4 text-6xl">🌱</div>
      <h2 class="mb-2 text-xl font-bold text-ink">欢迎，{{ noChildHint.email }}</h2>
      <p class="mb-6 text-sm text-ink-soft">
        你的账号下还没有孩子，先创建一个孩子档案，就可以开始记录课程和打卡啦。
      </p>
      <div class="flex gap-2">
        <el-button type="primary" size="large" @click="gotoSettings">＋ 创建孩子</el-button>
        <el-button size="large" @click="signOut">退出登录</el-button>
      </div>
    </div>

    <template v-else>
    <header class="mb-5">
      <h1 class="flex items-center gap-2 text-2xl font-bold text-ink">
        <span>{{ children.active?.emoji ?? '🌱' }}</span>
        <span>{{ children.active?.name ?? '小探险家' }}的成长</span>
      </h1>
      <p class="text-sm text-ink-soft">看一眼关键数字 + 预警</p>
    </header>

    <!-- 预警 -->
    <AlertBanner :alerts="courses.alerts" class="mb-5" />

    <!-- 汇总卡片 -->
    <div class="mb-6 grid grid-cols-4 gap-4">
      <StatCard
        :label="'课程总数'"
        :value="courses.count"
        unit="个"
        icon="📚"
        tone="brand"
      />
      <StatCard
        :label="'总投入'"
        :value="formatMoney(courses.totalAmount)"
        icon="💰"
        tone="sky"
      />
      <StatCard
        :label="'总剩余课时'"
        :value="courses.remainHours"
        unit="节"
        icon="📈"
        :tone="courses.remainHours <= 5 ? 'sun' : 'brand'"
        :hint="`已用 ${courses.usedHours} / 购 ${courses.totalHours} 节`"
      />
      <StatCard
        :label="'今日打卡'"
        :value="todayCheckinCount"
        unit="次"
        icon="✅"
        tone="brand"
      />
    </div>

    <div class="grid grid-cols-3 gap-4">
      <!-- 快捷入口 -->
      <div class="card-base col-span-1">
        <h3 class="mb-3 font-bold text-ink">⚡ 快捷操作</h3>
        <div class="space-y-2">
          <button
            class="btn-press w-full rounded-lg bg-brand-400 px-3 py-2.5 text-left text-sm font-medium text-white shadow-soft hover:bg-brand-500"
            @click="checkinDialogOpen = true"
          >
            🎯 快速上课打卡
          </button>
          <button
            class="btn-press w-full rounded-lg bg-white px-3 py-2.5 text-left text-sm font-medium text-ink ring-1 ring-brand-100 hover:bg-brand-50"
            @click="router.push('/courses')"
          >
            📚 新增 / 管理课程
          </button>
          <button
            class="btn-press w-full rounded-lg bg-white px-3 py-2.5 text-left text-sm font-medium text-ink ring-1 ring-brand-100 hover:bg-brand-50"
            @click="router.push('/stats')"
          >
            📈 查看统计图表
          </button>
        </div>
      </div>

      <!-- 课时预警 -->
      <div class="card-base col-span-2">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-bold text-ink">⚠️ 课时预警</h3>
          <button
            v-if="lowSummary.length > 0"
            type="button"
            class="text-xs text-brand-500 hover:underline"
            @click="router.push('/courses')"
          >
            全部 →
          </button>
        </div>
        <div v-if="lowSummary.length === 0" class="rounded-lg bg-brand-50/50 py-6 text-center text-sm text-ink-soft">
          一切正常 🌱
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="s in lowSummary.slice(0, 5)"
            :key="s.id"
            class="flex items-center justify-between rounded-lg bg-cream-50 px-3 py-2.5"
          >
            <div>
              <p class="text-sm font-medium text-ink">{{ s.name }}</p>
              <p class="text-xs text-ink-soft">
                剩 {{ s.remain_hours }} 节
                <span v-if="s.expires_at" class="ml-2">
                  · 到期 {{ s.expires_at }}
                  <span v-if="s.days_to_expire !== null && s.days_to_expire >= 0">
                    ({{ s.days_to_expire }} 天)
                  </span>
                  <span v-else-if="s.days_to_expire !== null && s.days_to_expire < 0" class="text-danger">
                    (已过期 {{ -s.days_to_expire }} 天)
                  </span>
                </span>
              </p>
            </div>
            <el-button size="small" type="primary" plain @click="quickCheckin(s.id)">
              打卡
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近打卡 -->
    <div class="mt-4 card-base">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="font-bold text-ink">🕒 最近打卡</h3>
        <button class="text-xs text-brand-500 hover:underline" @click="viewAll">全部 →</button>
      </div>
      <div v-if="recentCheckins.length === 0" class="py-6 text-center text-sm text-ink-soft">
        还没有打卡记录
      </div>
      <ul v-else class="divide-y divide-brand-50">
        <li
          v-for="c in recentCheckins"
          :key="c.id"
          class="flex items-center justify-between py-2.5"
        >
          <div>
            <p class="text-sm font-medium text-ink">
              {{ courses.byId(c.course_id)?.name ?? '(已删除)' }}
            </p>
            <p class="text-xs text-ink-ghost">{{ c.date }} · {{ c.feedback || '（无反馈）' }}</p>
          </div>
          <span class="text-sm font-semibold text-brand-500">-{{ c.hours }} 节</span>
        </li>
      </ul>
    </div>

    <CheckinFormDialog
      v-model="checkinDialogOpen"
      :preselected-course-id="preselectedId"
      @saved="onSaved"
    />
    </template>
  </div>
</template>

<style scoped>
.btn-press {
  transition: all 0.15s ease;
}
.btn-press:active {
  transform: scale(0.98);
}
</style>
