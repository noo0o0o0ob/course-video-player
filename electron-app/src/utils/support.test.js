import { describe, expect, test } from 'vitest'
import { createDiagnostics, errorAdvice } from './support.mjs'

describe('匿名诊断白名单', () => {
  test('嵌套字段与自由文本中的凭据和个人信息均不进入导出文件', () => {
    const secret = 'synthetic-secret-cookie-token'
    const data = createDiagnostics({
      version: '0.1.0',
      accounts: [{ account_id: secret, username: secret, label: secret, platform_url: `https://${secret}.test`, password: secret, cookie: secret, token: secret, user: { name: secret }, logged_in: true, status: { message: secret, token: secret }, last_error: `超时 password=${secret}` }],
      summaries: [{ account_id: secret, course_id: secret, course_name: secret, outcome: 'failed', message: secret, reason: secret, chapters: [{ node_id: secret, name: secret, outcome: 'failed', message: `Authorization: Bearer ${secret}`, response: { cookie: secret } }] }],
      logs: [{ level: 'error', time: secret, message: `Cookie: ${secret}; 密码=${secret}; token=${secret}` }]
    })
    const text = JSON.stringify(data)
    expect(text).not.toContain(secret)
    expect(data.accounts[0].alias).toBe('账号 1')
    expect(data.tasks[0].chapters).toEqual([{ outcome: 'failed' }])
    expect(data.recent_errors).toEqual([{ code: 'task_failed' }])
  })
  test('登录与超时错误有不同的下一步', () => {
    expect(errorAdvice('登录已失效').action).toBe('login')
    expect(errorAdvice('平台响应超时').next).toContain('检查网络')
  })
})
