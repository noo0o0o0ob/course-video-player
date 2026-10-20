const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { updatePolicy, createUpdateService } = require('./update-service.cjs')

test('最低支持版本决定强制更新，兼容 GitHub HTML 说明', () => {
  assert.equal(updatePolicy({ version: '0.3.0', releaseNotes: '<p>最低支持版本：0.2.0</p>' }, '0.1.0').forced, true)
  assert.equal(updatePolicy({ version: '0.3.0', releaseNotes: '最低支持版本：0.2.0' }, '0.2.0').forced, false)
  assert.equal(updatePolicy({ version: '0.3.0' }, '0.2.0').forced, false)
  assert.throws(() => updatePolicy({ version: '0.3.0', releaseNotes: '最低支持版本：9.0.0' }, '0.2.0'))
})

test('强制更新下载失败后保持阻断，重试完成后才允许安装重启', async () => {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => ({ updateInfo: { version: '0.3.0', releaseNotes: '最低支持版本：0.3.0' } })
  let attempts = 0, installed = 0, quit = 0
  updater.downloadUpdate = async () => { if (!attempts++) throw new Error('模拟断网'); updater.emit('download-progress', { percent: 42 }) }
  updater.quitAndInstall = (silent, restart) => { assert.equal(silent, true); assert.equal(restart, true); installed++ }
  const service = createUpdateService({ updater, currentVersion: '0.2.0', publish() {} })
  await service.install(() => quit++)
  assert.equal(installed, 0)
  assert.equal((await service.check()).forced, true)
  assert.equal((await service.download()).status, 'error')
  assert.equal(service.getState().forced, true)
  assert.equal((await service.download()).status, 'downloaded')
  await service.install(() => quit++)
  assert.equal(installed, 1)
  assert.equal(quit, 1)
  assert.equal(updater.disableDifferentialDownload, false)
})

test('后端停止失败时不运行安装器，成功停止后才能安装', async () => {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => ({ updateInfo: { version: '0.3.0' } })
  updater.downloadUpdate = async () => {}
  let installed = false
  updater.quitAndInstall = () => { installed = true }
  const service = createUpdateService({ updater, currentVersion: '0.2.0', publish() {} })
  await service.check(); await service.download()
  await service.install(async () => { throw new Error('模拟停止失败') })
  assert.equal(installed, false)
  assert.equal(service.getState().status, 'downloaded')
  await service.install(async () => { await Promise.resolve(); assert.equal(installed, false) })
  assert.equal(installed, true)
})

test('去重并行检查，最新版本无提醒，禁止降级', async () => {
  const updater = new EventEmitter()
  let checks = 0
  updater.checkForUpdates = async () => { checks++; return { updateInfo: { version: '0.1.0' } } }
  const service = createUpdateService({ updater, currentVersion: '0.2.0', publish() {} })
  const states = await Promise.all([service.check(), service.check()])
  assert.equal(checks, 1)
  assert.equal(states[0].status, 'current')
  assert.equal(updater.allowDowngrade, false)
})
