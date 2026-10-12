<template>
  <el-container class="app-shell">
    <el-header class="top-bar">
      <div class="brand-block">
        <el-icon class="brand-mark" :size="22">
          <School />
        </el-icon>
        <div class="brand-copy">
          <p class="eyebrow">授权测试工作台</p>
          <h1>课程视频播放控制台</h1>
        </div>
      </div>

      <div class="status-cluster" aria-label="当前任务状态">
        <div class="status-metric">
          <span>账号</span>
          <strong>{{ accounts.length }}</strong>
        </div>
        <div class="status-metric">
          <span>课程</span>
          <strong>{{ courses.length }}</strong>
        </div>
        <div class="status-metric">
          <span>节点</span>
          <strong>{{ chapters.length }}</strong>
        </div>
        <el-tag :type="isPlaying ? 'success' : 'info'" effect="dark" round>
          <el-icon><VideoPlay /></el-icon>
          {{ isPlaying ? '运行中' : '待命' }}
        </el-tag>
      </div>
    </el-header>

    <el-container class="workbench">
      <el-aside class="left-rail" width="360px">
        <AccountPool
          :accounts="accounts"
          :selected-account-id="selectedAccountId"
          @refresh="refreshAccounts"
          @select="selectAccount"
          @remove="removeSelectedAccount"
        />

        <LoginPanel
          :loading="loginLoading"
          :session="session"
          @login="handleLogin"
          @save-credentials="saveCredentials"
          @clear-credentials="clearCredentials"
        />
      </el-aside>

      <el-main class="main-surface">
        <el-card class="flow-card" shadow="never">
          <div class="flow-summary">
            <div>
              <p class="eyebrow">下一步</p>
              <h2>{{ canStartPlayback ? '可以开始播放' : '继续准备任务' }}</h2>
              <p>{{ nextActionText }}</p>
            </div>
            <el-button
              type="primary"
              :disabled="!canStartPlayback"
              :icon="VideoPlay"
              @click="handleStart"
            >
              当前账号开始
            </el-button>
          </div>

          <el-steps :active="activeStep" finish-status="success" align-center>
            <el-step
              v-for="step in flowSteps"
              :key="step.key"
              :title="step.title"
              :description="step.detail"
              :status="step.status"
            />
          </el-steps>
        </el-card>

        <CoursePanel
          :courses="courses"
          :chapters="chapters"
          :selected-course-id="selectedCourseId"
          :loading="courseLoading"
          @refresh="loadCourses"
          @select-course="selectCourse"
        />

        <el-row :gutter="16" class="task-grid">
          <el-col :xs="24" :md="12">
            <PlaybackControls
              :disabled="!selectedAccountId || !selectedCourseId || !session.logged_in"
              :is-playing="isPlaying"
              @start="handleStart"
              @start-all="handleStartAll"
              @stop="handleStop"
              @stop-all="handleStopAll"
            />
          </el-col>
          <el-col :xs="24" :md="12">
            <PlaybackProgress
              :status="playStatus"
              :total-progress="totalProgress"
              :current-video-progress="currentVideoProgress"
            />
          </el-col>
        </el-row>
      </el-main>
    </el-container>

    <el-button
      class="floating-log-button"
      type="primary"
      :icon="Document"
      round
      @click="logOpen = true"
    >
      日志
      <el-badge :value="logs.length" :max="99" type="info" />
    </el-button>

    <el-drawer
      v-model="logOpen"
      title="实时日志"
      direction="rtl"
      size="min(640px, 92vw)"
      class="log-drawer"
    >
      <LogPanel :logs="logs" :active="logOpen" @clear="logs = []" />
    </el-drawer>
  </el-container>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Document, School, VideoPlay } from '@element-plus/icons-vue'
