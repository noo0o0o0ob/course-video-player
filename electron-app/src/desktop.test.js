import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import diagnostics from '../electron/diagnostics.cjs'
import updateService from '../electron/update-service.cjs'

function desktopFixture({ accounts = [], choice = 0, remembered = true, canceled = false, backendError = false, hasWindow = true } = {}) {
  const dialogs = []
  const writes = []
  const handlers = new Map()
  const app = { setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true, getPath: () => 'fixture', whenReady: () => ({ then() {} }), on() {}, quitCount: 0, quit() { this.quitCount++ } }
  const ipcMain = new EventEmitter()
  ipcMain.handle = (name, handler) => handlers.set(name, handler)
  const electron = { app, ipcMain, dialog: { async showMessageBox(window, options = window) { dialogs.push(options); return { response: choice } }, async showSaveDialog() { return { canceled, filePath: 'fixture-diagnostics.json' } } } }
  const mockHttp = {
    get(url, options, callback) {
      const request = new EventEmitter()
      request.setTimeout = () => {}
      queueMicrotask(() => {
        if (backendError) { request.emit('error', new Error('ECONNREFUSED')); return }
        const response = new EventEmitter()
        response.statusCode = 200
        callback(response)
        response.emit('data', Buffer.from(JSON.stringify({ accounts })))
        response.emit('end')
      })
      return request
    }
  }
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return electron
      if (name === 'electron-updater') return { autoUpdater: { on() {} } }
      if (name === 'https') return {}
      if (name === 'http') return mockHttp
      if (name === 'fs') return { mkdirSync() {}, readFileSync: () => JSON.stringify({ rememberedCloseChoice: remembered }), writeFileSync: (...args) => writes.push(args) }
      if (name === './backend-launcher.cjs') return {}
      if (name === './diagnostics.cjs') return diagnostics
      if (name === './update-service.cjs') return updateService
      if (name === 'path') return path
      if (name === 'node:crypto') return { randomBytes: () => ({ toString: () => 'synthetic-local-token' }) }
      if (name === 'node:url') return { pathToFileURL() {} }
      if (name === 'child_process') return {}
      throw new Error(name)
    },
    process: { platform: 'win32', env: { NODE_ENV: 'development' } }, Buffer, URL, console, __dirname: 'fixture',
  })
  const source = fs.readFileSync(path.resolve('electron/main.js'), 'utf8')
  const webContents = { send(channel, details) {
    dialogs.push(details)
    queueMicrotask(() => ipcMain.emit('app:close-decision', { sender: webContents, senderFrame: { url: 'http://127.0.0.1:5173/' } }, { close: choice === 1, remember: false }))
  } }
  context.fixtureWindow = hasWindow ? { webContents, isDestroyed: () => false, isMinimized: () => false, show() {}, focus() {} } : null
  vm.runInContext(`${source}\nglobalThis.closeForTest = handleCloseRequest; globalThis.testWindow = mainWindow = globalThis.fixtureWindow;`, context)
  return { close: context.closeForTest, app, dialogs, handlers, writes, trustedEvent: { sender: webContents, senderFrame: { url: 'http://127.0.0.1:5173/' } } }
}

describe('桌面窗口退出确认', () => {
  test('主进程再次过滤诊断数据中的自由文本与敏感字段', () => {
    const secret = 'synthetic-sensitive-data'
    const data = diagnostics.filterDiagnostics({ app_version: '0.1.0', token: secret, privacy: secret, accounts: [{ alias: secret, logged_in: true, password: secret }], tasks: [{ account_alias: secret, message: secret, chapters: [{ name: secret, token: secret, outcome: 'failed' }] }] })
    expect(JSON.stringify(data)).not.toContain(secret)
    expect(data.tasks[0].chapters).toEqual([{ outcome: 'failed' }])
  })
  test('确认保存时只写入脱敏内容，取消时不写文件', async () => {
    const fixture = desktopFixture()
    const result = await fixture.handlers.get('diagnostics:save')(fixture.trustedEvent, { app_version: '0.1.0', password: 'synthetic-secret', accounts: [{ alias: '账号 1', logged_in: true, cookie: 'synthetic-secret' }] })
    expect(result.saved).toBe(true)
    expect(fixture.writes).toHaveLength(1)
    expect(fixture.writes[0][0]).toBe('fixture-diagnostics.json')
    expect(fixture.writes[0][1]).not.toContain('synthetic-secret')
    const canceledFixture = desktopFixture({ canceled: true })
    expect((await canceledFixture.handlers.get('diagnostics:save')(canceledFixture.trustedEvent, {})).saved).toBe(false)
    expect(canceledFixture.writes).toHaveLength(0)
  })
  test('不可信页面不能导出诊断信息', async () => {
    const fixture = desktopFixture()
    await expect(fixture.handlers.get('diagnostics:save')({ ...fixture.trustedEvent, senderFrame: { url: 'https://fixture.invalid/' } }, {})).rejects.toThrow('请求来源不被允许')
    expect(fixture.writes).toHaveLength(0)
  })
  test('运行中列出账号与后端停止影响，默认取消且不受记住退出选项影响', async () => {
    const fixture = desktopFixture({ accounts: [{ username: '合成账号甲', is_playing: true }, { username: '合成账号乙', thread_alive: true }, { username: '合成账号丙', is_playing: false }] })
    await fixture.close()
    expect(fixture.app.quitCount).toBe(0)
    expect(fixture.dialogs[0].message).toContain('2 个账号')
    expect(fixture.dialogs[0].accounts).toEqual(['合成账号甲', '合成账号乙'])
    expect(fixture.dialogs[0].detail).toContain('退出会结束本地后端')
    expect(fixture.dialogs[0].kind).toBe('running')
  })
  test('运行中只有确认停止全部并退出才退出', async () => {
    const fixture = desktopFixture({ accounts: [{ username: '合成账号', status: { is_stopping: true } }], choice: 1 })
    await fixture.close()
    expect(fixture.app.quitCount).toBe(1)
  })
  test('无任务时沿用已有关闭偏好', async () => {
    const fixture = desktopFixture({ accounts: [], remembered: true })
    await fixture.close()
    expect(fixture.app.quitCount).toBe(1)
    expect(fixture.dialogs).toHaveLength(0)
  })
  test.each([0, 1])('后端不可用时需要明确确认强制退出，选择 %s', async choice => {
    const fixture = desktopFixture({ backendError: true, choice })
    await fixture.close()
    expect(fixture.dialogs[0].kind).toBe('unavailable')
    expect(fixture.dialogs[0].closeLabel).toBe('强制退出软件')
    expect(fixture.dialogs[0].detail).toContain('未确认的进度可能丢失')
    expect(fixture.app.quitCount).toBe(choice)
    expect(fixture.writes).toHaveLength(0)
  })
  test('后端启动失败且窗口未创建时仍能通过原生确认退出', async () => {
    const fixture = desktopFixture({ backendError: true, hasWindow: false, choice: 1 })
    await fixture.close()
    expect(fixture.dialogs[0].buttons).toEqual(['取消', '强制退出软件'])
    expect(fixture.dialogs[0].defaultId).toBe(0)
    expect(fixture.app.quitCount).toBe(1)
  })
})
