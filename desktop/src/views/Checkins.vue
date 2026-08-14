<script setup lang="ts">
import { onMounted } from 'vue'
import { useCheckinsStore } from '@/stores/checkins'
import { useCoursesStore } from '@/stores/courses'
import CheckinTable from '@/components/checkin/CheckinTable.vue'

const checkins = useCheckinsStore()
const courses = useCoursesStore()

onMounted(() => {
  checkins.refresh()
  courses.refresh()
})
</script>

<template>
  <div class="h-full overflow-y-auto bg-bg p-6">
    <CheckinTable />
  </div>
</template>