import AccountPool from './components/AccountPool.vue'
import LoginPanel from './components/LoginPanel.vue'
import CoursePanel from './components/CoursePanel.vue'
import PlaybackControls from './components/PlaybackControls.vue'
import PlaybackProgress from './components/PlaybackProgress.vue'
import LogPanel from './components/LogPanel.vue'
import { getEmptyCourseSelection } from './utils/courseSelection.mjs'
import { displayAccountName } from './utils/logIdentity.mjs'
import {
  createEventSocket,
  getAccountChapters,
  getAccountCourseProgress,
  getAccountCourses,
  getAccounts,
  initApiBase,
  loginAccount,
  removeAccount,
  startAllAccountPlay,
  startAccountPlay,
  stopAllAccountPlay,
  stopAccountPlay
} from './api/client'

const accounts = ref([])
const courses = ref([])
const chapters = ref([])
const selectedAccountId = ref('')
const selectedCourseId = ref('')
const loginLoading = ref(false)
const courseLoading = ref(false)
const isPlaying = ref(false)
const playStatus = ref('等待开始')
const currentVideoProgress = ref(0)
const totalProgress = ref(0)
const logs = ref([])
const logOpen = ref(false)

let socket = null
let reconnectTimer = null
let socketGeneration = 0

const selectedAccount = computed(() =>
  accounts.value.find((account) => account.account_id === selectedAccountId.value) || null
)

const selectedCourse = computed(() =>
  courses.value.find((course) => course.course_id === selectedCourseId.value) || null
)

const session = computed(() => ({
  logged_in: Boolean(selectedAccount.value?.logged_in),
  username: selectedAccount.value?.username || null,
  user: selectedAccount.value?.user || null
}))

const canStartPlayback = computed(() =>
  Boolean(selectedAccountId.value && selectedCourseId.value && session.value.logged_in && !isPlaying.value)
)

const activeStep = computed(() => {
  if (isPlaying.value || canStartPlayback.value) {
    return 3
  }
  if (selectedCourseId.value) {
    return 2
  }
  if (selectedAccountId.value && session.value.logged_in) {
    return 1
  }
  return 0
})

const nextActionText = computed(() => {
  if (!selectedAccountId.value || !session.value.logged_in) {
    return '登录或选择一个在线账号'
  }
  if (!selectedCourseId.value) {
    return '选择要播放的课程'
  }
  if (isPlaying.value) {
    return '任务正在运行，可以查看进度或日志'
  }
  return '检查课程和账号后启动当前任务'
})

const flowSteps = computed(() => [
  {
    key: 'account',
    title: '账号',
    detail: selectedAccount.value?.user?.name || selectedAccount.value?.username || '未选择',
    status: selectedAccountId.value && session.value.logged_in ? 'success' : 'process'
  },
  {
    key: 'course',
    title: '课程',
    detail: selectedCourse.value?.name || (courses.value.length ? '请选择课程' : '等待课程列表'),
    status: selectedCourseId.value ? 'success' : selectedAccountId.value ? 'process' : 'wait'
  },
  {
    key: 'play',
    title: '播放',
    detail: isPlaying.value ? '运行中' : canStartPlayback.value ? '可启动' : '未就绪',
    status: isPlaying.value ? 'process' : canStartPlayback.value ? 'process' : 'wait'
  }
])

function addLog(message, level = 'info') {
  const lastLog = logs.value[logs.value.length - 1]
  if (lastLog?.message === message && lastLog?.level === level) {
    return
  }
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.value.push({ time, level, message })
}

function resetCourseSelection() {
  const nextState = getEmptyCourseSelection()
  selectedCourseId.value = nextState.selectedCourseId
  courses.value = nextState.courses
  chapters.value = nextState.chapters
  currentVideoProgress.value = nextState.currentVideoProgress
  totalProgress.value = nextState.totalProgress
}

function syncSelectedStatus() {
  const account = selectedAccount.value
  const status = account?.status || {}
  isPlaying.value = Boolean(account?.is_playing || status.is_playing)
  playStatus.value = status.status_text || status.message || (isPlaying.value ? '运行中' : '等待开始')
  currentVideoProgress.value = status.current_video_progress || 0
  totalProgress.value = status.total_progress || 0
}

