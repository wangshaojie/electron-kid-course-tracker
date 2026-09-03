<script setup lang="ts">
/**
 * 首页总览（暗色玻璃风）
 */
import { computed, ref } from 'vue'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'
import { useChildrenStore } from '@/stores/children'
import { useAuthStore } from '@/stores/auth'
import type { CourseSummary } from '@/types'
import { formatMoney } from '@/utils/money'
import { todayStr } from '@/utils/date'
import StatCard from '@/components/common/StatCard.vue'
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

const courseRows = computed(() =>
  [...courses.summaries]
    .filter((s) => s.status !== 'done')
    .sort((a, b) => a.remain_hours - b.remain_hours),
)

function usedPct(s: CourseSummary): number {
  return s.total_hours > 0 ? Math.min(100, Math.round((s.used_hours / s.total_hours) * 100)) : 0
}

const noChildHint = computed(() => ({
  email: auth.user?.email ?? '',
}))

function quickCheckin(id: string) {
  preselectedId.value = id
  checkinDialogOpen.value = true
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
  <div class="h-full overflow-y-auto dark-page p-6">
    <!-- 没宝贝 -->
    <div
      v-if="children.loaded && children.count === 0"
      class="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center"
    >
      <div class="mb-4 text-6xl">🌱</div>
      <h2 class="mb-2 text-xl font-bold" style="color: #fff;">
        欢迎，{{ noChildHint.email }}
      </h2>
      <p class="mb-6 text-sm" style="color: rgba(255,255,255,0.6);">
        你的账号下还没有宝贝，先创建一个宝贝档案，就可以开始记录课程和打卡啦。
      </p>
      <div class="flex gap-2">
        <button class="btn-dark-primary" @click="gotoSettings">＋ 创建宝贝</button>
        <button class="btn-dark-ghost" @click="signOut">退出登录</button>
      </div>
    </div>

    <template v-else>
      <header class="mb-5">
        <h1 class="flex items-center gap-2 text-2xl font-bold" style="color: #fff;">
          <span>{{ children.active?.emoji ?? '🌱' }}</span>
          <span>{{ children.active?.name ?? '小探险家' }}的成长</span>
        </h1>
        <p class="text-sm" style="color: rgba(255,255,255,0.5);">看一眼关键数字 + 课时消耗</p>
      </header>

      <!-- 汇总卡片（错位入场：60ms 间隔） -->
      <div class="mb-6 grid grid-cols-4 gap-4">
        <div class="card-stagger" :style="{ animationDelay: '0ms' }">
          <StatCard label="课程总数" :value="courses.count" unit="个" icon="📚" tone="brand" />
        </div>
        <div class="card-stagger" :style="{ animationDelay: '60ms' }">
          <StatCard label="总投入" :value="formatMoney(courses.totalAmount)" icon="💰" tone="sky" />
        </div>
        <div class="card-stagger" :style="{ animationDelay: '120ms' }">
          <StatCard
            label="总剩余课时"
            :value="courses.remainHours"
            unit="节"
            icon="📈"
            :tone="courses.remainHours <= 5 ? 'sun' : 'brand'"
            :hint="`已用 ${courses.usedHours} / 购 ${courses.totalHours} 节`"
          />
        </div>
        <div class="card-stagger" :style="{ animationDelay: '180ms' }">
          <StatCard label="今日打卡" :value="todayCheckinCount" unit="次" icon="✅" tone="brand" />
        </div>
      </div>

      <div class="grid grid-cols-3 gap-4">
        <!-- 快捷入口 -->
        <div class="glass-card col-span-1 p-5 card-stagger" :style="{ animationDelay: '240ms' }">
          <h3 class="mb-3 font-bold" style="color: #fff;">⚡ 快捷操作</h3>
          <div class="space-y-2">
            <button
              class="btn-dark-primary w-full glow-ring"
              style="justify-content: flex-start; padding: 11px 14px;"
              @click="checkinDialogOpen = true"
            >
              🎯 快速上课记录
            </button>
            <button
              class="btn-dark-ghost w-full"
              style="justify-content: flex-start; padding: 11px 14px;"
              @click="router.push('/courses')"
            >
              📚 新增 / 管理课程
            </button>
            <button
              class="btn-dark-ghost w-full"
              style="justify-content: flex-start; padding: 11px 14px;"
              @click="router.push('/stats')"
            >
              📈 查看统计图表
            </button>
          </div>
        </div>

        <!-- 课时消耗（带流光进度条） -->
        <div class="glass-card col-span-2 p-5 card-stagger" :style="{ animationDelay: '320ms' }">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="font-bold" style="color: #fff;">⏳ 课时消耗</h3>
            <button
              v-if="courseRows.length > 0"
              type="button"
              class="text-xs transition-colors"
              style="color: #5FCE89;"
              @click="router.push('/courses')"
            >
              全部 →
            </button>
          </div>
          <div
            v-if="courseRows.length === 0"
            class="rounded-lg py-6 text-center text-sm"
            style="background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.5);"
          >
            暂无进行中的课程 🌱
          </div>
          <ul v-else class="space-y-4">
            <li v-for="s in courseRows.slice(0, 5)" :key="s.id">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-sm font-medium" style="color: #fff;">{{ s.name }}</span>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="text-xs" style="color: rgba(255,255,255,0.5);">
                    剩
                    <b
                      class="glass-num"
                      :class="{
                        'tone-sun': s.remain_hours > 3 && s.remain_hours <= 5,
                        'tone-danger': s.remain_hours <= 3,
                      }"
                      style="font-size: 13px; margin: 0 2px;"
                    >
                      {{ s.remain_hours }}
                    </b>
                    节
                  </span>
                  <button class="btn-dark-primary" style="padding: 4px 12px; font-size: 12px;" @click="quickCheckin(s.id)">
                    打卡
                  </button>
                </div>
              </div>
              <!-- 流光进度条（薄荷绿 / 暖橙 / 红色 随状态） -->
              <div class="mt-2 progress-track">
                <div
                  class="progress-fill"
                  :class="{
                    'tone-sun': s.status === 'low',
                    'tone-danger': s.status === 'expired',
                  }"
                  :style="{ width: `${usedPct(s)}%` }"
                />
                <!-- 进度文字：右侧悬浮 -->
                <span
                  class="absolute right-0 top-0 -translate-y-5 text-[10px] tabular-nums"
                  style="color: rgba(255,255,255,0.35);"
                >{{ usedPct(s) }}%</span>
              </div>
              <div v-if="s.expires_at" class="mt-1 text-xs" style="color: rgba(255,255,255,0.4);">
                到期 {{ s.expires_at }}
                <span v-if="s.days_to_expire !== null && s.days_to_expire < 0" style="color: #FF7A7A;">
                  （已过期 {{ -s.days_to_expire }} 天）
                </span>
                <span v-else-if="s.days_to_expire !== null">
                  （{{ s.days_to_expire }} 天）
                </span>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <!-- 最近打卡 -->
      <div class="mt-4 glass-card p-5 card-stagger" :style="{ animationDelay: '400ms' }">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-bold" style="color: #fff;">🕒 最近打卡</h3>
          <button class="text-xs" style="color: #5FCE89;" @click="viewAll">全部 →</button>
        </div>
        <div v-if="recentCheckins.length === 0" class="py-6 text-center text-sm" style="color: rgba(255,255,255,0.5);">
          还没有打卡记录
        </div>
        <ul v-else>
          <li
            v-for="c in recentCheckins"
            :key="c.id"
            class="flex items-center justify-between py-2.5"
            style="border-top: 1px solid rgba(255,255,255,0.05);"
          >
            <div>
              <p class="text-sm font-medium" style="color: #fff;">
                {{ courses.byId(c.course_id)?.name ?? '(已删除)' }}
              </p>
              <p class="text-xs" style="color: rgba(255,255,255,0.4);">
                {{ c.date }} · {{ c.feedback || '（无反馈）' }}
              </p>
            </div>
            <span class="text-sm font-semibold num-fade" style="color: #5FCE89;">-{{ c.hours }} 节</span>
          </li>
        </ul>
      </div>

      <CheckinFormDialog
        v-model="checkinDialogOpen"
        :preselected-course-id="preselectedId"
      />
    </template>
  </div>
</template>
