// 主进程只允许固定诊断字段，拒绝从渲染进程带入自由文本或凭据。
function filterDiagnostics(data = {}) {
  const list = value => Array.isArray(value) ? value.slice(0, 10000) : []
  const code = value => ['session_expired', 'timeout', 'connection', 'captcha', 'task_failed'].includes(value) ? value : null
  const outcome = value => ['success', 'failed', 'stopped', 'not_run'].includes(value) ? value : 'not_run'
  const alias = value => /^账号 \d{1,5}$/.test(value) ? value : '已移除账号'
  return {
    schema_version: 1,
    app_version: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.app_version) ? data.app_version : 'unknown',
    exported_at: new Date().toISOString(),
    privacy: '仅含匿名账号状态、章节结果计数和错误分类；不含凭据、个人信息或原始日志。',
    accounts: list(data.accounts).map(item => ({ alias: alias(item?.alias), logged_in: item?.logged_in === true, running: item?.running === true, error_code: code(item?.error_code) })),
    tasks: list(data.tasks).map(item => ({ account_alias: alias(item?.account_alias), outcome: outcome(item?.outcome), error_code: code(item?.error_code), chapters: list(item?.chapters).map(chapter => ({ outcome: outcome(chapter?.outcome) })) })),
    recent_errors: list(data.recent_errors).map(item => ({ code: code(item?.code) }))
  }
}
module.exports = { filterDiagnostics }