function applyEvent(event) {
  const displayName = displayAccountName(event, accounts.value)
  const prefix = displayName ? `[${displayName}] ` : ''
  if (event.message) {
    addLog(`${prefix}${event.message}`, event.level || event.type || 'info')
  }

  if (event.account_id) {
    const index = accounts.value.findIndex((account) => account.account_id === event.account_id)
    if (index >= 0) {
      const current = accounts.value[index]
      const nextStatus = { ...(current.status || {}) }
      for (const key of [
        'is_playing',
        'is_stopping',
        'course_id',
        'current_node_id',
        'current_node_name',
        'current_index',
        'total_nodes',
        'current_video_progress',
        'total_progress',
        'message',
        'status_text'
      ]) {
        if (Object.prototype.hasOwnProperty.call(event, key)) {
          nextStatus[key] = event[key]
        }
      }
      accounts.value[index] = {
        ...current,
        is_playing:
          typeof event.is_playing === 'boolean' ? event.is_playing : current.is_playing,
        status: nextStatus
      }
    }
    if (event.account_id !== selectedAccountId.value) {
      return
    }
  }

  if (typeof event.is_playing === 'boolean') {
    isPlaying.value = event.is_playing
  }
  if (typeof event.current_video_progress === 'number') {
    currentVideoProgress.value = event.current_video_progress
  }
  if (typeof event.total_progress === 'number') {
    totalProgress.value = event.total_progress
  }
  if (event.status_text || event.message) {
    playStatus.value = event.status_text || event.message
  }
}

function applyCourseProgress(progress) {
  if (!progress || typeof progress !== 'object') {
    return
  }
  const nextProgress = Number(progress.progress)
  if (Number.isFinite(nextProgress)) {
    totalProgress.value = Math.max(0, Math.min(100, Math.round(nextProgress)))
  }
}

async function syncCourseProgress(courseId = selectedCourseId.value) {
  if (!selectedAccountId.value || !courseId) {
    return
  }
  try {
    const result = await getAccountCourseProgress(selectedAccountId.value, courseId)
    applyCourseProgress(result.progress)
    playStatus.value = '已同步课程进度'
  } catch (error) {
    addLog(`课程进度同步失败: ${error.message}`, 'warn')
  }
}

async function syncCourseData(courseId) {
  if (!courseId || !selectedAccountId.value) {
    return
  }

  try {
    const chaptersResult = await getAccountChapters(selectedAccountId.value, courseId)
    chapters.value = chaptersResult.chapters || []
    applyCourseProgress(chaptersResult.progress)
    playStatus.value = '已同步课程进度'
    const course = courses.value.find((item) => item.course_id === courseId)
    addLog(`已同步 ${course?.name || courseId}, 共 ${chapters.value.length} 个节点`)
  } catch (error) {
    addLog(`课程数据同步失败: ${error.message}`, 'error')
  }
}

function connectEvents() {
  window.clearTimeout(reconnectTimer)
  socketGeneration += 1
  const generation = socketGeneration
  if (socket) {
    socket.onclose = null
    socket.close()
  }
  socket = createEventSocket(applyEvent, () => {
    if (generation !== socketGeneration) {
      return
    }
    reconnectTimer = window.setTimeout(connectEvents, 2500)
  })
}

async function refreshAccounts() {
  try {
    const result = await getAccounts()
    accounts.value = result.accounts || []
    if (!selectedAccountId.value && accounts.value.length) {
      selectedAccountId.value = accounts.value[0].account_id
    }
    if (selectedAccountId.value && !accounts.value.some((item) => item.account_id === selectedAccountId.value)) {
      selectedAccountId.value = accounts.value[0]?.account_id || ''
      resetCourseSelection()
    }
    syncSelectedStatus()
  } catch (error) {
    addLog(`后端未就绪: ${error.message}`, 'warn')
  }
}

