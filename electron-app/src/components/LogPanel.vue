<template>
  <section class="log-panel">
    <div class="panel-header log-header">
      <div>
        <h2>实时日志</h2>
        <p>{{ logs.length ? `${logs.length} 条记录` : '等待事件' }}</p>
      </div>
      <div class="log-actions">
        <el-button
          :type="autoScroll ? 'primary' : 'default'"
          :icon="Bottom"
          circle
          :title="autoScroll ? '关闭自动滚动' : '开启自动滚动'"
          @click="toggleAutoScroll"
        />
        <el-button :icon="Delete" circle title="清空日志" @click="$emit('clear')" />
      </div>
    </div>

    <div ref="container" class="log-viewport">
      <el-empty v-if="!logs.length" description="暂无运行日志" />
      <div v-for="(log, index) in logs" :key="index" class="log-line" :data-level="log.level">
        <time>{{ log.time }}</time>
        <el-tag :type="levelType(log.level)" size="small" effect="dark">
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
