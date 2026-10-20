<template>
  <el-dialog :model-value="Boolean(status.forced)" title="需要更新才能继续使用" width="min(480px, 92vw)"
    :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false" :z-index="10000">
    <p>新版本 {{ status.version }} 已发布，当前版本已停止支持。请更新后继续使用。</p>
    <p role="status">{{ status.message }}</p>
    <el-progress v-if="status.status === 'downloading'" :percentage="status.percent || 0" />
    <p>下载完成后将自动安装并重启。更新失败时可重试或前往发布页下载。</p>
    <template #footer>
      <el-button @click="openRelease">前往发布页</el-button>
      <el-button v-if="status.status === 'downloaded'" type="primary" @click="$emit('install')">重启并安装</el-button>
      <el-button v-else type="primary" :loading="busy" :disabled="busy" @click="$emit('download')">{{ status.status === 'error' ? '重试更新' : '立即更新' }}</el-button>
    </template>
  </el-dialog>
  <aside v-if="showToast" class="update-toast" role="status" aria-label="发现新版本">
    <div><strong>有新版本 {{ status.version }}</strong><p>{{ status.message }}</p></div>
    <el-progress v-if="status.status === 'downloading'" :percentage="status.percent || 0" />
    <div class="update-toast-actions">
      <el-button size="small" @click="openRelease">前往发布页</el-button>
      <el-button v-if="status.status === 'downloaded'" size="small" type="primary" @click="$emit('install')">重启并安装</el-button>
      <el-button v-else size="small" type="primary" :loading="busy" :disabled="busy" @click="$emit('download')">{{ status.status === 'error' ? '重试更新' : '立即更新' }}</el-button>
      <el-button size="small" text @click="dismissed = status.version">稍后</el-button>
    </div>
  </aside>
</template>

<script setup>
import { computed, ref } from 'vue'
const props = defineProps({ status: { type: Object, required: true } })
defineEmits(['download', 'check', 'install'])
const dismissed = ref('')
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(props.status.status))
const showToast = computed(() => !props.status.forced && props.status.version && dismissed.value !== props.status.version && ['available', 'downloading', 'downloaded', 'error'].includes(props.status.status))
function openRelease() { void window.desktopAPI?.openReleasePage?.() }
</script>

<style scoped>
.update-toast { position: fixed; right: 24px; bottom: 52px; z-index: 9000; width: min(400px, calc(100vw - 48px)); padding: 20px; border: 1px solid var(--el-border-color); border-radius: 12px; background: var(--el-bg-color, white); color: var(--el-text-color-primary); box-shadow: 0 8px 32px #0002; }
.update-toast p { margin: 8px 0 16px; font-size: 13px; line-height: 1.6; }
.update-toast-actions { display: flex; justify-content: flex-end; gap: 8px; }
.update-toast-actions :deep(.el-button + .el-button) { margin-left: 0; }
</style>
