<script setup lang="ts">
/**
 * 课程新增 / 编辑弹窗
 */
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import type { Course, CourseInput } from '@/stores/courses'
import { todayStr } from '@/utils/date'
import { positiveNumber, dateRequired } from '@/utils/validators'
import { useCoursesStore } from '@/stores/courses'

const props = defineProps<{
  modelValue: boolean
  course?: Course | null
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  saved: []
}>()

const courses = useCoursesStore()

const formRef = ref<FormInstance | null>(null)
const form = ref<CourseInput>({
  name: '',
  institution: '',
  total_amount: 0,
  total_hours: 0,
  paid_at: todayStr(),
  expires_at: null,
  tags: '',
  note: '',
})

const rules = {
  name: [{ required: true, message: '请输入课程名称', trigger: 'blur' }],
  total_amount: [positiveNumber('缴费金额必须大于 0')],
  total_hours: [positiveNumber('购买课时必须大于 0')],
  paid_at: [dateRequired()],
}

const isEdit = computed(() => !!props.course)

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      // 打开时回填
      if (props.course) {
        form.value = {
          name: props.course.name,
          institution: props.course.institution,
          total_amount: props.course.total_amount,
          total_hours: props.course.total_hours,
          paid_at: props.course.paid_at,
          expires_at: props.course.expires_at,
          tags: props.course.tags,
          note: props.course.note,
        }
      } else {
        form.value = {
          name: '',
          institution: '',
          total_amount: 0,
          total_hours: 0,
          paid_at: todayStr(),
          expires_at: null,
          tags: '',
          note: '',
        }
      }
    }
  },
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
    if (isEdit.value && props.course) {
      courses.update(props.course.id, form.value)
      ElMessage.success('已保存')
    } else {
      courses.create(form.value)
      ElMessage.success('已新增')
    }
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
    :title="isEdit ? '编辑课程' : '新增课程'"
    width="540"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="88" label-position="right">
      <el-form-item label="课程名称" prop="name">
        <el-input v-model="form.name" placeholder="如：少儿钢琴基础" maxlength="30" show-word-limit />
      </el-form-item>
      <el-form-item label="培训机构" prop="institution">
        <el-input v-model="form.institution" placeholder="可选" maxlength="30" />
      </el-form-item>
      <div class="grid grid-cols-2 gap-4">
        <el-form-item label="缴费金额" prop="total_amount">
          <el-input-number
            v-model="form.total_amount"
            :min="0.01"
            :step="100"
            :precision="2"
            class="w-full"
            controls-position="right"
          />
          <span class="ml-2 text-xs text-ink-ghost">元</span>
        </el-form-item>
        <el-form-item label="购买课时" prop="total_hours">
          <el-input-number
            v-model="form.total_hours"
            :min="0.5"
            :step="1"
            :precision="1"
            class="w-full"
            controls-position="right"
          />
          <span class="ml-2 text-xs text-ink-ghost">节</span>
        </el-form-item>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <el-form-item label="缴费日期" prop="paid_at">
          <el-date-picker
            v-model="form.paid_at"
            type="date"
            value-format="YYYY-MM-DD"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="到期日期" prop="expires_at">
          <el-date-picker
            v-model="form.expires_at"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="可选"
            class="w-full"
          />
        </el-form-item>
      </div>
      <el-form-item label="标签" prop="tags">
        <el-input v-model="form.tags" placeholder="逗号分隔，如：艺术,周末班" />
      </el-form-item>
      <el-form-item label="备注" prop="note">
        <el-input v-model="form.note" type="textarea" :rows="2" maxlength="120" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ isEdit ? '保存' : '新增' }}
      </el-button>
    </template>
  </el-dialog>
</template>
