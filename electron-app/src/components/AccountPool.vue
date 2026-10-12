<template>
  <el-card class="panel-card account-panel" shadow="never">
    <template #header>
      <div class="panel-header">
        <div>
          <h2>账号池</h2>
          <p>{{ accounts.length ? `${accounts.length} 个账号` : '登录后加入账号池' }}</p>
        </div>
        <el-button :icon="Refresh" circle title="刷新账号状态" @click="$emit('refresh')" />
      </div>
    </template>

    <el-empty v-if="!accounts.length" description="暂无账号" />
    <el-scrollbar v-else class="account-scroll">
      <div
        v-for="account in accounts"
        :key="account.account_id"
        class="account-row"
        :class="{ active: account.account_id === selectedAccountId }"
        role="button"
        tabindex="0"
        @click="$emit('select', account.account_id)"
        @keyup.enter="$emit('select', account.account_id)"
      >
        <el-avatar :size="34">{{ shortName(account) }}</el-avatar>
        <div class="account-info">
          <strong>{{ account.label || account.user?.name || account.username }}</strong>
          <small>{{ account.username }}</small>
          <small class="platform-url">{{ formatPlatform(account.platform_url) }}</small>
        </div>
        <el-tag :type="account.is_playing ? 'warning' : account.logged_in ? 'success' : 'info'" round>
          {{ account.is_playing ? '播放中' : account.logged_in ? '在线' : '离线' }}
        </el-tag>
        <el-button
          :icon="Close"
          text
          type="danger"
          title="移除账号"
          @click.stop="$emit('remove', account.account_id)"
        />
      </div>
    </el-scrollbar>
  </el-card>
</template>

<script setup>
import { Close, Refresh } from '@element-plus/icons-vue'

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
