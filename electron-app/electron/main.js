const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let mainWindow
let backendProcess

const backendPort = 8765

function getCredentialPath() {
  return path.join(app.getPath('userData'), 'credentials.bin')
}

function startBackend() {
  if (backendProcess) {
    return
  }

  const rootDir = path.resolve(__dirname, '..', '..')
  let command
  let args = []
  let cwd

  if (app.isPackaged) {
    // 打包后运行 backend.exe（位于 resources/backend/）
    command = path.join(process.resourcesPath, 'backend', 'backend.exe')
    cwd = path.dirname(command)
  } else {
    // 开发模式：直接运行 python main.py
    command = 'python'
    args = [path.join(rootDir, 'backend', 'main.py')]
    cwd = path.join(rootDir, 'backend')
  }

  backendProcess = spawn(command, args, {
    cwd: cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
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
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('app:get-backend-url', () => `http://127.0.0.1:${backendPort}`)

ipcMain.handle('credentials:load', () => {
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

ipcMain.handle('credentials:save', (_event, payload) => {
  if (!safeStorage.isEncryptionAvailable()) {
    return { status: false, message: '当前系统不可用加密存储' }
  }

  const data = Buffer.from(safeStorage.encryptString(JSON.stringify(payload)))
  fs.writeFileSync(getCredentialPath(), data)
  return { status: true }
})

ipcMain.handle('credentials:clear', () => {
  const filePath = getCredentialPath()
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
  return { status: true }
})

app.whenReady().then(() => {
  startBackend()
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
