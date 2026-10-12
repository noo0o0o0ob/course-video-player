let apiBase = 'http://127.0.0.1:8765'

function getBrowserBackendUrl() {
  const { protocol, hostname } = window.location
  const host = hostname || '127.0.0.1'
  return `${protocol}//${host}:8765`
}

export async function initApiBase() {
  if (window.desktopAPI?.getBackendUrl) {
    apiBase = await window.desktopAPI.getBackendUrl()
  } else {
    apiBase = getBrowserBackendUrl()
  }
  return apiBase
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

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${apiBase}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    })
  } catch {
    throw new Error(`无法连接后端服务，请确认 ${apiBase} 已启动并允许局域网访问`)
  }

  const data = await response.json().catch(() => ({}))
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

export function createEventSocket(onEvent, onClose) {
  const url = apiBase.replace(/^http/, 'ws')
  const ws = new WebSocket(`${url}/api/ws/events`)

  ws.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data))
    } catch {
      onEvent({ type: 'log', message: event.data })
    }
  }

  ws.onclose = () => {
    onClose?.()
  }

  return ws
}
