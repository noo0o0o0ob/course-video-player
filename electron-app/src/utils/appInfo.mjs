import packageInfo from '../../package.json'

export const appInfo = {
  version: packageInfo.version,
  projectUrl: 'https://github.com/noo0o0o0ob/course-video-player',
  changes: [
    '接入 GitHub Releases，启动时检查新版本。',
    '支持最低版本强制更新，以及可忽略的小版本更新提醒。',
    '支持差分下载、下载进度、失败重试和安装后自动重启。'
  ]
}
