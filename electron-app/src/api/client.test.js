import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data }
}

describe('本地后端客户端访问', () => {
  beforeEach(() => {
    vi.resetModules()
    window.desktopAPI = undefined
  })
  afterEach(() => vi.unstubAllGlobals())

  test('浏览器先建立会话，账号请求携带访问凭据', async () => {
    vi.stubGlobal('fetch', async (url, options) => {
      if (url.endsWith('/api/client-session')) return jsonResponse({ token: 'synthetic-client-token' })
      if (options.headers.Authorization === 'Bearer synthetic-client-token') return jsonResponse({ accounts: [{ account_id: 'synthetic' }] })
      return jsonResponse({ detail: '未验证客户端' }, 401)
    })
    const client = await import('./client.js')
    await client.initApiBase()
    expect((await client.getAccounts()).accounts).toEqual([{ account_id: 'synthetic' }])
  })

  test('桌面 IPC 提供的凭据用于 HTTP 和 WebSocket', async () => {
    window.desktopAPI = {
      getBackendUrl: async () => 'http://127.0.0.1:18765',
      getBackendToken: async () => 'synthetic-desktop-token'
    }
    vi.stubGlobal('fetch', async (url, options) => options.headers.Authorization === 'Bearer synthetic-desktop-token' ? jsonResponse({ accounts: [] }) : jsonResponse({}, 401))
    let opened
    vi.stubGlobal('WebSocket', class {
      constructor(url, protocols) { opened = { url, protocols } }
    })
    const client = await import('./client.js')
    await client.initApiBase()
    expect((await client.getAccounts()).accounts).toEqual([])
    await client.createEventSocket(() => {})
    expect(opened).toEqual({ url: 'ws://127.0.0.1:18765/api/ws/events', protocols: ['course-events', 'synthetic-desktop-token'] })
  })

  test('服务重启后刷新访问凭据，重新读取账号', async () => {
    let bootstrapCount = 0
    let reads = 0
    vi.stubGlobal('fetch', async (url, options) => {
      if (url.endsWith('/api/client-session')) return jsonResponse({ token: ++bootstrapCount === 1 ? 'synthetic-old-token' : 'synthetic-new-token' })
      reads += 1
      return options.headers.Authorization === 'Bearer synthetic-new-token' ? jsonResponse({ accounts: [] }) : jsonResponse({ code: 'client_auth_failed', detail: '需要新会话' }, 401)
    })
    const client = await import('./client.js')
    await client.initApiBase()
    expect((await client.getAccounts()).accounts).toEqual([])
    expect(reads).toBe(2)
  })

  test('平台登录拒绝不会重复提交账号密码', async () => {
    let logins = 0
    vi.stubGlobal('fetch', async url => {
      if (url.endsWith('/api/client-session')) return jsonResponse({ token: 'synthetic-client-token' })
      logins += 1
      return jsonResponse({ detail: '账号或密码错误' }, 401)
    })
    const client = await import('./client.js')
    await client.initApiBase()
    await expect(client.loginAccount('synthetic-user', 'synthetic-password')).rejects.toThrow('账号或密码错误')
    expect(logins).toBe(1)
  })
})
