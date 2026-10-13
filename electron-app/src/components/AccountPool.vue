<template>
  <el-card class="panel-card account-panel" shadow="never">
    <template #header>
      <div class="panel-header">
        <div>
          <h2>我的账号 <span class="section-count">{{ accounts.length }}</span></h2>
          <p>{{ accounts.length ? '点击账号，切换课程与任务' : '添加账号后，在这里切换' }}</p>
        </div>
        <el-button :icon="Refresh" text aria-label="刷新账号状态" title="刷新账号状态" @click="$emit('refresh')" />
      </div>
    </template>

    <div v-if="!accounts.length" class="empty-state account-empty">
      <el-icon :size="26"><User /></el-icon>
      <strong>先添加一个账号</strong>
      <p>在下方填写平台地址、账号和密码并登录。账号加入后即可读取课程，选择章节并启动任务。</p>
    </div>
    <div v-else class="account-scroll" role="group" aria-label="可用账号">
      <div
        v-for="account in accounts"
        :key="account.account_id"
        class="account-row"
        :class="{ active: account.account_id === selectedAccountId }"
      >
        <button class="account-select" type="button" :aria-pressed="account.account_id === selectedAccountId" @click="$emit('select', account.account_id)">
        <el-avatar :size="34">{{ shortName(account) }}</el-avatar>
        <div class="account-info">
          <strong :title="account.label || account.user?.name || account.username">{{ account.label || account.user?.name || account.username }}</strong>
          <small :title="account.platform_url">{{ account.username }}<span v-if="account.platform_url"> · {{ formatPlatform(account.platform_url) }}</span></small>
        </div>
        <el-tag :type="account.is_playing ? 'warning' : account.logged_in ? 'success' : 'info'" round>
          {{ account.is_playing ? '播放中' : account.logged_in ? '在线' : '离线' }}
        </el-tag>
        </button>
        <el-button
          :icon="Close"
          text
          type="danger"
          title="移除账号"
          :aria-label="`移除账号 ${account.label || account.user?.name || account.username}`"
          @click.stop="$emit('remove', account.account_id)"
        />
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { Close, Refresh, User } from '@element-plus/icons-vue'

defineProps({
  accounts: { type: Array, default: () => [] },
  selectedAccountId: { type: String, default: '' }
})

defineEmits(['refresh', 'select', 'remove'])

function shortName(account) {
  const name = account.label || account.user?.name || account.username || '?'
  return String(name).slice(0, 1).toUpperCase()
}

function formatPlatform(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.hostname
  } catch {
    return url
  }
}
</script>
