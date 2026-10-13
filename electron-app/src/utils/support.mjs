// 诊断文件采用白名单：不复制日志正文、账号信息、URL、配置或凭据。
export function errorAdvice(message = '', reason = '') {
  const text = `${reason} ${message}`
  if (/session_expired|失效|未登录|重新登录/.test(text)) return { code: 'session_expired', title: '登录已失效', next: '在账号面板重新登录，再读取课程并启动任务。旧账号可在停止后移除。', action: 'login', label: '前往登录' }
  if (/timeout|超时/i.test(text)) return { code: 'timeout', title: '连接超时', next: '检查网络和平台地址；网络恢复后重试。仍超时可在观看设置中调整网络超时。', action: 'refresh', label: '刷新账号状态' }
  if (/connection|连接|网络|后端/i.test(text)) return { code: 'connection', title: '连接失败', next: '检查网络与平台地址，然后刷新状态。若本地后端一直无法连接，请重新启动应用。', action: 'refresh', label: '刷新账号状态' }
  if (/captcha|验证码/.test(text)) return { code: 'captcha', title: '验证码识别失败', next: '确认任务已停止后重试；可在观看设置中调整识别次数和间隔。', action: 'settings', label: '打开观看设置' }
  return { code: 'task_failed', title: '操作未完成', next: '刷新账号状态并重新读取课程，确认账号在线后重试；仍失败可导出诊断信息。', action: 'refresh', label: '刷新账号状态' }
}

export function accountRunning(account) {
  return Boolean(account?.is_playing || account?.thread_alive || account?.status?.is_playing || account?.status?.is_stopping)
}

export function createDiagnostics({ version, accounts = [], summaries = [], logs = [] }) {
  const outcomes = new Set(['success', 'failed', 'stopped', 'not_run'])
  return {
    schema_version: 1,
    app_version: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) ? version : 'unknown',
    exported_at: new Date().toISOString(),
    privacy: '仅含匿名账号状态、章节结果计数和错误分类；不含账号密码、Cookie、Token、个人信息或原始日志。',
    accounts: accounts.map((account, index) => ({ alias: `账号 ${index + 1}`, logged_in: account.logged_in === true, running: accountRunning(account), error_code: account.last_error ? errorAdvice(account.last_error).code : null })),
    tasks: summaries.map(item => ({
      account_alias: accounts.some(a => a.account_id === item.account_id) ? `账号 ${accounts.findIndex(a => a.account_id === item.account_id) + 1}` : '已移除账号',
      outcome: outcomes.has(item.outcome) ? item.outcome : 'failed',
      error_code: item.outcome === 'failed' ? errorAdvice(item.message, item.reason).code : null,
      chapters: (item.chapters || []).map(chapter => ({ outcome: outcomes.has(chapter.outcome) ? chapter.outcome : 'not_run' }))
    })),
    recent_errors: logs.filter(log => ['error', 'warn', 'warning'].includes(log.level)).slice(-30).map(log => ({ code: errorAdvice(log.message).code }))
  }
}
