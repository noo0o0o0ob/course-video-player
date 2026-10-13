<template>
  <section class="log-panel" aria-label="实时日志">
    <div class="panel-header log-header">
      <div>
        <h2>运行日志 <span class="section-count">{{ logs.length }}</span></h2>
      </div>
      <div class="log-actions">
        <el-button
          :type="autoScroll ? 'primary' : 'default'"
          :icon="Bottom"
          text
          :aria-pressed="autoScroll"
          :title="autoScroll ? '关闭自动滚动' : '开启自动滚动'"
          @click="toggleAutoScroll"
        >自动滚动</el-button>
        <el-button :icon="Delete" text title="清空日志" @click="$emit('clear')">清空</el-button>
      </div>
    </div>

    <div ref="container" class="log-viewport">
      <p v-if="!logs.length" class="log-empty">暂无记录，登录和播放的最新动态会显示在这里。</p>
      <div v-for="(log, index) in logs" :key="index" class="log-line" :data-level="log.level">
        <time>{{ log.time }}</time>
        <el-tag :type="levelType(log.level)" size="small" effect="light">
          {{ levelText(log.level) }}
        </el-tag>
        <span>{{ log.message }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { Bottom, Delete } from '@element-plus/icons-vue'
import { scrollLogToBottom } from '../utils/logScroll.mjs'

const props = defineProps({
  logs: { type: Array, default: () => [] },
  active: { type: Boolean, default: true }
})

defineEmits(['clear'])

const container = ref(null)
const autoScroll = ref(true)

function followLatestLog() {
  nextTick(() => {
    window.requestAnimationFrame(() => {
      scrollLogToBottom(container.value)
    })
  })
}

function toggleAutoScroll() {
  autoScroll.value = !autoScroll.value
  if (autoScroll.value) {
    followLatestLog()
  }
}

function levelText(level) {
  if (level === 'error') {
    return '错误'
  }
  if (level === 'warn' || level === 'warning') {
    return '警告'
  }
  return '信息'
}

function levelType(level) {
  if (level === 'error') {
    return 'danger'
  }
  if (level === 'warn' || level === 'warning') {
    return 'warning'
  }
  return 'info'
}

watch(
  () => props.logs.length,
  () => {
    if (autoScroll.value) {
      followLatestLog()
    }
  }
)

watch(
  () => props.active,
  (active) => {
    if (active && autoScroll.value) {
      followLatestLog()
    }
  },
  { immediate: true, flush: 'post' }
)

onMounted(() => {
  if (autoScroll.value) {
    followLatestLog()
  }
})
</script>