async function handleLogin(payload) {
  loginLoading.value = true
  try {
    const result = await loginAccount(payload.username, payload.password, '', payload.profileId, payload.platformUrl)
    if (payload.remember) {
      await saveCredentials(payload)
    }
    await refreshAccounts()
    selectedAccountId.value = result.account?.account_id || selectedAccountId.value
    resetCourseSelection()
    syncSelectedStatus()
    addLog(`账号 ${payload.username} 登录成功`)
  } catch (error) {
    addLog(`登录失败: ${error.message}`, 'error')
  } finally {
    loginLoading.value = false
  }
}

async function saveCredentials(payload) {
  await window.desktopAPI?.saveCredentials?.({
    platformUrl: payload.platformUrl,
    username: payload.username,
    password: payload.password
  })
}

async function clearCredentials() {
  await window.desktopAPI?.clearCredentials?.()
  addLog('已清除本地保存的账号信息')
}

async function selectAccount(accountId) {
  selectedAccountId.value = accountId
  resetCourseSelection()
  syncSelectedStatus()
}

async function removeSelectedAccount(accountId) {
  try {
    const result = await removeAccount(accountId)
    addLog(result.message || '账号已移除')
    await refreshAccounts()
  } catch (error) {
    addLog(`移除账号失败: ${error.message}`, 'error')
  }
}

async function loadCourses() {
  if (!selectedAccountId.value) {
    addLog('请先选择一个账号', 'warn')
    return
  }
  courseLoading.value = true
  try {
    const result = await getAccountCourses(selectedAccountId.value)
    courses.value = result.courses || []
    if (selectedCourseId.value && !courses.value.some((course) => course.course_id === selectedCourseId.value)) {
      selectedCourseId.value = ''
      chapters.value = []
      currentVideoProgress.value = 0
      totalProgress.value = 0
    }
    addLog(`已刷新课程列表, 共 ${courses.value.length} 门`)
  } catch (error) {
    addLog(`课程加载失败: ${error.message}`, 'error')
  } finally {
    courseLoading.value = false
  }
}

async function selectCourse(courseId) {
  selectedCourseId.value = courseId
  chapters.value = []
  currentVideoProgress.value = 0
  totalProgress.value = 0
  await syncCourseData(courseId)
}

async function handleStart() {
  try {
    const result = await startAccountPlay(selectedAccountId.value, selectedCourseId.value)
    isPlaying.value = true
    playStatus.value = '正在启动'
    addLog(result.message || '播放任务已启动')
    await refreshAccounts()
  } catch (error) {
    addLog(`启动失败: ${error.message}`, 'error')
  }
}

async function handleStop() {
  try {
    const result = await stopAccountPlay(selectedAccountId.value)
    isPlaying.value = false
    playStatus.value = '正在停止'
    addLog(result.message || '已发送停止指令')
    await refreshAccounts()
  } catch (error) {
    addLog(`停止失败: ${error.message}`, 'error')
  }
}

async function handleStartAll() {
  try {
    const result = await startAllAccountPlay(selectedCourseId.value)
    isPlaying.value = true
    playStatus.value = '正在批量启动'
    addLog(result.message || '已批量启动播放任务')
    await refreshAccounts()
  } catch (error) {
    addLog(`批量启动失败: ${error.message}`, 'error')
  }
}

async function handleStopAll() {
  try {
    const result = await stopAllAccountPlay()
    isPlaying.value = false
    playStatus.value = '正在批量停止'
    addLog(result.message || '已发送全部停止指令')
    await refreshAccounts()
  } catch (error) {
    addLog(`批量停止失败: ${error.message}`, 'error')
  }
}

onMounted(async () => {
  await initApiBase()
  connectEvents()

  const saved = await window.desktopAPI?.loadCredentials?.()
  if (saved?.username && saved?.password) {
    addLog('已读取本地加密保存的账号信息')
  }

  await refreshAccounts()
})

onBeforeUnmount(() => {
  window.clearTimeout(reconnectTimer)
  socketGeneration += 1
  if (socket) {
    socket.onclose = null
    socket.close()
    socket = null
  }
})
</script>
