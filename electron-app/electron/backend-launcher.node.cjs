const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const vm = require('node:vm')

test('开发后端使用项目 Python，并传入本次客户端的端口和凭据', () => {
  const { createBackendSpec } = require('./backend-launcher.cjs')
  const base = path.resolve(__dirname, '../../.agents')
  fs.mkdirSync(base, { recursive: true })
  const directory = fs.mkdtempSync(path.join(base, 'backend-launcher-'))
  const scripts = path.join(directory, 'backend', '.venv312', 'Scripts')
  fs.mkdirSync(scripts, { recursive: true })
  fs.writeFileSync(path.join(scripts, 'python.exe'), '')
  try {
    const spec = createBackendSpec({ rootDir: directory, isPackaged: false, resourcesPath: '', port: 18765, token: 'synthetic-token', env: {}, platform: 'win32' })
    assert.equal(spec.command, path.join(scripts, 'python.exe'))
    assert.equal(spec.cwd, path.join(directory, 'backend'))
    assert.deepEqual(spec.args, [path.join(directory, 'backend', 'main.py')])
    assert.equal(spec.env.COURSE_BACKEND_PORT, '18765')
    assert.equal(spec.env.COURSE_BACKEND_TOKEN, 'synthetic-token')
  } finally {
    const relative = path.relative(base, directory)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    fs.rmSync(directory, { recursive: true })
  }
})

test('原端口已占用时选择其他本机端口', async () => {
  const { findAvailablePort } = require('./backend-launcher.cjs')
  const occupied = net.createServer()
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve))
  const port = occupied.address().port
  try {
    const alternative = await findAvailablePort(port)
    assert.notEqual(alternative, port)
    assert.ok(alternative > 0)
  } finally {
    await new Promise(resolve => occupied.close(resolve))
  }
})

test('Electron 公布的访问参数与后端进程一致，并拒绝外部页面 IPC', async () => {
  const handlers = new Map()
  const appEvents = new Map()
  let launch, childSpec, window, applicationMenu = 'default'
  let windowCount = 0, spawnCount = 0
  const app = { isPackaged: false, setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true, whenReady: () => ({ then: callback => (launch = Promise.resolve(callback())) }), on: (name, callback) => appEvents.set(name, callback), getPath: () => __dirname, quit() {} }
  class BrowserWindow {
    constructor() { window = this; windowCount++; this.minimized = true; this.focusCount = 0; this.webContents = { on() {}, setWindowOpenHandler() {} } }
    on() {}
    isDestroyed() { return false }
    isMinimized() { return this.minimized }
    restore() { this.minimized = false }
    show() {}
    focus() { this.focusCount++ }
    setAppDetails(details) { this.appDetails = details }
    loadURL() {}
    loadFile() {}
    static getAllWindows() { return [window] }
  }
  const Menu = { setApplicationMenu: menu => { applicationMenu = menu }, buildFromTemplate: template => template }
  class Tray { setToolTip() {} setContextMenu() {} on() {} }
  const electron = { app, BrowserWindow, Menu, Tray, nativeImage: { createFromPath() {} }, ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} }, safeStorage: {} }
  const childProcess = { spawn: (command, args, options) => { spawnCount++; childSpec = { command, args, options }; return { on() {}, pid: 1 } } }
  const environment = { env: { ...process.env, NODE_ENV: 'development' }, platform: process.platform }
  const http = { get: (url, callback) => {
    const request = new (require('node:events').EventEmitter)()
    request.setTimeout = () => {}
    request.destroy = () => {}
    setImmediate(() => callback({ statusCode: 200, resume() {} }))
    return request
  } }
  const context = { require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: { on() {} } } : name === 'child_process' ? childProcess : name === 'http' ? http : name.startsWith('./') ? require(path.join(__dirname, name)) : require(name), __dirname, process: environment, console, Buffer, URL, Date, setTimeout }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'), context)
  await launch
  assert.equal(applicationMenu, null)
  if (process.platform === 'win32') {
    assert.equal(window.appDetails.appId, 'com.cqcst.course-video-player')
    assert.equal(window.appDetails.appIconPath, path.join(__dirname, '..', 'public', 'icon.ico'))
    assert.equal(window.appDetails.appIconIndex, 0)
  }
  const trusted = { sender: window.webContents, senderFrame: { url: 'http://127.0.0.1:5173/' } }
  const tokenHandler = handlers.get('app:get-backend-token')
  assert.equal(typeof tokenHandler, 'function')
  const token = tokenHandler(trusted)
  assert.ok(token === childSpec.options.env.COURSE_BACKEND_TOKEN)
  assert.ok(token.length >= 32)
  assert.equal(handlers.get('app:get-backend-url')(trusted), `http://127.0.0.1:${childSpec.options.env.COURSE_BACKEND_PORT}`)
  assert.throws(() => tokenHandler({ sender: window.webContents, senderFrame: { url: 'https://untrusted.example.test/' } }))
  appEvents.get('second-instance')()
  assert.equal(window.minimized, false)
  assert.equal(window.focusCount, 1)
  assert.equal(windowCount, 1)
  assert.equal(spawnCount, 1)
})

test('第二实例立即退出，既不创建窗口也不启动后端', async () => {
  let quitCount = 0, launch
  const app = { isPackaged: false, setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => false, quit() { quitCount++ }, on() {}, whenReady: () => ({ then: callback => (launch = Promise.resolve(callback())) }) }
  const electron = { app, ipcMain: { handle() {}, on() {} } }
  const context = {
    require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: { on() {} } } : name === 'child_process' ? { spawn() { assert.fail('第二实例不能启动后端') } } : name.startsWith('./') ? require(path.join(__dirname, name)) : require(name),
    __dirname, process: { env: { NODE_ENV: 'development' }, platform: process.platform }, console, Buffer, URL, Date, setTimeout
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'), context)
  await launch
  assert.equal(quitCount, 1)
})
