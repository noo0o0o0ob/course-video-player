<template>
  <el-card class="panel-card login-panel" shadow="never">
    <template #header>
      <div class="panel-header">
        <div>
          <h2>账号登录</h2>
          <p>{{ session.logged_in ? '会话已建立' : '等待登录' }}</p>
        </div>
        <el-tag :type="session.logged_in ? 'success' : 'info'" round>
          {{ session.logged_in ? '在线' : '未登录' }}
        </el-tag>
      </div>
    </template>

    <el-form label-position="top" class="form-stack" @submit.prevent>
      <el-form-item label="学习平台URL" required>
        <el-input
          v-model.trim="platformUrl"
          placeholder="请输入学习平台URL，如 https://cqcst.suwankj.com"
          clearable
        />
      </el-form-item>

      <el-form-item label="学号">
        <el-input v-model.trim="username" autocomplete="username" placeholder="请输入学号" clearable />
      </el-form-item>

      <el-form-item label="密码">
        <el-input
          v-model="password"
          autocomplete="current-password"
          type="password"
          placeholder="请输入密码"
          show-password
        />
      </el-form-item>

      <el-form-item label="浏览器配置">
        <el-select v-model="selectedProfileId" placeholder="默认" class="full-control">
          <el-option label="默认" value="" />
          <el-option
            v-for="profile in profiles"
            :key="profile.profile_id"
            :label="profile.name + (profile.is_preset ? ' (预设)' : '')"
            :value="profile.profile_id"
          />
        </el-select>
      </el-form-item>

      <div class="form-options">
        <el-checkbox v-model="remember">记住密码</el-checkbox>
        <el-button text type="danger" :icon="Delete" @click="$emit('clear-credentials')">
          清除保存
        </el-button>
      </div>

      <el-button
        class="full-control"
        type="primary"
        :loading="loading"
        :disabled="!platformUrl || !username || !password"
        :icon="loading ? undefined : Key"
        @click="submit"
      >
        {{ loading ? '登录中' : session.logged_in ? '重新登录' : '登录' }}
      </el-button>
    </el-form>
  </el-card>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { Delete, Key } from '@element-plus/icons-vue'
import { getProfiles } from '../api/client'

defineProps({
  loading: { type: Boolean, default: false },
  session: { type: Object, default: () => ({ logged_in: false }) }
})

const emit = defineEmits(['login', 'save-credentials', 'clear-credentials'])

const platformUrl = ref('')
const username = ref('')
const password = ref('')
const remember = ref(true)
const profiles = ref([])
const selectedProfileId = ref('')

function submit() {
  emit('login', {
    platformUrl: platformUrl.value || null,
    username: username.value,
    password: password.value,
    remember: remember.value,
    profileId: selectedProfileId.value || null
  })
}

onMounted(async () => {
  const saved = await window.desktopAPI?.loadCredentials?.()
  if (saved) {
    platformUrl.value = saved.platformUrl || ''
    username.value = saved.username || ''
    password.value = saved.password || ''
  }
  try {
    const result = await getProfiles()
    profiles.value = result.profiles || []
  } catch {
    // Profiles are optional. The default browser configuration stays available.
  }
})
</script>
