<template>
  <section class="playback-panel" aria-label="播放控制">
      <div class="panel-header">
        <div>
          <h2>播放控制</h2>
        </div>
        <el-tag :type="isPlaying ? 'success' : 'info'" round>
          {{ isPlaying ? '运行中' : '待命' }}
        </el-tag>
      </div>

    <div class="control-grid">
      <el-button type="primary" :icon="VideoPlay" :disabled="disabled || isPlaying" @click="$emit('start')">
        开始播放
      </el-button>
      <el-button :icon="UserFilled" :disabled="disabled" @click="$emit('start-all')">
        全部账号开始
      </el-button>
      <el-button type="danger" :icon="VideoPause" :disabled="!isPlaying" @click="$emit('stop')">
        停止当前
      </el-button>
      <el-button type="warning" plain :icon="CircleCloseFilled" @click="$emit('stop-all')">
        全部账号停止
      </el-button>
    </div>
  </section>
</template>

<script setup>
import { CircleCloseFilled, UserFilled, VideoPause, VideoPlay } from '@element-plus/icons-vue'

defineProps({
  disabled: { type: Boolean, default: false },
  isPlaying: { type: Boolean, default: false }
})

defineEmits(['start', 'stop', 'start-all', 'stop-all'])
</script>
