<template>
  <el-card class="panel-card playback-panel" shadow="never">
    <template #header>
      <div class="panel-header">
        <div>
          <h2>播放控制</h2>
          <p>{{ isPlaying ? '任务正在执行' : '当前未播放' }}</p>
        </div>
        <el-tag :type="isPlaying ? 'success' : 'info'" round>
          {{ isPlaying ? '运行中' : '待命' }}
        </el-tag>
      </div>
    </template>

    <div class="control-grid">
      <el-button type="primary" :icon="VideoPlay" :disabled="disabled || isPlaying" @click="$emit('start')">
        当前账号
      </el-button>
      <el-button :icon="UserFilled" :disabled="disabled" @click="$emit('start-all')">
        全部开始
      </el-button>
      <el-button type="danger" :icon="VideoPause" :disabled="!isPlaying" @click="$emit('stop')">
        停止
      </el-button>
      <el-button type="warning" plain :icon="CircleCloseFilled" @click="$emit('stop-all')">
        全部停止
      </el-button>
    </div>
  </el-card>
</template>

<script setup>
import { CircleCloseFilled, UserFilled, VideoPause, VideoPlay } from '@element-plus/icons-vue'

defineProps({
  disabled: { type: Boolean, default: false },
  isPlaying: { type: Boolean, default: false }
})

defineEmits(['start', 'stop', 'start-all', 'stop-all'])
</script>
