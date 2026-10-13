const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { spawn } = require('child_process')
const { randomBytes } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createBackendSpec, findAvailablePort } = require('./backend-launcher.cjs')

let mainWindow
let backendProcess

let backendPort = 8765
const backendToken = randomBytes(32).toString('hex')

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
    backgroundColor: '#f4f7f6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.setMenuBarVisibility(false)
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
ipcMain.handle('app:get-backend-token', event => {
  requireTrustedRenderer(event)
  return backendToken
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
  await startBackend()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', stopBackend)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
