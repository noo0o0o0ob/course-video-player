const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, safeStorage, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const { spawn } = require('child_process')
const { randomBytes } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createBackendSpec, findAvailablePort } = require('./backend-launcher.cjs')
const { filterDiagnostics } = require('./diagnostics.cjs')

let mainWindow
let backendProcess
let tray
let quitAllowed = false
let closeRequestPending = false
let usageLaunchAttempted = false
const usageApiBase = 'https://download.meetuu.top/api/usage/'

let backendPort = 8765
const backendToken = randomBytes(32).toString('hex')

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updates:status', status)
  }
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus({ status: 'checking', message: '正在检查更新…' }))
autoUpdater.on('update-available', info => sendUpdateStatus({ status: 'available', version: info.version, message: `发现新版本 ${info.version}` }))
autoUpdater.on('update-not-available', info => sendUpdateStatus({ status: 'current', version: info.version, message: '当前已是最新版本。' }))
autoUpdater.on('download-progress', progress => sendUpdateStatus({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))), message: '正在下载更新…' }))
autoUpdater.on('update-downloaded', info => sendUpdateStatus({ status: 'downloaded', version: info.version, percent: 100, message: `版本 ${info.version} 已下载，可以重启安装。` }))
autoUpdater.on('error', () => sendUpdateStatus({ status: 'error', message: '暂时无法检查或下载更新，请确认网络连接后重试。' }))

app.setName('课程视频自动播放')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.cqcst.course-video-player')
}
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  quitAllowed = true
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) showMainWindow()
  })
}

function getPreferencesPath() {
  return path.join(app.getPath('userData'), 'app-preferences.json')
}

function loadPreferences() {
  try {
    return JSON.parse(fs.readFileSync(getPreferencesPath(), 'utf8'))
  } catch {
    return {}
  }
}

function savePreferences(preferences) {
  fs.mkdirSync(path.dirname(getPreferencesPath()), { recursive: true })
  fs.writeFileSync(getPreferencesPath(), JSON.stringify(preferences, null, 2), 'utf8')
}

function createTrayImage() {
  return nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'icon.png'))
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  if (tray) return
  tray = new Tray(createTrayImage())
  tray.setToolTip('课程视频自动播放')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主界面', click: showMainWindow },
    { label: '关闭软件', click: () => { void handleCloseRequest() } }
  ]))
  tray.on('click', showMainWindow)
}

