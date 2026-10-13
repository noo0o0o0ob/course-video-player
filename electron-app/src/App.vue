<template>
  <div class="app-shell">
    <header class="app-titlebar">
      <div class="titlebar-brand" aria-label="课程视频自动播放">
        <img class="titlebar-mark" :src="productIconUrl" alt="" aria-hidden="true" />
        <strong>课程视频自动播放</strong>
        <span class="titlebar-divider" />
        <span class="titlebar-subtitle">课程工作台</span>
      </div>
      <div class="window-actions">
        <button type="button" class="about-button" @click="aboutVisible = true" aria-label="关于与版本">关于</button>
        <button type="button" aria-label="最小化" title="最小化" @click="minimizeWindow"><span class="minimize-glyph" /></button>
        <button type="button" class="window-close" aria-label="关闭" title="关闭" @click="closeWindow"><span>×</span></button>
      </div>
    </header>
    <main class="workbench" aria-label="课程工作区">
      <section class="work-column account-column" aria-label="账号与登录">
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
      </section>

      <section class="work-column course-column" aria-label="课程与章节">
        <CoursePanel
          :courses="courses"
          :chapters="chapters"
          :selected-course-id="selectedCourseId"
          :loading="courseLoading"
          :account-ready="session.logged_in"
          @refresh="loadCourses"
          @select-course="selectCourse"
        />
      </section>

      <section class="work-column activity-column" aria-label="播放与运行记录">
        <section class="task-surface" aria-label="当前播放任务">
          <div class="task-context">
            <el-icon class="task-icon" :size="22"><VideoPlay /></el-icon>
            <div class="task-copy">
              <span class="context-label">当前任务</span>
              <strong :title="selectedCourse?.name || '还未选择课程'">{{ selectedCourse?.name || '还未选择课程' }}</strong>
              <p :title="selectedAccount ? (selectedAccount.label || selectedAccount.user?.name || selectedAccount.username) : '还未选择账号'">
                {{ selectedAccount ? (selectedAccount.label || selectedAccount.user?.name || selectedAccount.username) : '还未选择账号' }}
              </p>
            </div>
          </div>
          <PlaybackControls
            :disabled="!selectedAccountId || !selectedCourseId || !session.logged_in"
            :is-playing="isPlaying"
            @start="handleStart"
            @start-all="handleStartAll"
            @stop="handleStop"
            @stop-all="handleStopAll"
          />
          <PlaybackProgress
            :status="playStatus"
            :total-progress="totalProgress"
            :current-video-progress="currentVideoProgress"
          />
          <p class="next-action" role="status">{{ nextActionText }}</p>
          <div class="watch-options">
            <el-switch v-model="fullAutoMode" active-text="全自动观看模式" aria-label="全自动观看模式" :disabled="accounts.some(account => account.is_playing)" @change="saveWatchSettings" />
            <el-button size="small" @click="settingsVisible = true">观看设置</el-button>
          </div>
        </section>

        <div class="support-toolbar">
          <el-button size="small" @click="summaryVisible = true">任务总结{{ taskSummaries.length ? ` (${taskSummaries.length})` : '' }}</el-button>
          <el-button size="small" @click="helpVisible = true">错误排查{{ latestIssue ? ' · 有错误' : '' }}</el-button>
        </div>

        <LogPanel :logs="logs" @clear="logs = []" />
      </section>
    </main>

    <WatchSettings v-model:visible="settingsVisible" :settings="numericWatchSettings" @change="updateWatchSettings" @reset="resetWatchSettings" />
    <TaskSummary v-model:visible="summaryVisible" :summaries="taskSummaries" :accounts="accounts" :retrying="summaryRetrying" @retry="retrySummary" />

    <el-dialog :model-value="Boolean(pendingConfirmation)" :title="pendingConfirmation?.title" width="min(540px, 92vw)" :close-on-click-modal="false" :before-close="cancelConfirmation" class="support-dialog">
      <template v-if="pendingConfirmation">
        <p>{{ pendingConfirmation.message }}</p>
        <ul class="confirmation-scope"><li v-for="item in pendingConfirmation.scope" :key="item">{{ item }}</li></ul>
        <p class="support-intro">{{ pendingConfirmation.detail }}</p>
      </template>
      <template #footer>
        <el-button @click="cancelConfirmation">取消</el-button>
        <el-button type="danger" @click="acceptConfirmation">{{ pendingConfirmation?.button }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="helpVisible" title="错误排查与诊断" width="min(600px, 92vw)" class="support-dialog">
      <section v-if="latestIssue" class="issue-notice" role="alert">
        <strong>{{ latestIssue.advice.title }}</strong>
        <p>{{ latestIssue.message }}</p><p>{{ latestIssue.advice.next }}</p>
        <el-button size="small" @click="performIssueAction(latestIssue.advice.action)">{{ latestIssue.advice.label }}</el-button>
      </section>
      <dl class="troubleshooting-list">
        <dt>登录失效</dt><dd>重新登录账号，读取课程后再启动任务。不要反复启动失效账号。</dd>
        <dt>连接超时或连接失败</dt><dd>检查网络和平台地址，恢复后刷新状态或重试；持续无法连接本地后端时重新启动应用。</dd>
        <dt>章节未完成或验证码失败</dt><dd>先查看任务总结，确认失败章节与账号。等待任务停止后重试，或调整观看设置。</dd>
      </dl>
      <p class="support-intro">诊断文件仅包含匿名账号状态、章节结果计数和错误分类。不导出原始日志、账号信息、密码、Cookie、Token、平台地址或个人信息。</p>
      <p v-if="diagnosticMessage" role="status">{{ diagnosticMessage }}</p>
      <template #footer><el-button type="primary" @click="exportDiagnostics">导出匿名诊断信息</el-button></template>
    </el-dialog>

    <el-dialog v-model="aboutVisible" title="关于课程视频自动播放" width="min(520px, 92vw)" class="support-dialog">
      <p>版本 {{ version }}</p><h3>当前版本更新内容</h3>
      <ul class="release-notes"><li v-for="change in appInfo.changes" :key="change">{{ change }}</li></ul>
      <p class="support-intro">本地课程管理与播放客户端。退出应用会结束本地后端，任务也会停止。</p>
      <el-button @click="openProject">打开项目仓库</el-button>
      <p class="project-link">{{ appInfo.projectUrl }}（私有仓库需访问权限）</p>
    </el-dialog>

    <el-dialog :model-value="Boolean(captchaFailures.length)" title="验证码识别错误" width="420px" :close-on-click-modal="false" :close-on-press-escape="false" :show-close="false">
      <p>{{ captchaFailureAccountName }}</p>
      <p>验证码识别错误，请手动点击重试</p>
      <p v-if="captchaRetryError" role="alert">{{ captchaRetryError }}</p>
      <template #footer>
        <el-button :disabled="captchaRetrying" @click="dismissCaptchaFailure">暂不重试</el-button>
        <el-button type="primary" :loading="captchaRetrying" @click="retryCaptchaFailure">重试</el-button>
      </template>
    </el-dialog>

    <footer class="status-bar" aria-label="应用状态">
      <div class="status-identity">
        <el-icon :size="16"><School /></el-icon>
        <strong>课程工作台</strong>
      </div>

      <div class="status-session" :class="{ running: isPlaying }" role="status">
        <i aria-hidden="true" />
        <span>{{ isPlaying ? '正在播放' : '已就绪' }}</span>
      </div>

      <div class="status-counts" aria-label="数据统计">
        <span><strong>{{ accounts.length }}</strong> 账号</span>
        <span><strong>{{ courses.length }}</strong> 课程</span>
        <span><strong>{{ chapters.length }}</strong> 章节</span>
      </div>

      <div class="status-selection" aria-label="当前选择">
        <span class="selection-label">账号</span>
        <strong :title="selectedAccount ? (selectedAccount.label || selectedAccount.user?.name || selectedAccount.username) : '未选择'">
          {{ selectedAccount ? (selectedAccount.label || selectedAccount.user?.name || selectedAccount.username) : '未选择' }}
        </strong>
        <i class="status-divider" aria-hidden="true" />
        <span class="selection-label">课程</span>
        <strong :title="selectedCourse?.name || '未选择'">{{ selectedCourse?.name || '未选择' }}</strong>
      </div>

      <label class="theme-toggle" title="切换深色模式">
        <span>深色</span>
        <input class="theme-input" type="checkbox" aria-label="切换深色模式" />
        <span class="theme-switch" aria-hidden="true" />
      </label>
    </footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { School, VideoPlay } from '@element-plus/icons-vue'
import AccountPool from './components/AccountPool.vue'
import LoginPanel from './components/LoginPanel.vue'
import CoursePanel from './components/CoursePanel.vue'
import PlaybackControls from './components/PlaybackControls.vue'
import PlaybackProgress from './components/PlaybackProgress.vue'
import LogPanel from './components/LogPanel.vue'
import WatchSettings from './components/WatchSettings.vue'
import TaskSummary from './components/TaskSummary.vue'
import { accountRunning, createDiagnostics, errorAdvice } from './utils/support.mjs'
import { appInfo } from './utils/appInfo.mjs'
import { defaultWatchSettings, normalizeWatchSettings } from './utils/watchSettings.mjs'
import { getEmptyCourseSelection } from './utils/courseSelection.mjs'
import productIconUrl from './assets/icon.png'
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
const accountNames = new Map()
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
const settingsVisible = ref(false)
const fullAutoMode = ref(false)
const numericWatchSettings = ref(defaultWatchSettings())
const captchaFailures = ref([])
const captchaRetrying = ref(false)
const captchaRetryError = ref('')
const aboutVisible = ref(false)
const version = ref(appInfo.version)
const helpVisible = ref(false)
const summaryVisible = ref(false)
const taskSummaries = ref([])
const summaryRetrying = ref('')
const latestIssue = ref(null)
const diagnosticMessage = ref('')
const pendingConfirmation = ref(null)
let confirmationResolve = null

function confirmOperation(details) {
  if (pendingConfirmation.value) return Promise.resolve(false)
  pendingConfirmation.value = details
  return new Promise(resolve => { confirmationResolve = resolve })
}
function finishConfirmation(accepted) {
  pendingConfirmation.value = null
  confirmationResolve?.(accepted)
  confirmationResolve = null
}
function cancelConfirmation() { finishConfirmation(false) }
function acceptConfirmation() { finishConfirmation(true) }
function accountName(account) { return account?.label || account?.user?.name || account?.username || '已移除账号' }

function recordSummary(accountId, summary) {
  if (!summary?.run_id) return
  const previous = taskSummaries.value.find(item => item.account_id === accountId)
  if (previous?.run_id === summary.run_id) return
  if (previous && (previous.finished_at || 0) > (summary.finished_at || 0)) return
  const account = accounts.value.find(item => item.account_id === accountId)
  const course = courses.value.find(item => item.course_id === summary.course_id)
  const item = { ...summary, account_id: accountId, account_name: account ? accountName(account) : accountNames.get(accountId) || previous?.account_name || '已移除账号', course_name: course?.name || summary.course_id }
  taskSummaries.value = [item, ...taskSummaries.value.filter(item => item.account_id !== accountId)]
}

async function retrySummary(item) {
  const account = accounts.value.find(a => a.account_id === item.account_id)
  if (!account?.logged_in || accountRunning(account) || !item.course_id) return
  summaryRetrying.value = item.account_id
  try {
    const result = await startAccountPlay(item.account_id, item.course_id, watchOptions())
    if (result.status === false) throw new Error(result.message || '任务未启动')
    addLog(result.message || '已重试未完成任务')
    await refreshAccounts()
  } catch (error) { addLog(`重试失败: ${error.message}`, 'error') }
  finally { summaryRetrying.value = '' }
}

async function performIssueAction(action) {
  if (action === 'settings') settingsVisible.value = true
  else if (action === 'login') {
    helpVisible.value = false
    document.querySelector('.login-panel input')?.focus()
  } else await refreshAccounts()
}

async function exportDiagnostics() {
  try {
    const data = createDiagnostics({ version: version.value, accounts: accounts.value, summaries: taskSummaries.value, logs: logs.value })
    if (window.desktopAPI?.saveDiagnostics) {
      const result = await window.desktopAPI.saveDiagnostics(data)
      diagnosticMessage.value = result.saved ? '匿名诊断文件已保存。' : '已取消保存诊断文件。'
      return
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `课程客户端-匿名诊断-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    diagnosticMessage.value = '已发起诊断文件下载，请确认浏览器下载完成。'
  } catch { diagnosticMessage.value = '导出失败，请检查下载目录权限后重试。' }
}

async function openProject() {
  try {
    if (window.desktopAPI?.openProject) await window.desktopAPI.openProject()
    else window.open(appInfo.projectUrl, '_blank', 'noopener,noreferrer')
  } catch { addLog('无法打开项目链接，请复制仓库地址到浏览器', 'warn') }
}

function minimizeWindow() { window.desktopAPI?.minimizeWindow?.() }
function closeWindow() { window.desktopAPI?.closeWindow?.() }

try {
  const saved = JSON.parse(localStorage.getItem('watch-settings') || '{}')
  fullAutoMode.value = saved.full_auto_mode === true
  numericWatchSettings.value = normalizeWatchSettings(saved)
} catch { /* 本地设置不可用时保留默认值。 */ }

function watchOptions() {
  return { full_auto_mode: fullAutoMode.value, ...numericWatchSettings.value }
}

function updateWatchSettings(settings) {
  numericWatchSettings.value = normalizeWatchSettings(settings)
  saveWatchSettings()
}

function resetWatchSettings() {
  fullAutoMode.value = false
  numericWatchSettings.value = defaultWatchSettings()
  saveWatchSettings()
}

function saveWatchSettings() {
  try { localStorage.setItem('watch-settings', JSON.stringify(watchOptions())) } catch {
    addLog('观看设置无法保存，下次启动将使用默认值', 'warn')
  }
}

const captchaFailureAccountName = computed(() => {
  const account = accounts.value.find(item => item.account_id === captchaFailures.value[0]?.account_id)
  return account?.label || account?.user?.name || account?.username || '播放任务已暂停'
})

function dismissCaptchaFailure() {
  captchaFailures.value.shift()
  captchaRetryError.value = ''
}

async function retryCaptchaFailure() {
  const failure = captchaFailures.value[0]
  if (!failure) return
  captchaRetrying.value = true
  captchaRetryError.value = ''
  try {
    const result = await startAccountPlay(failure.account_id, failure.course_id, watchOptions())
    if (result.status === false) throw new Error(result.message || '任务未启动')
    dismissCaptchaFailure()
    await refreshAccounts()
  } catch (error) {
    captchaRetryError.value = `重试失败：${error.message}`
  } finally {
    captchaRetrying.value = false
  }
}

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

const nextActionText = computed(() => {
  if (!selectedAccountId.value || !session.value.logged_in) {
    return '第 1 步：在左侧填写平台地址、账号和密码并登录；已有账号时选择在线账号。'
  }
  if (!courses.value.length) return '第 2 步：点击「读取课程」获取列表，再选择课程并检查章节。'
  if (!selectedCourseId.value) {
    return '第 2 步：选择要播放的课程，查看章节与已完成进度。'
  }
  if (isPlaying.value) {
    return '任务正在运行，可以查看进度或日志'
  }
  return '第 3 步：检查账号、课程与观看设置，点击「开始播放」。任务结束后查看「任务总结」。'
})

function addLog(message, level = 'info') {
  if (['error', 'warn', 'warning'].includes(level)) latestIssue.value = { message, advice: errorAdvice(message) }
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
  isPlaying.value = accountRunning(account)
  playStatus.value = status.status_text || status.message || (isPlaying.value ? '运行中' : '等待开始')
  currentVideoProgress.value = status.current_video_progress || 0
  totalProgress.value = status.total_progress || 0
}

function applyEvent(event) {
  if (event.type === 'task_summary' || event.task_summary) {
    recordSummary(event.account_id, event.summary || event.task_summary)
    if (event.type === 'task_summary') { void refreshAccounts(); return }
  }
  if (event.reason === 'captcha_retries_exhausted' && event.account_id && !captchaFailures.value.some(item => item.account_id === event.account_id)) {
    captchaFailures.value.push({ account_id: event.account_id, course_id: event.course_id })
  }
  const prefix = event.account_id ? `[账号 ${event.account_id.slice(0, 6)}] ` : ''
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
        logged_in: typeof event.logged_in === 'boolean' ? event.logged_in : event.reason === 'session_expired' ? false : current.logged_in,
        user: event.reason === 'session_expired' ? null : current.user,
        last_error: event.logged_in === true ? null : event.type === 'error' ? event.message : current.last_error,
        is_playing:
          typeof event.is_playing === 'boolean' ? event.is_playing : current.is_playing,
        status: nextStatus
      }
      if (event.type === 'session') {
        void refreshAccounts()
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

async function connectEvents() {
  window.clearTimeout(reconnectTimer)
  socketGeneration += 1
  const generation = socketGeneration
  if (socket) {
    socket.onclose = null
    socket.close()
  }
  try {
    const nextSocket = await createEventSocket(applyEvent, () => {
      if (generation !== socketGeneration) return
      reconnectTimer = window.setTimeout(connectEvents, 2500)
    })
    if (generation !== socketGeneration) {
      nextSocket.onclose = null
      nextSocket.close()
    } else {
      socket = nextSocket
    }
  } catch {
    if (generation === socketGeneration) reconnectTimer = window.setTimeout(connectEvents, 2500)
  }
}

async function refreshAccounts() {
  try {
    const result = await getAccounts()
    accounts.value = result.accounts || []
    for (const account of accounts.value) accountNames.set(account.account_id, accountName(account))
    for (const account of accounts.value) recordSummary(account.account_id, account.status?.task_summary)
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
    addLog('账号登录成功')
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
  const account = accounts.value.find(item => item.account_id === accountId)
  if (!await confirmOperation({ title: '确认移除账号', message: '仅移除以下账号的本地会话，并停止该账号正在运行的任务。', scope: [accountName(account)], detail: '平台账号与已确认的学习进度不会删除。重新使用需再次登录；本地加密保存的登录信息需通过「清除保存」单独清除。', button: '移除该账号' })) return
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
    const result = await startAccountPlay(selectedAccountId.value, selectedCourseId.value, watchOptions())
    if (result.status === false) throw new Error(result.message || '任务未启动')
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
    playStatus.value = '正在停止'
    addLog(result.message || '已发送停止指令')
    await refreshAccounts()
  } catch (error) {
    addLog(`停止失败: ${error.message}`, 'error')
  }
}

function recordBatchStartFailures(results, courseId) {
  for (const item of results || []) {
    if (item.status === false && !accountRunning(accounts.value.find(a => a.account_id === item.account_id))) recordSummary(item.account_id, { run_id: `start-${Date.now()}-${item.account_id}`, finished_at: Date.now() / 1000, course_id: courseId, outcome: 'failed', message: item.message || '启动失败', chapters: [], completed: 0, failed: 0 })
  }
}

async function handleStartAll() {
  if (!selectedCourseId.value || !accounts.value.length) return
  const courseId = selectedCourseId.value
  if (!await confirmOperation({ title: '确认全部账号开始', message: `将为账号池中的 ${accounts.value.length} 个账号尝试启动「${selectedCourse.value?.name || selectedCourseId.value}」。`, scope: accounts.value.map(account => `${accountName(account)} · ${accountRunning(account) ? '已有任务，不重复启动' : account.logged_in ? '将尝试启动' : '未登录，将跳过'}`), detail: '所有账号使用同一课程编号和当前观看设置；没有该课程或登录失效的账号会失败，结果列入任务总结。', button: '确认全部开始' })) return
  try {
    const result = await startAllAccountPlay(courseId, watchOptions())
    recordBatchStartFailures(result.results, courseId)
    if (result.status === false) throw new Error(result.message || '没有账号启动成功')
    addLog(result.message || '已批量启动播放任务')
    await refreshAccounts()
  } catch (error) {
    recordBatchStartFailures(error.results, courseId)
    addLog(`批量启动失败: ${error.message}`, 'error')
  }
}

async function handleStopAll() {
  const running = accounts.value.filter(accountRunning)
  if (!await confirmOperation({ title: '确认全部账号停止', message: `将向全部 ${accounts.value.length} 个账号发送停止指令，其中 ${running.length} 个账号仍有运行或正在停止的任务。`, scope: accounts.value.map(account => `${accountName(account)} · ${accountRunning(account) ? '将停止任务' : '无运行任务'}`), detail: '当前未完成章节会中断，已由平台确认的进度保留。停止需要等待正在执行的请求结束，可稍后重试未完成任务。', button: '确认全部停止' })) return
  try {
    const result = await stopAllAccountPlay()
    playStatus.value = '正在批量停止'
    addLog(result.message || '已发送全部停止指令')
    await refreshAccounts()
  } catch (error) {
    addLog(`批量停止失败: ${error.message}`, 'error')
  }
}

onMounted(async () => {
  if (window.desktopAPI?.getVersion) version.value = await window.desktopAPI.getVersion()
  await initApiBase()
  connectEvents()

  const saved = await window.desktopAPI?.loadCredentials?.()
  if (saved?.username && saved?.password) {
    addLog('已读取本地加密保存的账号信息')
  }

  await refreshAccounts()
})

onBeforeUnmount(() => {
  cancelConfirmation()
  window.clearTimeout(reconnectTimer)
  socketGeneration += 1
  if (socket) {
    socket.onclose = null
    socket.close()
    socket = null
  }
})
</script>
