<script setup lang="ts">
/**
 * 打卡弹窗
 */
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useCoursesStore } from '@/stores/courses'
import { useCheckinsStore } from '@/stores/checkins'
import { todayStr } from '@/utils/date'
import { positiveNumber, dateRequired } from '@/utils/validators'
import { courseColorOf } from '@/utils/courseColor'

const props = defineProps<{
  modelValue: boolean
  /** 可选：预选某课程（首页"快速打卡"用） */
  preselectedCourseId?: string | null
  /** 可选：预填上课日期（打卡日历页点某天用），默认今天 */
  preselectedDate?: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  saved: []
}>()

const courses = useCoursesStore()
const checkins = useCheckinsStore()

const formRef = ref<FormInstance | null>(null)
const form = ref({
  course_id: '',
  date: todayStr(),
  hours: 1,
  feedback: '',
})

const rules = {
  course_id: [{ required: true, message: '请选择课程', trigger: 'change' }],
  date: [dateRequired()],
  hours: [positiveNumber('节数必须大于 0')],
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      // 每次打开都重置"显示已耗尽"状态,避免上次勾选带到下次
      showExhausted.value = false
      form.value = {
        course_id: props.preselectedCourseId ?? courses.items[0]?.id ?? '',
        date: props.preselectedDate ?? todayStr(),
        hours: 1,
        feedback: '',
      }
    }
  },
)

const selectedSummary = computed(() =>
  form.value.course_id
    ? courses.summaries.find((s) => s.id === form.value.course_id)
    : null,
)

const submitting = ref(false)

/** 是否显示已耗尽(剩 0 节)的课程 —— 默认隐藏,避免误选 */
const showExhausted = ref(false)
/** 弹框里展示的课程:默认过滤掉已耗尽 */
const availableCourses = computed(() =>
  showExhausted.value
    ? courses.summaries
    : courses.summaries.filter((c) => c.remain_hours > 0),
)
/** 已耗尽课程数量,给"显示已耗尽 N 门"提示用 */
const exhaustedCount = computed(
  () => courses.summaries.filter((c) => c.remain_hours <= 0).length,
)

async function onSubmit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    // create 内部已刷新 courses 聚合，这里不再重复请求
    await checkins.create({
      course_id: form.value.course_id,
      date: form.value.date,
      hours: Number(form.value.hours),
      feedback: form.value.feedback,
    })
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="上课记录"
    width="500"
    align-center
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80">
      <el-form-item label="课程" prop="course_id">
        <el-select
          v-model="form.course_id"
          placeholder="选择课程"
          class="w-full"
          popper-class="checkin-course-popper"
        >
          <template #prefix>
            <span
              v-if="form.course_id"
              class="ml-1 mr-1 inline-block h-3 w-3 rounded-full"
              :style="{ background: courseColorOf(form.course_id).bg, border: '1px solid ' + courseColorOf(form.course_id).text }"
            />
          </template>
          <el-option
            v-for="c in availableCourses"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          >
            <div class="flex w-full items-center gap-2">
              <span
                class="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                :style="{ background: courseColorOf(c.id).bg, border: '1px solid ' + courseColorOf(c.id).text }"
              />
              <span class="flex-1 truncate text-left">{{ c.name }}</span>
              <span
                class="text-xs"
                :class="c.status === 'low' ? 'checkin-course-low' : 'checkin-course-dim'"
              >剩 {{ c.remain_hours }} 节</span>
            </div>
          </el-option>
        </el-select>
      </el-form-item>
      <div
        v-if="selectedSummary"
        class="mb-3 -mt-1 rounded-lg px-3 py-2 text-xs"
        style="background: rgba(63,184,122,0.08); border: 1px solid rgba(63,184,122,0.18); color: var(--text-body);"
      >
        <span>已用 {{ selectedSummary.used_hours }} / {{ selectedSummary.total_hours }} 节</span>
        <span class="mx-2" style="color: var(--text-ghost);">·</span>
        <span :style="selectedSummary.status === 'low' ? 'color: var(--sun-2); font-weight: 600;' : ''">
          剩 {{ selectedSummary.remain_hours }} 节
        </span>
      </div>
      <div
        v-if="exhaustedCount > 0 && !showExhausted"
        class="checkin-exhausted-hint"
      >
        已隐藏 {{ exhaustedCount }} 门已耗尽课程
        <el-link type="primary" :underline="false" @click="showExhausted = true">
          显示
        </el-link>
      </div>
      <el-form-item label="上课日期" prop="date">
        <el-date-picker
          v-model="form.date"
          type="date"
          value-format="YYYY-MM-DD"
          class="w-full"
        />
      </el-form-item>
      <el-form-item label="节数" prop="hours">
        <el-input-number
          v-model="form.hours"
          :min="0.5"
          :step="1"
          :precision="1"
          class="w-full"
          controls-position="right"
        />
      </el-form-item>
      <el-form-item label="课堂反馈">
        <el-input
          v-model="form.feedback"
          type="textarea"
          :rows="3"
          placeholder="宝贝今天表现如何？"
          maxlength="200"
          show-word-limit
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        打卡
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 课程下拉项:低课时用暖橙警示,普通项用柔和灰,不抢主色 */
.checkin-course-low {
  color: var(--sun-2);
  font-weight: 600;
}
.checkin-course-dim {
  color: var(--text-soft);
}

/* "已隐藏 N 门已耗尽"提示行 */
.checkin-exhausted-hint {
  margin: -8px 0 12px;
  font-size: 12px;
  color: var(--text-soft);
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>

<style>
/* 全局(popper 渲染到 body 下,scoped 不生效) */
.checkin-course-popper .el-select-dropdown__item.is-selected {
  /* 选中态:浅色背景 + 品牌色左边框 + 加粗,深色主题下也清晰可辨 */
  background: var(--brand-soft-bg, rgba(63,184,122,0.12)) !important;
  border-left: 3px solid var(--brand-1, #3FB87A);
  font-weight: 600;
  color: var(--brand-text, #1F7D4E) !important;
}
.checkin-course-popper .el-select-dropdown__item.is-selected::after {
  content: '✓';
  position: absolute;
  right: 14px;
  color: var(--brand-1, #3FB87A);
  font-weight: 700;
}
.checkin-course-popper .el-select-dropdown__item:hover {
  background: var(--btn-ghost-bg-hover, rgba(63,184,122,0.06)) !important;
}
</style>