function hasRunningWatchTasks(timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${backendPort}/api/accounts`, {
      headers: { Authorization: `Bearer ${backendToken}` }
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`后端状态查询失败：${response.statusCode}`))
          return
        }
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const accounts = Array.isArray(result.accounts) ? result.accounts : []
          resolve(accounts.filter(account => account.is_playing || account.thread_alive || account.status?.is_playing || account.status?.is_stopping))
        } catch {
          reject(new Error('后端返回的任务状态无效'))
        }
      })
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('查询观看任务超时')))
    request.on('error', reject)
  })
}

async function handleCloseRequest() {
  if (quitAllowed || closeRequestPending) return
  closeRequestPending = true
  try {
    const runningAccounts = await hasRunningWatchTasks()
    if (runningAccounts.length) {
      const decision = await requestCloseDecision({
        kind: 'running',
        title: '观看任务正在运行',
        message: `仍有 ${runningAccounts.length} 个账号的任务正在运行，确定停止任务并退出吗？`,
        accounts: runningAccounts.map(account => account.label || account.user?.name || account.username || '未命名账号'),
        detail: '退出会结束本地后端，所有本地任务也会停止。未完成章节将中断，未确认的进度可能丢失；下次启动需重新登录并读取课程。取消可继续运行，最小化也可保留任务。',
        closeLabel: '停止全部任务并退出'
      })
      if (decision.close) {
        quitAllowed = true
        app.quit()
      }
      return
    }

    const preferences = loadPreferences()
    let shouldClose = preferences.rememberedCloseChoice
    if (typeof shouldClose !== 'boolean') {
      const decision = await requestCloseDecision({
        kind: 'idle',
        title: '关闭软件',
        message: '当前没有观看任务，确定要直接关闭软件吗？',
        detail: '关闭会结束本地后端。下次使用需要重新登录账号并读取课程。',
        closeLabel: '关闭软件'
      })
      shouldClose = decision.close
      if (decision.remember) {
        savePreferences({ ...preferences, rememberedCloseChoice: shouldClose })
      }
    }
    if (shouldClose) {
      quitAllowed = true
      app.quit()
    }
  } catch (error) {
    const decision = await requestCloseDecision({
      kind: 'unavailable',
      title: '无法确认观看任务状态',
      message: '本地后端暂时无法连接，是否强制退出软件？',
      detail: '强制退出会结束本地后端和所有仍在运行的任务，未确认的进度可能丢失。取消可保留软件并稍后重试。',
      closeLabel: '强制退出软件'
    })
    if (decision.close) {
      quitAllowed = true
      app.quit()
    }
  } finally {
    closeRequestPending = false
  }
}

function requestCloseDecision(details) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return dialog.showMessageBox({
      type: 'warning',
      title: details.title,
      message: details.message,
      detail: [details.accounts?.length ? `影响账号：${details.accounts.join('、')}` : '', details.detail].filter(Boolean).join('\n'),
      buttons: ['取消', details.closeLabel],
      defaultId: 0,
      cancelId: 0,
      ...(details.kind === 'idle' ? { checkboxLabel: '记住我的选择', checkboxChecked: false } : {})
    }).then(result => ({ close: result.response === 1, remember: details.kind === 'idle' && result.checkboxChecked === true }))
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  return new Promise(resolve => {
    const onDecision = (_event, decision) => {
      try { requireTrustedRenderer(_event) } catch { return }
      ipcMain.removeListener('app:close-decision', onDecision)
      resolve({ close: Boolean(decision?.close), remember: Boolean(decision?.remember) })
    }
    ipcMain.on('app:close-decision', onDecision)
    mainWindow.webContents.send('app:close-confirmation', details)
  })
}

function getCredentialPath() {
  return path.join(app.getPath('userData'), 'credentials.bin')
}

async function startBackend() {
  if (backendProcess) {
    return
  }

  const rootDir = path.resolve(__dirname, '..', '..')
  backendPort = await findAvailablePort(8765)
  const spec = createBackendSpec({ rootDir, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, port: backendPort, token: backendToken })
  backendProcess = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    windowsHide: true,
    detached: false
  })

  backendProcess.on('error', (err) => {
    console.error('Backend process error:', err)
    backendProcess = null
  })

  backendProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`Backend exited with code ${code}`)
    }
    backendProcess = null
  })

  try {
    await waitForBackendReady()
  } catch {
    stopBackend()
    throw new Error('本地后端未能及时启动，请重试')
  }
}

function waitForBackendReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      error ? reject(error) : resolve()
    }
    const poll = () => {
      if (settled) return
      if (!backendProcess) {
        finish(new Error('后端进程已退出'))
        return
      }
      if (Date.now() >= deadline) {
        finish(new Error('后端启动超时'))
        return
      }
      const request = http.get(`http://127.0.0.1:${backendPort}/api/health`, (response) => {
        response.resume()
        if (response.statusCode === 200) finish()
        else setTimeout(poll, 250)
      })
      request.setTimeout(1000, () => request.destroy())
      request.on('error', () => setTimeout(poll, 250))
    }
    poll()
  })
}

function stopBackend() {
  if (backendProcess) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', backendProcess.pid.toString(), '/f', '/t'], { windowsHide: true })
      } else {
        backendProcess.kill('SIGTERM')
      }
    } catch (e) {
      console.error('Error stopping backend:', e)
    }
    backendProcess = null
  }
}

function createWindow() {
  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    frame: false,
    maximizable: false,
    resizable: false,
    icon: path.join(__dirname, '..', 'public', 'icon.ico'),
    backgroundColor: '#f4f7f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.platform === 'win32') {
    mainWindow.setAppDetails({
      appId: 'com.cqcst.course-video-player',
      appIconPath: app.isPackaged ? process.execPath : path.join(__dirname, '..', 'public', 'icon.ico'),
      appIconIndex: 0
    })
  }
  mainWindow.on('close', event => {
    if (!quitAllowed) {
      event.preventDefault()
      void handleCloseRequest()
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedPage(url)) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function isTrustedPage(url) {
  try {
    if (process.env.NODE_ENV === 'development') return new URL(url).origin === 'http://127.0.0.1:5173'
    return url.split('#')[0] === pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href
  } catch { return false }
}

function requireTrustedRenderer(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || !isTrustedPage(event.senderFrame?.url || '')) throw new Error('请求来源不被允许')
}

function requestUsageApi(endpoint, method = 'GET', body = undefined) {
  const url = new URL(endpoint, usageApiBase)
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : {
        accept: 'application/json',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      },
      timeout: 4000
    }, response => {
      let data = ''
      response.on('data', chunk => {
        data += chunk.toString('utf8')
        if (data.length > 64 * 1024) request.destroy(new Error('response too large'))
      })
      response.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error('statistics request failed'))
          resolve(result)
        } catch { reject(new Error('statistics response unavailable')) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('statistics request timed out')))
    request.on('error', () => reject(new Error('statistics request unavailable')))
    if (body !== undefined) request.write(body)
    request.end()
  })
}

