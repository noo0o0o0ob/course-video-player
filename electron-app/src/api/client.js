let apiBase = 'http://127.0.0.1:8765'
let backendToken = ''
let initialization = null
let tokenRequest = null

function getBrowserBackendUrl() {
  const { protocol, hostname } = window.location
  const host = hostname || '127.0.0.1'
  const configuredPort = Number(new URLSearchParams(window.location.search).get('backendPort'))
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535 ? configuredPort : 8765
  return `${protocol === 'https:' ? 'https:' : 'http:'}//${host}:${port}`
}

export async function initApiBase() {
  if (!initialization) {
    initialization = (async () => {
      apiBase = window.desktopAPI?.getBackendUrl ? await window.desktopAPI.getBackendUrl() : getBrowserBackendUrl()
      return apiBase
    })()
  }
  return initialization
}

async function ensureBackendToken() {
  await initApiBase()
  if (backendToken) return backendToken
  if (!tokenRequest) {
    tokenRequest = (async () => {
      if (window.desktopAPI?.getBackendToken) {
        backendToken = await window.desktopAPI.getBackendToken()
      } else {
        const response = await fetch(`${apiBase}/api/client-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const data = await response.json()
        if (!response.ok) throw new Error('无法建立本地客户端会话')
        backendToken = data.token
      }
      if (typeof backendToken !== 'string' || !backendToken) throw new Error('本地客户端会话未就绪')
      return backendToken
    })().finally(() => { tokenRequest = null })
  }
  return tokenRequest
}

function formatErrorMessage(data, status) {
  const message = data.message || data.detail
  if (typeof message === 'string') {
    return message
  }
  if (Array.isArray(message)) {
    return message.map((item) => item.msg || item.message || JSON.stringify(item)).join('；')
  }
  return `请求失败：${status}`
}

async function request(path, options = {}, refreshed = false) {
  let response
  try {
    const token = await ensureBackendToken()
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    })
  } catch {
    throw new Error(`无法连接本机后端，请确认 ${apiBase} 已启动`)
  }

  const data = await response.json().catch(() => ({}))
  if (response.status === 401 && data.code === 'client_auth_failed' && !refreshed) {
    backendToken = ''
    return request(path, options, true)
  }
  if (!response.ok) {
    throw new Error(formatErrorMessage(data, response.status))
  }
  return data
}

export function login(username, password) {
  return request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
}

export function loginAccount(username, password, label = '', profileId = null, platformUrl = null) {
  const body = { username, password, label }
  if (profileId) {
    body.profile_id = profileId
  }
  if (platformUrl) {
    body.platform_url = platformUrl
  }
  return request('/api/accounts/login', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export function getProfiles() {
  return request('/api/profiles')
}

export function getAccounts() {
  return request('/api/accounts')
}

export function removeAccount(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE'
  })
}

export function getSession() {
  return request('/api/session')
}

export function getCourses() {
  return request('/api/courses')
}

export function getAccountCourses(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/courses`)
}

export function getChapters(courseId) {
  return request(`/api/courses/${encodeURIComponent(courseId)}/chapters`)
}

export function getAccountChapters(accountId, courseId) {
  return request(
    `/api/accounts/${encodeURIComponent(accountId)}/courses/${encodeURIComponent(courseId)}/chapters`
  )
}

export function getAccountCourseProgress(accountId, courseId) {
  return request(
    `/api/accounts/${encodeURIComponent(accountId)}/courses/${encodeURIComponent(courseId)}/progress`
  )
}

export function startPlay(courseId) {
  return request('/api/play/start', {
    method: 'POST',
    body: JSON.stringify({ course_id: courseId })
  })
}

export function startAccountPlay(accountId, courseId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/play/start`, {
    method: 'POST',
    body: JSON.stringify({ course_id: courseId })
  })
}

export function startAllAccountPlay(courseId) {
  return request('/api/accounts/play/start-all', {
    method: 'POST',
    body: JSON.stringify({ course_id: courseId })
  })
}

export function stopPlay() {
  return request('/api/play/stop', { method: 'POST' })
}

export function stopAccountPlay(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/play/stop`, { method: 'POST' })
}

export function stopAllAccountPlay() {
  return request('/api/accounts/play/stop-all', { method: 'POST' })
}

export function getPlayStatus() {
  return request('/api/play/status')
}

export async function createEventSocket(onEvent, onClose) {
  const token = await ensureBackendToken()
  const url = apiBase.replace(/^http/, 'ws')
  const ws = new WebSocket(`${url}/api/ws/events`, ['course-events', token])

  ws.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data))
    } catch {
      onEvent({ type: 'log', message: event.data })
    }
  }

  ws.onclose = () => {
    backendToken = ''
    onClose?.()
  }

  return ws
}
