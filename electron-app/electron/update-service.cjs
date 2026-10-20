const semver = require('semver')

const releasesUrl = 'https://github.com/noo0o0o0ob/course-video-player/releases/latest'

function updatePolicy(info, currentVersion) {
  const notes = Array.isArray(info.releaseNotes) ? info.releaseNotes.map(item => item.note).join('\n') : String(info.releaseNotes || '')
  // 支持 GitHub Atom 返回的 HTML，以及普通 Markdown 发布说明。
  const text = notes.replace(/<[^>]*>/g, ' ')
  const minimum = text.match(/最低支持版本\s*[:：]\s*v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1]
  if (minimum && (!semver.valid(minimum) || semver.gt(minimum, info.version))) throw new Error('最低支持版本无效')
  return { version: info.version, minimumVersion: minimum || '', forced: Boolean(minimum && semver.lt(currentVersion, minimum)), releasesUrl }
}

function createUpdateService({ updater, currentVersion, publish }) {
  let state = { status: 'idle', forced: false, version: '', percent: 0, releasesUrl }
  let checking, downloading
  const send = patch => { state = { ...state, ...patch }; publish(state); return state }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.disableDifferentialDownload = false
  updater.on('download-progress', progress => send({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))), message: '正在下载更新…' }))
  updater.on('update-downloaded', () => send({ status: 'downloaded', percent: 100, message: '更新已下载，准备重启安装。' }))
  updater.on('error', () => send({ status: 'error', message: '更新失败，请检查网络后重试；也可以前往发布页手动下载。' }))
  return {
    getState: () => state,
    check() {
      if (checking) return checking
      if (downloading || ['downloaded', 'installing'].includes(state.status)) return Promise.resolve(state)
      send({ status: 'checking', message: '正在检查更新…' })
      checking = (async () => {
        try {
          const result = await updater.checkForUpdates()
          if (!result?.updateInfo) throw new Error('更新服务没有返回版本')
          const info = result.updateInfo
          if (!semver.valid(info.version)) throw new Error('版本无效')
          if (!semver.gt(info.version, currentVersion)) return send({ status: 'current', forced: false, version: info.version, message: '当前已是最新版本。' })
          return send({ ...updatePolicy(info, currentVersion), status: 'available', percent: 0, message: `发现新版本 ${info.version}` })
        } catch {
          return send({ status: 'error', message: '无法检查更新，请检查网络后重试。' })
        } finally { checking = null }
      })()
      return checking
    },
    download() {
      if (downloading) return downloading
      if (!state.version || !['available', 'error'].includes(state.status)) return Promise.resolve(state)
      send({ status: 'downloading', percent: 0, message: '正在准备下载更新…' })
      downloading = (async () => {
        try {
          await updater.downloadUpdate()
          return send({ status: 'downloaded', percent: 100, message: '更新已下载，可以重启安装。' })
        } catch {
          return send({ status: 'error', message: '下载失败，请重试或前往发布页手动下载。' })
        } finally { downloading = null }
      })()
      return downloading
    },
    async install(beforeQuit) {
      if (state.status !== 'downloaded') return state
      send({ status: 'installing', message: '正在安装更新并重启…' })
      try {
        await beforeQuit()
        updater.quitAndInstall(true, true)
      } catch {
        send({ status: 'downloaded', message: '暂时无法停止本地任务，请稍后重试安装。' })
      }
      return state
    }
  }
}

module.exports = { createUpdateService, updatePolicy, releasesUrl }
