const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, safeStorage, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
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

let backendPort = 8765
const backendToken = randomBytes(32).toString('hex')

app.setName('课程视频自动播放')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.cqcst.course-video-player')
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
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '观看任务正在运行',
        message: `仍有 ${runningAccounts.length} 个账号的任务正在运行，确定停止任务并退出吗？`,
        detail: `影响账号：\n${runningAccounts.map(account => account.label || account.user?.name || account.username || '未命名账号').join('\n')}\n\n退出会结束本地后端，所有本地任务也会停止。未完成章节将中断，未确认的进度可能丢失；下次启动需重新登录并读取课程。取消可继续运行，最小化也可保留任务。`,
        buttons: ['取消，继续运行', '停止全部任务并退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (result.response === 1) {
        quitAllowed = true
        app.quit()
      }
      return
    }

    const preferences = loadPreferences()
    let shouldClose = preferences.rememberedCloseChoice
    if (typeof shouldClose !== 'boolean') {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: '关闭软件',
        message: '当前没有观看任务，确定要直接关闭软件吗？',
        detail: '关闭会结束本地后端。下次使用需要重新登录账号并读取课程。',
        checkboxLabel: '记住我的选择',
        checkboxChecked: false,
        buttons: ['取消', '关闭软件'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      shouldClose = result.response === 1
      if (result.checkboxChecked) {
        savePreferences({ ...preferences, rememberedCloseChoice: shouldClose })
      }
    }
    if (shouldClose) {
      quitAllowed = true
      app.quit()
    }
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '无法确认观看任务状态',
      message: '暂时不能关闭软件，因为无法确认观看任务是否已经停止。',
      detail: error.message,
      buttons: ['知道了']
    })
  } finally {
    closeRequestPending = false
  }
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

ipcMain.handle('app:get-backend-url', event => {
  requireTrustedRenderer(event)
  return `http://127.0.0.1:${backendPort}`
})
ipcMain.handle('app:get-version', event => {
  requireTrustedRenderer(event)
  return app.getVersion()
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
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
