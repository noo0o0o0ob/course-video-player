<template>
  <el-card class="panel-card course-panel" shadow="never">
    <template #header>
      <div class="panel-header">
        <div>
          <h2>课程与节点</h2>
          <p>{{ chapterSummary }}</p>
        </div>
        <el-button :icon="Refresh" :loading="loading" circle title="刷新课程" @click="$emit('refresh')" />
      </div>
    </template>

    <div class="course-toolbar">
      <el-select
        :model-value="selectedCourseId"
        placeholder="请选择课程"
        filterable
        class="full-control"
        @change="$emit('select-course', $event)"
      >
        <el-option
          v-for="course in courses"
          :key="course.course_id"
          :label="course.name"
          :value="course.course_id"
        />
      </el-select>
      <el-tag type="info" round>{{ courses.length }} 门</el-tag>
    </div>

    <el-skeleton v-if="loading && !chapters.length" :rows="5" animated />
    <el-empty v-else-if="!chapters.length" description="暂无章节数据" />
    <el-scrollbar v-else class="chapter-scroll">
      <div
        v-for="(chapter, index) in chapters"
        :key="chapter.node_id"
        class="chapter-row"
        :data-state="stateKey(chapter.study_state)"
      >
        <el-tag class="chapter-index" round effect="plain">{{ index + 1 }}</el-tag>
        <div class="chapter-main">
          <strong>{{ chapter.name }}</strong>
          <small>
            <el-tag :type="stateType(chapter.study_state)" size="small" round>
              {{ stateText(chapter.study_state) }}
            </el-tag>
            <span>节点 {{ chapter.node_id }}</span>
          </small>
        </div>
        <span class="chapter-duration">{{ formatDuration(chapter.duration) }}</span>
      </div>
    </el-scrollbar>
  </el-card>
</template>

<script setup>
import { computed } from 'vue'
import { Refresh } from '@element-plus/icons-vue'

const props = defineProps({
  courses: { type: Array, default: () => [] },
  chapters: { type: Array, default: () => [] },
  selectedCourseId: { type: String, default: '' },
  loading: { type: Boolean, default: false }
})

defineEmits(['refresh', 'select-course'])

const completedCount = computed(() =>
  props.chapters.filter((chapter) => chapter.study_state === 2).length
)

const chapterSummary = computed(() => {
  if (!props.courses.length) {
    return '点击刷新读取课程'
  }
  if (!props.chapters.length) {
    return '选择课程后读取章节'
  }
  return `已完成 ${completedCount.value}/${props.chapters.length} 个节点`
})

function stateKey(state) {
  if (state === 2) {
    return 'done'
  }
  if (state === 1) {
    return 'active'
  }
  return 'idle'
}

function stateType(state) {
  if (state === 2) {
    return 'success'
  }
  if (state === 1) {
    return 'warning'
  }
  return 'info'
}

function stateText(state) {
  if (state === 2) {
    return '已完成'
  }
  if (state === 1) {
    return '学习中'
  }
  return '未开始'
}

function formatDuration(seconds) {
  const value = Number(seconds || 0)
  if (!value) {
    return '--'
  }
  const minutes = Math.floor(value / 60)
  const restSeconds = value % 60
  if (!restSeconds) {
    return `${minutes}分钟`
  }
  if (!minutes) {
    return `${restSeconds}秒`
  }
  return `${minutes}分${restSeconds}秒`
}
</script>
