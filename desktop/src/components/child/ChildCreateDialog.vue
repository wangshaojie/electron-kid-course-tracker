<script setup lang="ts">
/**
 * 创建 / 编辑宝贝档案弹窗
 */
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useChildrenStore, type Child } from '@/stores/children'
import { CHILD_EMOJI_POOL, CHILD_COLOR_POOL } from '@/data/childPool'

const props = defineProps<{
  modelValue: boolean
  child?: Child | null
  /** "next" 模式 = 创建后自动切到新宝贝（首次启动用） */
  isFirstChild?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  saved: [child: Child]
  /** 弹窗关闭动画结束后触发，用于父组件清掉残留的编辑目标 */
  closed: []
}>()

const children = useChildrenStore()

const formRef = ref<FormInstance | null>(null)
const form = ref({
  name: '',
  emoji: '🧒',
  color: '#3FB87A',
})

const rules = {
  name: [
    { required: true, message: '请输入宝贝的称呼', trigger: 'blur' },
    { max: 12, message: '最多 12 个字', trigger: 'blur' },
  ],
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      if (props.child) {
        form.value = {
          name: props.child.name,
          emoji: props.child.emoji,
          color: props.child.color,
        }
      } else {
        // 默认随机
        form.value = {
          name: '',
          emoji: CHILD_EMOJI_POOL[Math.floor(Math.random() * CHILD_EMOJI_POOL.length)]!,
          color: CHILD_COLOR_POOL[Math.floor(Math.random() * CHILD_COLOR_POOL.length)]!,
        }
      }
    } else {
      // 关闭后清空表单残留（不依赖父组件的 editingChild 状态机）
      form.value = { name: '', emoji: '🧒', color: '#3FB87A' }
      formRef.value?.clearValidate()
    }
  },
)

const isEdit = computed(() => !!props.child)
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
    if (isEdit.value && props.child) {
      await children.update(props.child.id, form.value)
      ElMessage.success('已保存')
      emit('saved', props.child)
    } else {
      const c = await children.create(form.value)
      ElMessage.success(props.isFirstChild ? '欢迎！' : '已新增')
      emit('saved', c)
    }
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    submitting.value = false
  }
}

/** el-dialog 关闭动画结束后的钩子，通知父组件清掉编辑目标 */
function onClosed() {
  emit('closed')
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEdit ? '编辑宝贝档案' : (isFirstChild ? '欢迎！先建一个宝贝档案' : '新增宝贝档案')"
    width="500"
    align-center
    append-to-body
    :close-on-click-modal="!isFirstChild"
    :show-close="!isFirstChild"
    destroy-on-close
    @closed="onClosed"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80">
      <!-- 头像预览 -->
      <div class="mb-4 flex flex-col items-center gap-3">
        <div
          class="flex h-20 w-20 items-center justify-center rounded-full text-4xl shadow-soft"
          :style="{ background: form.color + '22', border: `3px solid ${form.color}` }"
        >
          {{ form.emoji }}
        </div>
      </div>

      <el-form-item label="称呼" prop="name">
        <el-input
          v-model="form.name"
          :placeholder="isFirstChild ? '比如：小宝 / 朵朵' : '宝贝的称呼'"
          maxlength="12"
          show-word-limit
        />
      </el-form-item>

      <el-form-item label="头像">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="e in CHILD_EMOJI_POOL"
            :key="e"
            type="button"
            :class="[
              'btn-press flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-all',
              form.emoji === e ? 'ring-2 ring-moss-500 bg-moss-50' : 'hover:bg-moss-50/50',
            ]"
            @click="form.emoji = e"
          >
            {{ e }}
          </button>
        </div>
      </el-form-item>

      <el-form-item label="主题色">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in CHILD_COLOR_POOL"
            :key="c"
            type="button"
            :class="[
              'btn-press h-8 w-8 rounded-full transition-all',
              form.color === c ? 'ring-2 ring-ink ring-offset-2' : 'hover:scale-110',
            ]"
            :style="{ background: c }"
            @click="form.color = c"
          />
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button v-if="!isFirstChild" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        @click="onSubmit"
      >
        {{ isFirstChild ? '开始使用 →' : (isEdit ? '保存' : '新增') }}
      </el-button>
    </template>
  </el-dialog>
</template>
