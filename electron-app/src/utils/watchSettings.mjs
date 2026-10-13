export const watchSettingGroups = [
  { title: '验证码识别', items: [
    { key: 'captcha_max_retries', label: '最大重试次数', unit: '次', default: 3, min: 1, max: 10, detail: '非全自动模式达到上限后暂停，并弹窗提示手动重试。' },
    { key: 'captcha_retry_interval', label: '尝试重试间隔', unit: '秒', default: 1, min: 1, max: 60, detail: '验证码识别失败后再次尝试的等待时间，两种模式均生效。' }
  ] },
  { title: '播放与进度提交', items: [
    { key: 'chapter_interval', label: '章节切换间隔', unit: '秒', default: 3, min: 0, max: 60, detail: '当前章节结束后，开始下一章前的等待时间；0 表示立即切换。' },
    { key: 'report_retry_interval', label: '提交失败重试间隔', unit: '秒', default: 5, min: 1, max: 60, detail: '学习时长提交未被确认后，再次提交前的等待时间。' },
    { key: 'report_max_failures', label: '提交失败次数上限', unit: '次', default: 6, min: 1, max: 20, detail: '连续失败达到上限后结束当前节点；一次提交成功后重新计数。' }
  ] },
  { title: '自动重新登录', items: [
    { key: 'relogin_max_retries', label: '每轮尝试次数', unit: '次', default: 3, min: 1, max: 10, detail: '登录失效后，每一轮最多尝试登录的次数。' },
    { key: 'relogin_max_rounds', label: '最大重新登录轮数', unit: '轮', default: 3, min: 1, max: 5, detail: '当前节点最多执行多少轮重新登录，全部失败后暂停任务。' },
    { key: 'relogin_retry_interval', label: '重新登录重试间隔', unit: '秒', default: 2, min: 1, max: 60, detail: '同一轮登录失败后，再次尝试前的等待时间。' }
  ] },
  { title: '网络请求', items: [
    { key: 'network_timeout', label: '普通请求超时时间', unit: '秒', default: 20, min: 5, max: 120, detail: '课程、验证码、登录提交和学习时长提交等请求的超时阈值。' },
    { key: 'login_page_timeout', label: '登录页请求超时', unit: '秒', default: 15, min: 5, max: 120, detail: '登录前打开平台登录页的超时阈值。' },
    { key: 'heartbeat_timeout', label: '在线心跳请求超时', unit: '秒', default: 10, min: 5, max: 120, detail: '发送在线心跳请求的超时阈值，保留当前 10 秒默认值。' }
  ] }
]

export const watchSettingItems = watchSettingGroups.flatMap(group => group.items)
export function defaultWatchSettings() {
  return Object.fromEntries(watchSettingItems.map(item => [item.key, item.default]))
}
export function normalizeWatchSettings(saved = {}) {
  return Object.fromEntries(watchSettingItems.map(item => [item.key,
    Number.isInteger(saved?.[item.key]) && saved[item.key] >= item.min && saved[item.key] <= item.max ? saved[item.key] : item.default
  ]))
}
