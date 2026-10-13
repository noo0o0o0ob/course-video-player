<template>
  <el-dialog v-model="visible" title="任务结束总结" width="min(760px, 92vw)" class="support-dialog">
    <p class="support-intro">保留本次应用运行期间各账号最近一次结果。重试会重新读取平台进度，跳过已确认完成的章节；未完成和未执行章节会继续执行。</p>
    <p v-if="!summaries.length" class="support-intro">还没有任务结果。先配置账号、读取并选择课程，再启动任务。</p>
    <div class="support-scroll">
      <section v-for="item in summaries" :key="item.account_id" class="summary-account">
        <div class="panel-header">
          <strong>{{ item.account_name || '已移除账号' }} · {{ item.course_name || item.course_id }}</strong>
          <el-tag :type="item.outcome === 'success' ? 'success' : item.outcome === 'stopped' ? 'info' : 'danger'">{{ outcomeText(item.outcome) }}</el-tag>
        </div>
        <p>{{ item.message }} · 成功 {{ item.completed || 0 }} / 失败 {{ item.failed || 0 }} / 共 {{ item.chapters?.length || 0 }} 章</p>
        <ul class="summary-chapters">
          <li v-for="chapter in item.chapters" :key="chapter.node_id">
            <strong>{{ chapter.name }}</strong><span>{{ outcomeText(chapter.outcome) }} · {{ chapter.message }}</span>
          </li>
        </ul>
        <p v-if="item.outcome !== 'success'">{{ errorAdvice(item.message, item.reason).next }}</p>
        <el-button v-if="item.outcome !== 'success'" size="small" :disabled="!canRetry(item) || retrying === item.account_id" :loading="retrying === item.account_id" @click="$emit('retry', item)">重试未完成任务</el-button>
        <small v-if="item.outcome !== 'success' && !canRetry(item)">需先等待当前任务停止，并确认原账号在线；已移除或登录失效时，请重新登录后从课程面板启动。</small>
      </section>
    </div>
  </el-dialog>
</template>

<script setup>
import { accountRunning, errorAdvice } from '../utils/support.mjs'
const visible = defineModel('visible', { type: Boolean })
const props = defineProps({ summaries: { type: Array, default: () => [] }, accounts: { type: Array, default: () => [] }, retrying: { type: String, default: '' } })
defineEmits(['retry'])
function canRetry(item) {
  const account = props.accounts.find(a => a.account_id === item.account_id)
  return Boolean(account?.logged_in && !accountRunning(account) && item.course_id)
}
function outcomeText(outcome) { return ({ success: '成功', failed: '失败', stopped: '已停止', not_run: '未执行' })[outcome] || '未完成' }
</script>
