import packageInfo from '../../package.json'

export const appInfo = {
  version: packageInfo.version,
  projectUrl: 'https://github.com/noo0o0o0ob/course-video-player',
  changes: [
    '补齐首次使用步骤与课程空状态说明。',
    '批量开始、停止、移除账号和运行中退出前确认影响范围。',
    '记录各账号与章节的任务结果，并提供重试与错误排查入口。',
    '支持导出经过白名单过滤的匿名诊断信息。'
  ]
}