ipcMain.handle('usage:record-launch', async event => {
  requireTrustedRenderer(event)
  if (!app.isPackaged || usageLaunchAttempted) return { accepted: false }
  usageLaunchAttempted = true
  try {
    const challenge = await requestUsageApi('challenge')
    if (typeof challenge.challenge !== 'string') return { accepted: false }
    const body = JSON.stringify({ challenge: challenge.challenge })
    const result = await requestUsageApi('launch', 'POST', body)
    return { accepted: result.accepted === true }
  } catch {
    return { accepted: false }
  }
})

ipcMain.handle('usage:get-chart', async event => {
  requireTrustedRenderer(event)
  try {
    const result = await requestUsageApi('chart')
    if (!Number.isSafeInteger(result.total) || !Array.isArray(result.days)) throw new Error('invalid chart')
    return result
  } catch {
    throw new Error('统计数据暂时不可用')
  }
})

ipcMain.handle('app:get-backend-url', event => {
  requireTrustedRenderer(event)
  return `http://127.0.0.1:${backendPort}`
})
ipcMain.handle('app:get-version', event => {
  requireTrustedRenderer(event)
  return app.getVersion()
})
ipcMain.handle('updates:check', async event => {
  requireTrustedRenderer(event)
  if (!app.isPackaged) return { status: 'unavailable', message: '开发预览版不能检查更新，请在已安装版本中操作。' }
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) return { status: 'unavailable', message: '当前无法连接更新服务，请稍后重试。' }
    if (!result.isUpdateAvailable) return { status: 'current', version: result.updateInfo?.version, message: '当前已是最新版本。' }
    return { status: 'available', version: result.updateInfo?.version, message: `发现新版本 ${result.updateInfo?.version || ''}` }
  } catch {
    return { status: 'error', message: '暂时无法检查更新，请确认网络连接后重试。' }
  }
})
ipcMain.handle('updates:download', async event => {
  requireTrustedRenderer(event)
  if (!app.isPackaged) return { status: 'unavailable', message: '开发预览版不能下载更新。' }
  try {
    await autoUpdater.downloadUpdate()
    return { status: 'downloaded', message: '更新已下载。' }
  } catch {
    return { status: 'error', message: '更新下载失败，请检查网络后重试。' }
  }
})
ipcMain.handle('updates:install', event => {
  requireTrustedRenderer(event)
  if (!app.isPackaged) return { status: 'unavailable' }
  quitAllowed = true
  autoUpdater.quitAndInstall()
  return { status: 'installing' }
})
ipcMain.handle('diagnostics:save', async (event, payload) => {
  requireTrustedRenderer(event)
  const data = filterDiagnostics(payload)
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存匿名诊断信息',
    defaultPath: `课程客户端-匿名诊断-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: '诊断信息（JSON）', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { saved: false }
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8')
  return { saved: true }
})
ipcMain.handle('app:open-project', event => {
  requireTrustedRenderer(event)
  return shell.openExternal('https://github.com/noo0o0o0ob/course-video-player')
})
ipcMain.handle('app:get-backend-token', event => {
  requireTrustedRenderer(event)
  return backendToken
})
ipcMain.on('window:minimize', event => {
  requireTrustedRenderer(event)
  mainWindow.minimize()
})
ipcMain.on('window:close', event => {
  requireTrustedRenderer(event)
  mainWindow.close()
})
ipcMain.on('app:decline-disclaimer', event => {
  requireTrustedRenderer(event)
  quitAllowed = true
  app.quit()
})

ipcMain.handle('credentials:load', event => {
  requireTrustedRenderer(event)
  const filePath = getCredentialPath()
  if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(filePath)) {
    return null
  }

  try {
    const encrypted = fs.readFileSync(filePath)
    return JSON.parse(safeStorage.decryptString(encrypted))
  } catch {
    return null
  }
})

ipcMain.handle('credentials:save', (event, payload) => {
  requireTrustedRenderer(event)
  if (!safeStorage.isEncryptionAvailable()) {
    return { status: false, message: '当前系统不可用加密存储' }
  }

  const data = Buffer.from(safeStorage.encryptString(JSON.stringify(payload)))
  fs.writeFileSync(getCredentialPath(), data)
  return { status: true }
})

ipcMain.handle('credentials:clear', event => {
  requireTrustedRenderer(event)
  const filePath = getCredentialPath()
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
  return { status: true }
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  createTray()
  await startBackend()
  createWindow()
})

app.on('window-all-closed', () => {
  if (quitAllowed && process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', event => {
  if (!quitAllowed) {
    event.preventDefault()
    void handleCloseRequest()
    return
  }
  stopBackend()
})

app.on('activate', () => {
  if (hasSingleInstanceLock && BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
