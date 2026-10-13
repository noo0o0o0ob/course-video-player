<template>
  <el-card class="panel-card login-panel" shadow="never">
    <template #header>
      <div class="panel-header">
        <div>
          <h2>添加账号</h2>
          <p>登录后即可选择课程，支持多个账号</p>
        </div>
        <el-tag :type="session.logged_in ? 'success' : 'info'" round>
          {{ session.logged_in ? '在线' : '未登录' }}
        </el-tag>
      </div>
    </template>

    <el-form label-position="top" class="form-stack" @submit.prevent="submit">
      <div class="login-fields">
      <el-form-item label="学习平台地址" required>
        <el-input
          v-model.trim="platformUrl"
          placeholder="https://你的学习平台"
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

      </div>

      <div class="login-bottom">
      <div class="form-options">
        <el-checkbox v-model="remember">记住密码</el-checkbox>
        <el-button text type="danger" :icon="Delete" @click="$emit('clear-credentials')">
          清除保存
        </el-button>
      </div>

      <el-button
        type="primary"
        native-type="submit"
        :loading="loading"
        :disabled="!platformUrl || !username || !password"
        :icon="loading ? undefined : Key"
      >
        {{ loading ? '登录中' : '登录并添加' }}
      </el-button>
      </div>
    </el-form>
  </el-card>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { Delete, Key } from '@element-plus/icons-vue'
import { getProfiles } from '../api/client'

const props = defineProps({
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
  if (props.loading || !platformUrl.value || !username.value || !password.value) return
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
    // 配置为可选项，读取失败时仍可使用默认浏览器配置。
  }
})
</script>
