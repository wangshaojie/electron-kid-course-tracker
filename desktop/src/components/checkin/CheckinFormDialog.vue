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
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80">
      <el-form-item label="课程" prop="course_id">
        <el-select
          v-model="form.course_id"
          placeholder="选择课程"
          class="w-full"
          filterable
        >
          <el-option
            v-for="c in courses.summaries"
            :key="c.id"
            :label="`${c.name} (剩 ${c.remain_hours} 节)`"
            :value="c.id"
          />
        </el-select>
      </el-form-item>
      <div v-if="selectedSummary" class="mb-3 -mt-1 rounded-lg bg-brand-50/50 px-3 py-2 text-xs text-ink-soft">
        <span>已用 {{ selectedSummary.used_hours }} / {{ selectedSummary.total_hours }} 节</span>
        <span class="mx-2">·</span>
        <span :class="selectedSummary.status === 'low' ? 'text-sun-500 font-semibold' : ''">
          剩 {{ selectedSummary.remain_hours }} 节
        </span>
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
