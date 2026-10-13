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
  let launch, childSpec, window, applicationMenu = 'default'
  const app = { isPackaged: false, whenReady: () => ({ then: callback => (launch = Promise.resolve(callback())) }), on() {}, getPath: () => __dirname, quit() {} }
  class BrowserWindow {
    constructor() { window = this; this.menuBarVisible = true; this.webContents = { on() {}, setWindowOpenHandler() {} } }
    setMenuBarVisibility(visible) { this.menuBarVisible = visible }
    loadURL() {}
    loadFile() {}
    static getAllWindows() { return [window] }
  }
  const Menu = { setApplicationMenu: menu => { applicationMenu = menu } }
  const electron = { app, BrowserWindow, Menu, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, safeStorage: {} }
  const childProcess = { spawn: (command, args, options) => { childSpec = { command, args, options }; return { on() {}, pid: 1 } } }
  const environment = { env: { ...process.env, NODE_ENV: 'development' }, platform: process.platform }
  const http = { get: (url, callback) => {
    const request = new (require('node:events').EventEmitter)()
    request.setTimeout = () => {}
    request.destroy = () => {}
    setImmediate(() => callback({ statusCode: 200, resume() {} }))
    return request
  } }
  const context = { require: name => name === 'electron' ? electron : name === 'child_process' ? childProcess : name === 'http' ? http : name.startsWith('./') ? require(path.join(__dirname, name)) : require(name), __dirname, process: environment, console, Buffer, URL, Date, setTimeout }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'), context)
  await launch
  assert.equal(applicationMenu, null)
  assert.equal(window.menuBarVisible, false)
  const trusted = { sender: window.webContents, senderFrame: { url: 'http://127.0.0.1:5173/' } }
  const tokenHandler = handlers.get('app:get-backend-token')
  assert.equal(typeof tokenHandler, 'function')
  const token = tokenHandler(trusted)
  assert.ok(token === childSpec.options.env.COURSE_BACKEND_TOKEN)
  assert.ok(token.length >= 32)
  assert.equal(handlers.get('app:get-backend-url')(trusted), `http://127.0.0.1:${childSpec.options.env.COURSE_BACKEND_PORT}`)
  assert.throws(() => tokenHandler({ sender: window.webContents, senderFrame: { url: 'https://untrusted.example.test/' } }))
})
