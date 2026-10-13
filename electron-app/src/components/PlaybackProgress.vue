<template>
  <section class="progress-panel" aria-label="播放进度">
      <div class="panel-header">
        <div>
          <h2>播放进度</h2>
          <p>{{ status }}</p>
        </div>
      </div>

    <div class="progress-stack" aria-label="播放进度">
      <div v-for="row in rows" :key="row.key" class="progress-row">
        <div class="progress-row-head">
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}%</strong>
        </div>
        <el-progress
          :percentage="row.value"
          :stroke-width="6"
          :show-text="false"
          :status="row.key === 'total' ? 'success' : undefined"
        />
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { buildProgressRows } from '../utils/progressRows.mjs'

const props = defineProps({
  status: { type: String, default: '等待开始' },
  totalProgress: { type: Number, default: 0 },
  currentVideoProgress: { type: Number, default: 0 }
})

const rows = computed(() => buildProgressRows(props.totalProgress, props.currentVideoProgress))
</script>
