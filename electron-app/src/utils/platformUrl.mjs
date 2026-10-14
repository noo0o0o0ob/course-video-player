const LOGIN_PATH_SUFFIX = /\/(?:user|auth|account|student)\/login\/?$|\/login\/?$/i

export function normalizePlatformUrl(value) {
  const input = String(value || '').trim()
  if (!input) throw new Error('请输入学习平台地址')
  if (/\s/.test(input)) throw new Error('平台地址中不能包含空格')

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`
  let url
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('请输入有效的平台网址，例如 https://example.com')
  }

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('平台地址必须是有效的 HTTP 或 HTTPS 网址，且不能包含账号或密码')
  }

  let pathname = url.pathname.replace(LOGIN_PATH_SUFFIX, '').replace(/\/+$/, '')
  return `${url.origin}${pathname}`
}
