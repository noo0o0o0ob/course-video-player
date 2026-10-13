<template>
  <el-card class="panel-card course-panel" shadow="never">
    <template #header>
      <div class="panel-header">
        <div>
          <h2>我的课程 <span class="section-count">{{ courses.length }}</span></h2>
          <p>{{ chapterSummary }}</p>
        </div>
        <el-button :icon="Refresh" :loading="loading" :disabled="!accountReady" @click="$emit('refresh')">读取课程</el-button>
      </div>
    </template>

    <div v-if="courses.length" class="course-picker">
      <el-input v-model="search" :prefix-icon="Search" placeholder="搜索课程" aria-label="搜索课程" clearable />
      <div class="course-options" role="group" aria-label="课程选择">
        <button v-for="course in filteredCourses" :key="course.course_id" type="button"
          class="course-option" :class="{ selected: course.course_id === selectedCourseId }"
          :aria-pressed="course.course_id === selectedCourseId" :title="course.name"
          @click="$emit('select-course', course.course_id)">
          <el-icon><Reading /></el-icon><span>{{ course.name }}</span>
          <el-icon v-if="course.course_id === selectedCourseId"><Check /></el-icon>
        </button>
        <p v-if="!filteredCourses.length" class="search-empty">没有找到匹配课程，试试其他关键词</p>
      </div>
    </div>

    <div class="chapter-heading"><span>课程章节</span><span>{{ completedCount }} / {{ chapters.length }} 已完成</span></div>
    <el-skeleton v-if="loading && !chapters.length" :rows="3" animated />
    <div v-else-if="!chapters.length" class="empty-state course-empty">
      <el-icon :size="28"><Reading /></el-icon>
      <strong>{{ accountReady ? courses.length ? '选择一门课程，查看章节' : '准备好你的课程' : '登录后，课程就从这里开始' }}</strong>
      <p>{{ accountReady ? courses.length ? '上方直接点击课程即可' : '点击「读取课程」获取课程列表' : '添加或选择在线账号，再读取课程' }}</p>
      <ol class="onboarding-steps" aria-label="首次使用步骤">
        <li :class="{ done: accountReady }"><strong>配置账号</strong><span>填写平台地址和账号密码，登录后选择在线账号。</span></li>
        <li :class="{ done: Boolean(selectedCourseId) }"><strong>读取课程</strong><span>点击「读取课程」，选择一门课程并检查章节进度。</span></li>
        <li><strong>启动任务</strong><span>确认观看设置，点击「开始播放」；结束后查看任务总结。</span></li>
      </ol>
      <p v-if="selectedCourseId">所选课程没有可播放章节，试试重新读取课程或选择其他课程。</p>
    </div>
    <div v-else class="chapter-scroll" aria-label="课程章节列表">
      <div
        v-for="(chapter, index) in chapters"
        :key="chapter.node_id"
        class="chapter-row"
        :data-state="stateKey(chapter.study_state)"
      >
        <span class="chapter-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <div class="chapter-main">
          <strong :title="chapter.name">{{ chapter.name }}</strong>
          <small>
            <el-tag :type="stateType(chapter.study_state)" size="small" round>
              {{ stateText(chapter.study_state) }}
            </el-tag>
            <span>节点 {{ chapter.node_id }}</span>
          </small>
        </div>
        <span class="chapter-duration">{{ formatDuration(chapter.duration) }}</span>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Check, Reading, Refresh, Search } from '@element-plus/icons-vue'

const props = defineProps({
  courses: { type: Array, default: () => [] },
  chapters: { type: Array, default: () => [] },
  selectedCourseId: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  accountReady: { type: Boolean, default: false }
})

defineEmits(['refresh', 'select-course'])

const search = ref('')
const filteredCourses = computed(() => props.courses.filter((course) =>
  String(course.name || '').toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())
))
watch(() => props.courses, () => { search.value = '' })

const completedCount = computed(() =>
  props.chapters.filter((chapter) => chapter.study_state === 2).length
)

const chapterSummary = computed(() => {
  if (!props.courses.length) {
    return props.accountReady ? '点击「读取课程」获取列表' : '先添加或选择在线账号'
  }
  if (!props.chapters.length) {
    return '直接点击课程，查看章节'
  }
  return `已完成 ${completedCount.value}/${props.chapters.length} 个章节`
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
