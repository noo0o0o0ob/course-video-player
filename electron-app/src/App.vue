<template>
  <main v-if="!disclaimerAccepted" class="first-launch-shell" aria-labelledby="first-launch-title">
    <section class="first-launch-card">
      <header class="first-launch-header">
        <span class="about-mark"><el-icon :size="24"><School /></el-icon></span>
        <div><span class="about-eyebrow">首次启动 · 使用前请阅读</span><h1 id="first-launch-title">用户协议与免责声明</h1></div>
      </header>
      <div class="first-launch-copy"><DisclaimerContent /></div>
      <p class="first-launch-status" role="status">
        {{ disclaimerRemaining ? `请阅读以上内容，${disclaimerRemaining} 秒后可以同意并继续。` : '请确认你已阅读并理解以上免责声明。' }}
      </p>
      <p v-if="disclaimerError" class="first-launch-error" role="alert">{{ disclaimerError }}</p>
      <footer class="first-launch-actions">
        <el-button plain @click="declineDisclaimer">不同意并退出</el-button>
        <el-button type="primary" :disabled="disclaimerRemaining > 0" @click="acceptDisclaimer">同意并继续</el-button>
      </footer>
    </section>
  </main>
  <div v-else class="app-shell">
    <header class="app-titlebar">
      <div class="titlebar-brand" aria-label="课程视频自动播放">
        <img class="titlebar-mark" :src="productIconUrl" alt="" aria-hidden="true" />
        <strong>课程视频自动播放</strong>
        <span class="titlebar-divider" />
        <span class="titlebar-subtitle">课程工作台</span>
      </div>
      <div class="window-actions">
        <button type="button" class="about-button" @click="aboutVisible = true; loadUsageChart()" aria-label="关于与版本">关于</button>
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
          :chapter-loading="chapterLoading"
          :chapter-error="chapterError"
          :account-ready="session.logged_in"
          :watching-node-id="isPlaying && selectedAccount?.status?.course_id === selectedCourseId ? String(selectedAccount?.status?.current_node_id || '') : ''"
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
            :disabled="!playbackReady"
            :busy="courseBusy"
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
            <el-switch v-model="fullAutoMode" active-text="全自动观看模式" aria-label="全自动观看模式" :disabled="courseBusy || accounts.some(account => account.is_playing)" @change="saveWatchSettings" />
            <el-button size="small" :disabled="courseBusy" @click="settingsVisible = true">观看设置</el-button>
          </div>
        </section>

        <div class="support-toolbar">
          <el-button size="small" :disabled="courseBusy" @click="summaryVisible = true">任务总结{{ taskSummaries.length ? ` (${taskSummaries.length})` : '' }}</el-button>
          <el-button size="small" :disabled="courseBusy" @click="helpVisible = true">错误排查{{ latestIssue ? ' · 有错误' : '' }}</el-button>
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
        <el-button :type="pendingConfirmation?.buttonType || 'danger'" @click="acceptConfirmation">{{ pendingConfirmation?.button }}</el-button>
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

    <el-dialog v-model="aboutVisible" title="关于与更新" width="min(560px, 92vw)" class="support-dialog about-dialog">
      <div class="about-tabs" role="tablist" aria-label="关于与更新">
        <button id="about-tab" type="button" role="tab" :aria-selected="aboutTab === 'about'" aria-controls="about-panel" @click="aboutTab = 'about'; loadUsageChart()">关于</button>
        <button id="updates-tab" type="button" role="tab" :aria-selected="aboutTab === 'updates'" aria-controls="updates-panel" @click="aboutTab = 'updates'">更新内容</button>
        <button id="terms-tab" type="button" role="tab" :aria-selected="aboutTab === 'terms'" aria-controls="terms-panel" @click="aboutTab = 'terms'">协议与免责声明</button>
      </div>
      <section v-if="aboutTab === 'about'" id="about-panel" role="tabpanel" aria-labelledby="about-tab" class="about-content">
        <div class="about-heading"><span class="about-mark"><el-icon :size="24"><School /></el-icon></span><div><span class="about-eyebrow">课程工作台</span><h3>课程视频自动播放</h3></div></div>
        <p class="about-description">本地课程管理与播放客户端。退出应用会结束本地后端，任务也会停止。</p>
        <div class="about-meta">
          <div><span>作者</span><strong>uu</strong></div>
          <div><span>QQ</span><strong>2244422977</strong></div>
          <div><span>当前版本</span><strong>{{ version }}</strong></div>
          <div><span>开源许可证</span><strong>GPL-3.0-only</strong></div>
        </div>
        <section class="usage-stat-card" aria-labelledby="usage-stat-title">
          <div class="usage-stat-heading">
            <div><span class="about-eyebrow">匿名汇总 · 按日统计</span><h4 id="usage-stat-title">累计启动次数</h4></div>
            <strong class="usage-stat-total">{{ usageStats ? usageStats.total.toLocaleString('zh-CN') : '—' }}<small> 次</small></strong>
          </div>
          <p class="usage-stat-message" role="status" aria-live="polite">{{ usageChartMessage }}</p>
          <svg v-if="usageStats?.days?.length" class="usage-stat-chart" viewBox="0 0 540 180" role="img" :aria-label="`累计启动次数趋势，当前 ${usageStats.total} 次`">
            <line x1="20" y1="145" x2="520" y2="145" class="usage-chart-axis" />
            <polygon v-if="usageChartCoordinates.length > 1" :points="`20,145 ${usageChartPolyline} 520,145`" class="usage-chart-area" />
            <polyline v-if="usageChartCoordinates.length > 1" :points="usageChartPolyline" class="usage-chart-line" />
            <circle v-for="point in usageChartCoordinates" :key="point.date" :cx="point.x" :cy="point.y" r="3" class="usage-chart-point">
              <title>{{ point.date }}：累计 {{ point.value }} 次</title>
            </circle>
            <text :x="usageChartCoordinates.length === 1 ? 270 : 20" y="169" :text-anchor="usageChartCoordinates.length === 1 ? 'middle' : 'start'" class="usage-chart-label">{{ usageChartFirstDate }}</text>
            <text v-if="usageChartFirstDate !== usageChartLastDate" x="520" y="169" text-anchor="end" class="usage-chart-label">{{ usageChartLastDate }}</text>
          </svg>
          <svg v-else-if="usageChartAvailable" class="usage-stat-chart" viewBox="0 0 540 180" role="img" aria-label="累计启动次数趋势暂无记录">
            <line x1="20" y1="145" x2="520" y2="145" class="usage-chart-axis" />
            <line x1="20" y1="89" x2="520" y2="89" class="usage-chart-axis usage-chart-guide" />
            <text x="270" y="78" text-anchor="middle" class="usage-chart-empty-label">首次启动记录出现后显示趋势</text>
          </svg>
          <p class="usage-stat-note">每次启动计一次，不代表独立使用人数。</p>
        </section>
        <el-button class="project-button" @click="openProject">打开项目仓库</el-button>
      </section>
      <section v-else-if="aboutTab === 'updates'" id="updates-panel" role="tabpanel" aria-labelledby="updates-tab" class="updates-content">
        <div class="update-panel-heading">
          <div><span class="about-eyebrow">当前版本 {{ version }}</span><h3>软件更新</h3></div>
          <el-button :loading="updateStatus.status === 'checking'" :disabled="['checking', 'downloading', 'downloaded', 'installing'].includes(updateStatus.status)" @click="checkForUpdates">检查更新</el-button>
        </div>
        <div class="update-state" :data-state="updateStatus.status" role="status" aria-live="polite">
          <span class="update-state-dot" aria-hidden="true"></span>
          <p>{{ updateStatus.message }}</p>
        </div>
        <el-progress v-if="updateStatus.status === 'downloading'" :percentage="updateStatus.percent" :stroke-width="7" />
        <div class="update-actions">
          <el-button v-if="updateStatus.status === 'available'" type="primary" @click="downloadUpdate">下载 {{ updateStatus.version }} 更新</el-button>
          <el-button v-else-if="updateStatus.status === 'downloaded'" type="primary" @click="installUpdate">重启并安装</el-button>
        </div>
        <p class="update-footnote">更新包由 GitHub Releases 提供，优先下载差分数据；安装时应用会退出并重启。</p>
        <h4 class="release-notes-heading">当前版本内容</h4>
        <ul class="release-notes"><li v-for="change in appInfo.changes" :key="change">{{ change }}</li></ul>
      </section>
      <section v-else id="terms-panel" role="tabpanel" aria-labelledby="terms-tab" class="agreement-scroll">
        <article class="agreement-section">
          <span class="about-eyebrow">使用前请阅读</span><h3>用户协议</h3>
          <p>本应用是供个人学习和课程管理使用的本地客户端，不提供课程内容或学习平台账号。</p>
          <h4>使用范围</h4>
          <p>请仅使用本人拥有或获准使用的账号，并遵守学习平台规则、学校要求及适用法律。不得冒用他人身份、绕过访问控制或干扰平台正常运行。</p>
          <h4>账号与设备</h4>
          <p>登录信息会发送到你填写的学习平台地址以完成登录。选择记住密码时，应用会通过本机的安全存储保存凭据。请妥善保管设备和账号，不要在公用设备上保存密码。</p>
          <h4>观看任务</h4>
          <p>开始任务前请核对账号、课程和观看设置，并留意任务状态。退出应用会停止本地后端，正在执行的任务也会结束。</p>
          <h4>匿名启动次数统计</h4>
          <p>接受协议即启用每次启动一次的匿名统计，没有单独开关；不同意请勿使用并选择退出。统计指标是启动次数，不是人数。</p>
          <h4>协议确认</h4>
          <p>使用前请阅读本协议与下方免责声明。若不同意其中所述的使用范围，请勿使用本应用。</p>
        </article>
        <article class="agreement-section">
          <span class="about-eyebrow">使用边界</span><h3>免责声明</h3>
          <DisclaimerContent />
        </article>
      </section>
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
  <UpdateNotice :status="updateStatus" @download="downloadUpdate" @check="checkForUpdates" @install="installUpdate" />
  <el-dialog :model-value="Boolean(closeConfirmation)" :title="closeConfirmation?.title" width="min(480px, 92vw)" :close-on-click-modal="false" :close-on-press-escape="false" :before-close="cancelCloseConfirmation" class="support-dialog close-confirm-dialog">
    <div v-if="closeConfirmation" class="close-confirm-content">
      <span class="close-confirm-icon" :class="`is-${closeConfirmation.kind}`" aria-hidden="true"><el-icon><InfoFilled /></el-icon></span>
      <div class="close-confirm-copy">
        <p class="close-confirm-message">{{ closeConfirmation.message }}</p>
        <p v-if="closeConfirmation.accounts?.length" class="close-confirm-accounts">影响账号：{{ closeConfirmation.accounts.join('、') }}</p>
        <p class="support-intro">{{ closeConfirmation.detail }}</p>
      </div>
    </div>
    <el-checkbox v-if="closeConfirmation?.kind === 'idle'" v-model="rememberCloseChoice" class="remember-close-choice">记住我的选择</el-checkbox>
    <template #footer>
      <el-button v-if="closeConfirmation?.kind !== 'error'" @click="cancelCloseConfirmation">{{ closeConfirmation?.kind === 'running' ? '取消，继续运行' : '取消' }}</el-button>
      <el-button :type="closeConfirmation?.kind === 'error' ? 'primary' : 'danger'" @click="confirmCloseApplication">{{ closeConfirmation?.closeLabel || '关闭软件' }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { InfoFilled, School, VideoPlay } from '@element-plus/icons-vue'
import UpdateNotice from './components/UpdateNotice.vue'
import AccountPool from './components/AccountPool.vue'
import LoginPanel from './components/LoginPanel.vue'
import CoursePanel from './components/CoursePanel.vue'
import PlaybackControls from './components/PlaybackControls.vue'
import PlaybackProgress from './components/PlaybackProgress.vue'
import LogPanel from './components/LogPanel.vue'
import WatchSettings from './components/WatchSettings.vue'
import TaskSummary from './components/TaskSummary.vue'
import DisclaimerContent from './components/DisclaimerContent.vue'
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
const chapterLoading = ref(false)
const chapterReady = ref(false)
const chapterError = ref('')
const courseBusy = computed(() => courseLoading.value || chapterLoading.value)
let courseListRequestId = 0
let courseDetailRequestId = 0
let courseProgressRequestId = 0
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
const aboutTab = ref('about')
const version = ref(appInfo.version)
const updateStatus = ref({ status: 'idle', message: '点击“检查更新”获取最新版本信息。', version: '', percent: 0 })
const helpVisible = ref(false)
const summaryVisible = ref(false)
const taskSummaries = ref([])
const summaryRetrying = ref('')
const latestIssue = ref(null)
const diagnosticMessage = ref('')
const pendingConfirmation = ref(null)
const closeConfirmation = ref(null)
const rememberCloseChoice = ref(false)
const DISCLAIMER_ACCEPTED_KEY = 'course-player-disclaimer-accepted-v2'
const disclaimerAccepted = ref(readDisclaimerAcceptance())
const disclaimerRemaining = ref(5)
const disclaimerError = ref('')
const usageStats = ref(null)
const usageChartAvailable = ref(false)
const usageChartMessage = ref('打开“关于”时读取公开汇总数据。')
let disclaimerTimer = null
let removeCloseConfirmationListener = null
let removeUpdateStatusListener = null
let applicationInitialized = false
let confirmationResolve = null

function readDisclaimerAcceptance() {
  try { return localStorage.getItem(DISCLAIMER_ACCEPTED_KEY) === 'accepted' } catch { return false }
}

function acceptDisclaimer() {
  if (disclaimerRemaining.value > 0) return
  try {
    localStorage.setItem(DISCLAIMER_ACCEPTED_KEY, 'accepted')
  } catch {
    disclaimerError.value = '无法保存同意状态，请检查本机存储权限后重试。'
    return
  }
  disclaimerAccepted.value = true
  disclaimerError.value = ''
  void initializeApplication()
}

const usageChartCoordinates = computed(() => {
  const days = usageStats.value?.days || []
  if (!days.length) return []
  const maximum = Math.max(1, ...days.map(day => Number(day.cumulative) || 0))
  return days.map((day, index) => ({
    date: day.date,
    value: Number(day.cumulative) || 0,
    x: days.length === 1 ? 270 : 20 + index * 500 / (days.length - 1),
    y: 145 - ((Number(day.cumulative) || 0) / maximum) * 112
  }))
})
const usageChartPolyline = computed(() => usageChartCoordinates.value.map(point => `${point.x},${point.y}`).join(' '))
const usageChartFirstDate = computed(() => usageChartCoordinates.value[0]?.date || '')
const usageChartLastDate = computed(() => usageChartCoordinates.value.at(-1)?.date || '')

async function loadUsageChart() {
  let readChart = window.desktopAPI?.getUsageChart
  if (!readChart && import.meta.env.DEV) {
    readChart = async () => {
      const response = await fetch('https://download.meetuu.top/api/usage/chart', { cache: 'no-store' })
      if (!response.ok) throw new Error('statistics unavailable')
      return response.json()
    }
  }
  if (!readChart) {
    usageStats.value = null
    usageChartAvailable.value = false
    usageChartMessage.value = '请在桌面客户端中查看统计图表。'
    return
  }
  usageChartMessage.value = '正在读取统计数据…'
  try {
    const result = await readChart()
    if (!result || !Number.isFinite(result.total) || !Array.isArray(result.days)) throw new Error('invalid chart')
    usageStats.value = result
    usageChartAvailable.value = true
    usageChartMessage.value = result.days.length ? '按日期汇总，读取时更新。' : '目前还没有启动记录。'
  } catch {
    usageStats.value = null
    usageChartAvailable.value = false
    usageChartMessage.value = '暂时无法读取统计数据，请稍后再试。'
  }
}

function declineDisclaimer() {
  if (window.desktopAPI?.exitApplication) {
    window.desktopAPI.exitApplication()
    return
  }
  disclaimerError.value = '当前是网页预览，无法由页面关闭应用窗口；请关闭此预览退出。'
}

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

async function checkForUpdates() {
  if (!window.desktopAPI?.checkForUpdates) {
    updateStatus.value = { status: 'unavailable', message: '当前预览环境无法检查更新。', version: '', percent: 0 }
    return
  }
  updateStatus.value = { ...updateStatus.value, status: 'checking', message: '正在检查更新…', percent: 0 }
  try {
    updateStatus.value = { ...updateStatus.value, ...await window.desktopAPI.checkForUpdates() }
  } catch {
    updateStatus.value = { ...updateStatus.value, status: 'error', message: '暂时无法检查更新，请稍后重试。' }
  }
}

async function downloadUpdate() {
  updateStatus.value = { ...updateStatus.value, status: 'downloading', percent: 0, message: '正在准备下载…' }
  try {
    const result = await window.desktopAPI?.downloadUpdate?.()
    if (result) updateStatus.value = { ...updateStatus.value, ...result }
    if (result?.status === 'downloaded' && updateStatus.value.forced) await window.desktopAPI?.installUpdate?.()
  } catch {
    updateStatus.value = { ...updateStatus.value, status: 'error', message: '更新下载失败，请检查网络后重试。' }
  }
}

async function installUpdate() {
  if (updateStatus.value.forced) {
    await window.desktopAPI?.installUpdate?.()
    return
  }
  const runningCount = accounts.value.filter(accountRunning).length
  const confirmed = await confirmOperation({
    title: '准备安装更新',
    message: '应用将退出并重启以完成安装。',
    scope: [`当前版本：${version.value}`, `新版本：${updateStatus.value.version || '更新版本'}`],
    detail: runningCount ? `当前有 ${runningCount} 个账号任务运行中。重启会结束这些任务，未确认的进度可能丢失。` : '本地任务会随应用退出而停止。',
    button: '重启并安装更新',
    buttonType: 'primary'
  })
  if (!confirmed) return
  updateStatus.value = { ...updateStatus.value, status: 'installing', message: '正在重启并安装更新…' }
  await window.desktopAPI?.installUpdate?.()
}

function minimizeWindow() { window.desktopAPI?.minimizeWindow?.() }
function closeWindow() { window.desktopAPI?.closeWindow?.() }

function cancelCloseConfirmation() {
  if (!closeConfirmation.value) return
  closeConfirmation.value = null
  window.desktopAPI?.respondToClose?.({ close: false, remember: false })
}
function confirmCloseApplication() {
  const confirmation = closeConfirmation.value
  if (!confirmation) return
  closeConfirmation.value = null
  window.desktopAPI?.respondToClose?.({
    close: confirmation.kind !== 'error',
    remember: confirmation.kind === 'idle' && rememberCloseChoice.value
  })
  rememberCloseChoice.value = false
}

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

const playbackReady = computed(() => !courseBusy.value && chapterReady.value && Boolean(selectedAccountId.value && selectedCourseId.value && session.value.logged_in))

const nextActionText = computed(() => {
  if (chapterLoading.value) return '加载中，正在同步课程节点，请等待完成后再操作。'
  if (courseLoading.value) return '加载中，正在读取课程列表，请稍候。'
  if (chapterError.value) return '课程节点加载失败，请重新点击所选课程重试。'
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
  courseListRequestId += 1
  courseDetailRequestId += 1
  courseProgressRequestId += 1
  courseLoading.value = false
  chapterLoading.value = false
  chapterReady.value = false
  chapterError.value = ''
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
  applyCourseProgress({ progress: status.total_progress || 0 })
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
    const status = selectedAccount.value?.status || {}
    const courseId = event.course_id || status.course_id
    const nodeId = event.current_node_id || event.node_id || status.current_node_id
    if (courseId === selectedCourseId.value && nodeId) {
      // 后端仅在平台确认完成后发出 100%，切换节点本身不表示完成。
      const completed = event.current_video_progress === 100
      const watching = isPlaying.value && !event.is_stopping
      if (completed || watching) {
        chapters.value = chapters.value.map(chapter => String(chapter.node_id) === String(nodeId)
          ? { ...chapter, locked: false, study_state: completed ? 2 : chapter.study_state === 2 ? 2 : 1 }
          : chapter)
      }
    }
  }
  if (typeof event.total_progress === 'number') {
    applyCourseProgress({ progress: event.total_progress })
  }
  if (event.status_text || event.message) {
    playStatus.value = event.status_text || event.message
  }
}

function applyCourseProgress(progress) {
  if (courses.value.some((course) => course.course_id === selectedCourseId.value && course.kind === 'finish')) {
    totalProgress.value = 100
    return
  }
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
  const accountId = selectedAccountId.value
  const requestId = ++courseProgressRequestId
  const isCurrent = () => requestId === courseProgressRequestId && accountId === selectedAccountId.value && courseId === selectedCourseId.value
  try {
    const result = await getAccountCourseProgress(accountId, courseId)
    if (!isCurrent()) return
    applyCourseProgress(result.progress)
    playStatus.value = '已同步课程进度'
  } catch (error) {
    if (!isCurrent()) return
    addLog(`课程进度同步失败: ${error.message}`, 'warn')
  }
}

async function syncCourseData(courseId) {
  if (!courseId || !selectedAccountId.value) {
    return
  }

  const accountId = selectedAccountId.value
  const requestId = ++courseDetailRequestId
  const isCurrent = () => requestId === courseDetailRequestId && accountId === selectedAccountId.value && courseId === selectedCourseId.value
  chapterLoading.value = true
  chapterReady.value = false
  chapterError.value = ''
  playStatus.value = '正在同步课程节点'
  try {
    const chaptersResult = await getAccountChapters(accountId, courseId)
    if (!isCurrent()) return
    const course = courses.value.find((item) => item.course_id === courseId)
    chapters.value = (chaptersResult.chapters || []).map((chapter) => course?.kind === 'finish' ? { ...chapter, study_state: 2 } : chapter)
    applyCourseProgress(chaptersResult.progress)
    chapterReady.value = true
    playStatus.value = '已同步课程进度'
    addLog(`已同步 ${course?.name || courseId}, 共 ${chapters.value.length} 个节点`)
  } catch (error) {
    if (!isCurrent()) return
    chapterError.value = error.message
    playStatus.value = '课程节点加载失败'
    addLog(`课程数据同步失败: ${error.message}`, 'error')
  } finally {
    if (isCurrent()) chapterLoading.value = false
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
  const confirmed = await confirmOperation({
    title: '确认登录吗',
    message: '即将使用以下平台地址登录并添加账号：',
    scope: [payload.platformUrl],
    detail: '最好不要在同一台设备上同时登录学习网站和播放器。若要查看网页，请先结束观看后再进入。',
    button: '确认登录',
    buttonType: 'primary'
  })
  if (!confirmed) return

  loginLoading.value = true
  try {
    const result = await loginAccount(payload.username, payload.password, '', payload.profileId, payload.platformUrl)
    if (payload.remember) {
      try {
        await saveCredentials(payload)
      } catch {
        addLog('账号已登录，但登录信息未保存。请检查本机加密存储或磁盘权限，下次启动需重新填写。', 'warn')
      }
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
  const result = await window.desktopAPI?.saveCredentials?.({
    platformUrl: payload.platformUrl,
    username: payload.username,
    password: payload.password
  })
  if (result?.status === false) throw new Error('登录信息未保存')
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
  if (chapterLoading.value) return
  if (!selectedAccountId.value) {
    addLog('请先选择一个账号', 'warn')
    return
  }
  const accountId = selectedAccountId.value
  const requestId = ++courseListRequestId
  const isCurrent = () => requestId === courseListRequestId && accountId === selectedAccountId.value
  courseLoading.value = true
  try {
    const result = await getAccountCourses(accountId)
    if (!isCurrent()) return
    courses.value = result.courses || []
    if (selectedCourseId.value && !courses.value.some((course) => course.course_id === selectedCourseId.value)) {
      courseDetailRequestId += 1
      courseProgressRequestId += 1
      selectedCourseId.value = ''
      chapters.value = []
      chapterReady.value = false
      chapterError.value = ''
      currentVideoProgress.value = 0
      totalProgress.value = 0
    }
    if (courses.value.some((course) => course.course_id === selectedCourseId.value && course.kind === 'finish')) {
      chapters.value = chapters.value.map((chapter) => ({ ...chapter, study_state: 2 }))
      applyCourseProgress()
    }
    addLog(`已刷新课程列表, 共 ${courses.value.length} 门`)
  } catch (error) {
    if (!isCurrent()) return
    addLog(`课程加载失败: ${error.message}`, 'error')
  } finally {
    if (isCurrent()) courseLoading.value = false
  }
}

async function selectCourse(courseId) {
  if (courseBusy.value) return
  courseDetailRequestId += 1
  courseProgressRequestId += 1
  selectedCourseId.value = courseId
  chapters.value = []
  currentVideoProgress.value = 0
  totalProgress.value = 0
  applyCourseProgress()
  await syncCourseData(courseId)
}

async function handleStart() {
  if (!playbackReady.value) return
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
  if (courseBusy.value) return
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
  if (!playbackReady.value) return
  if (!selectedCourseId.value || !accounts.value.length) return
  const courseId = selectedCourseId.value
  if (!await confirmOperation({ title: '确认全部账号开始', message: `将为账号池中的 ${accounts.value.length} 个账号尝试启动「${selectedCourse.value?.name || selectedCourseId.value}」。`, scope: accounts.value.map(account => `${accountName(account)} · ${accountRunning(account) ? '已有任务，不重复启动' : account.logged_in ? '将尝试启动' : '未登录，将跳过'}`), detail: '所有账号使用同一课程编号和当前观看设置；没有该课程或登录失效的账号会失败，结果列入任务总结。', button: '确认全部开始' })) return
  try {
    if (!playbackReady.value || courseId !== selectedCourseId.value) return
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
  if (courseBusy.value) return
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

async function initializeApplication() {
  if (applicationInitialized) return
  applicationInitialized = true
  void window.desktopAPI?.recordUsageLaunch?.()
  if (window.desktopAPI?.getVersion) version.value = await window.desktopAPI.getVersion()
  await initApiBase()
  connectEvents()

  const saved = await window.desktopAPI?.loadCredentials?.()
  if (saved?.username && saved?.password) {
    addLog('已读取本地加密保存的账号信息')
  }

  await refreshAccounts()
}

onMounted(() => {
  void checkForUpdates()
  removeUpdateStatusListener = window.desktopAPI?.onUpdateStatus?.(status => {
    updateStatus.value = { ...updateStatus.value, ...status }
  }) || null
  removeCloseConfirmationListener = window.desktopAPI?.onCloseConfirmation?.(details => {
    closeConfirmation.value = details
    rememberCloseChoice.value = false
  }) || null
  if (disclaimerAccepted.value) {
    void initializeApplication()
    return
  }
  disclaimerTimer = window.setInterval(() => {
    disclaimerRemaining.value = Math.max(0, disclaimerRemaining.value - 1)
    if (!disclaimerRemaining.value) {
      window.clearInterval(disclaimerTimer)
      disclaimerTimer = null
    }
  }, 1000)
})

onBeforeUnmount(() => {
  courseListRequestId += 1
  courseDetailRequestId += 1
  courseProgressRequestId += 1
  removeCloseConfirmationListener?.()
  removeUpdateStatusListener?.()
  if (disclaimerTimer) window.clearInterval(disclaimerTimer)
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
