import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from './App.vue'
import AccountPool from './components/AccountPool.vue'
import CoursePanel from './components/CoursePanel.vue'
import LoginPanel from './components/LoginPanel.vue'
import PlaybackControls from './components/PlaybackControls.vue'
import PlaybackProgress from './components/PlaybackProgress.vue'
import LogPanel from './components/LogPanel.vue'
import * as api from './api/client'
import { defaultWatchSettings } from './utils/watchSettings.mjs'

vi.mock('./api/client', () => ({
  createEventSocket: vi.fn(() => ({ close: vi.fn(), onclose: null })),
  getAccountChapters: vi.fn(),
  getAccountCourseProgress: vi.fn(),
  getAccountCourses: vi.fn(),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  getAccounts: vi.fn(async () => ({ accounts: [] })),
  initApiBase: vi.fn(async () => undefined),
  loginAccount: vi.fn(),
  removeAccount: vi.fn(),
  startAccountPlay: vi.fn(),
  startAllAccountPlay: vi.fn(),
  stopAccountPlay: vi.fn(),
  stopAllAccountPlay: vi.fn()
}))

describe('平铺课程工作台', () => {
  let wrapper
  let accountState
  async function confirmPending() {
    await flushPromises()
    const button = wrapper.findAll('.el-dialog button').find(button => /确认全部开始|确认全部停止|移除该账号/.test(button.text()))
    expect(button).toBeDefined()
    await button.trigger('click')
    await flushPromises()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    accountState = [{ account_id: 'demo-a', username: '演示账号甲', logged_in: true, is_playing: false }]
    api.getAccounts.mockImplementation(async () => ({ accounts: accountState.map(account => ({ ...account })) }))
    api.getAccountCourses.mockResolvedValue({ courses: [{ course_id: 'course-a', name: '演示课程' }] })
    api.getAccountChapters.mockResolvedValue({ chapters: [{ node_id: 'node-a', name: '第一章', duration: 60, study_state: 0 }] })
    api.startAccountPlay.mockImplementation(async () => {
      accountState[0].is_playing = true
      return { message: '任务开始' }
    })
    api.stopAccountPlay.mockImplementation(async () => {
      accountState[0].is_playing = false
      return { message: '任务停止' }
    })
    api.startAllAccountPlay.mockImplementation(api.startAccountPlay.getMockImplementation())
    api.stopAllAccountPlay.mockImplementation(api.stopAccountPlay.getMockImplementation())
    window.desktopAPI = {
      loadCredentials: vi.fn(async () => null),
      saveCredentials: vi.fn(async () => ({ status: true })),
      clearCredentials: vi.fn(async () => ({ status: true }))
    }
    wrapper = mount(App, {
      global: {
        plugins: [ElementPlus],
        stubs: {
          ElOption: true,
          ElSelect: {
            template: '<div class="el-select"><slot /></div>'
          },
          teleport: true
        }
      }
    })
  })

  afterEach(() => {
    wrapper.unmount()
    delete window.desktopAPI
  })

  test('账号、课程、控制、进度与日志始终显示在同一页', async () => {
    await flushPromises()

    expect(wrapper.find('.workbench').exists()).toBe(true)
    expect(wrapper.find('[aria-label="账号与登录"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="课程与章节"]').exists()).toBe(true)
    expect(wrapper.find('.left-rail').exists()).toBe(false)
    expect(wrapper.find('.el-drawer').exists()).toBe(false)
    expect(wrapper.find('.floating-log-button').exists()).toBe(false)
    expect(wrapper.find('.el-card').exists()).toBe(true)
    for (const component of [AccountPool, LoginPanel, CoursePanel, PlaybackControls, PlaybackProgress, LogPanel]) {
      expect(wrapper.findComponent(component).exists()).toBe(true)
    }
    expect(wrapper.text()).toContain('课程工作台')
    expect(wrapper.text()).toContain('运行日志')
  })

  test('读取和选择课程后，单个及批量播放控制仍调用原有接口', async () => {
    await flushPromises()
    wrapper.findComponent(CoursePanel).vm.$emit('refresh')
    await flushPromises()
    expect(api.getAccountCourses).toHaveBeenCalledWith('demo-a')
    await wrapper.get('.course-option').trigger('click')
    await flushPromises()
    expect(api.getAccountChapters).toHaveBeenCalledWith('demo-a', 'course-a')
    expect(wrapper.text()).toContain('第一章')
    const controls = wrapper.findComponent(PlaybackControls)
    expect(controls.props('disabled')).toBe(false)
    const buttons = controls.findAll('button')
    await buttons[0].trigger('click')
    await flushPromises()
    expect(api.startAccountPlay).toHaveBeenCalledWith('demo-a', 'course-a', { full_auto_mode: false, ...defaultWatchSettings() })
    await buttons[2].trigger('click')
    await flushPromises()
    expect(api.stopAccountPlay).toHaveBeenCalledWith('demo-a')
    await buttons[1].trigger('click')
    await confirmPending()
    await flushPromises()
    expect(api.startAllAccountPlay).toHaveBeenCalledWith('course-a', { full_auto_mode: false, ...defaultWatchSettings() })
    await buttons[3].trigger('click')
    await confirmPending()
    await flushPromises()
    expect(api.stopAllAccountPlay).toHaveBeenCalled()
    expect(wrapper.findComponent(LogPanel).props('logs').length).toBeGreaterThan(0)
    wrapper.findComponent(LogPanel).vm.$emit('clear')
    await flushPromises()
    expect(wrapper.findComponent(LogPanel).props('logs')).toEqual([])
  })

  test('全自动开关和次数设置会保存并传给单个和批量任务', async () => {
    await flushPromises()
    await wrapper.get('.watch-options .el-switch').trigger('click')
    await wrapper.get('.watch-options button').trigger('click')
    await flushPromises()
    const number = wrapper.get('.el-input-number input')
    await number.setValue('10')
    await number.trigger('blur')
    await flushPromises()
    const interval = wrapper.findAll('.el-input-number input')[1]
    await interval.setValue('5')
    await interval.trigger('blur')
    await flushPromises()
    expect(JSON.parse(localStorage.getItem('watch-settings'))).toEqual({ full_auto_mode: true, ...defaultWatchSettings(), captcha_max_retries: 10, captcha_retry_interval: 5 })
    wrapper.findComponent(CoursePanel).vm.$emit('refresh')
    await flushPromises()
    await wrapper.get('.course-option').trigger('click')
    await flushPromises()
    wrapper.findComponent(PlaybackControls).vm.$emit('start-all')
    await confirmPending()
    await flushPromises()
    expect(api.startAllAccountPlay).toHaveBeenCalledWith('course-a', { full_auto_mode: true, ...defaultWatchSettings(), captcha_max_retries: 10, captcha_retry_interval: 5 })
  })

  test('非当前账号失败也会弹窗，重试使用失败账号和课程', async () => {
    await flushPromises()
    const onEvent = api.createEventSocket.mock.calls[0][0]
    onEvent({ type: 'error', account_id: 'demo-b', course_id: 'course-b', reason: 'captcha_retries_exhausted', message: '验证码识别错误，请手动点击重试' })
    await flushPromises()
    expect(wrapper.text()).toContain('验证码识别错误，请手动点击重试')
    const retryButton = wrapper.findAll('.el-dialog button').find(button => button.text() === '重试')
    await retryButton.trigger('click')
    await flushPromises()
    expect(api.startAccountPlay).toHaveBeenCalledWith('demo-b', 'course-b', { full_auto_mode: false, ...defaultWatchSettings() })
  })

  test('设置菜单展示全部参数详情，恢复默认后保存并用于新任务', async () => {
    await flushPromises()
    await wrapper.get('.watch-options button').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.setting-row')).toHaveLength(12)
    expect(wrapper.text()).toContain('平台确认后才更新进度')
    expect(wrapper.find('#setting-report_interval').exists()).toBe(false)
    expect(wrapper.text()).toContain('30 秒 · 固定')
    const input = wrapper.get('#setting-chapter_interval')
    await input.setValue('7')
    await input.trigger('blur')
    await flushPromises()
    expect(JSON.parse(localStorage.getItem('watch-settings')).chapter_interval).toBe(7)
    expect(JSON.parse(localStorage.getItem('watch-settings')).report_interval).toBeUndefined()
    await wrapper.findAll('.settings-footer button').find(button => button.text() === '恢复默认设置').trigger('click')
    await flushPromises()
    expect(JSON.parse(localStorage.getItem('watch-settings'))).toEqual({ full_auto_mode: false, ...defaultWatchSettings() })
    expect(wrapper.get('#setting-chapter_interval').element.value).toBe('3')
  })

  test('切换和移除账号仍可用，切换时清除上一账号的课程', async () => {
    accountState.push({ account_id: 'demo-b', username: '演示账号乙', logged_in: true, is_playing: false })
    await flushPromises()
    wrapper.findComponent(AccountPool).vm.$emit('refresh')
    await flushPromises()
    wrapper.findComponent(CoursePanel).vm.$emit('refresh')
    await flushPromises()
    await wrapper.get('.course-option').trigger('click')
    await flushPromises()
    await wrapper.findAll('.account-select')[1].trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(AccountPool).props('selectedAccountId')).toBe('demo-b')
    expect(wrapper.findComponent(CoursePanel).props('courses')).toEqual([])
    expect(wrapper.findComponent(PlaybackControls).props('disabled')).toBe(true)
    api.removeAccount.mockImplementation(async (id) => {
      accountState = accountState.filter(account => account.account_id !== id)
      return { message: '账号已移除' }
    })
    await wrapper.findAll('.account-row')[1].get('.el-button').trigger('click')
    await confirmPending()
    await flushPromises()
    expect(api.removeAccount).toHaveBeenCalledWith('demo-b')
    expect(wrapper.findComponent(AccountPool).props('selectedAccountId')).toBe('demo-a')
  })

  test('登录提交、记住密码和清除保存仍连通原有接口', async () => {
    await flushPromises()
    api.loginAccount.mockResolvedValue({ account: accountState[0] })
    const login = wrapper.findComponent(LoginPanel)
    const inputs = login.findAll('input').filter(input => input.attributes('type') !== 'checkbox')
    await inputs[0].setValue('https://demo.invalid')
    await inputs[1].setValue('演示账号')
    await inputs[2].setValue('演示密码')
    await login.get('form').trigger('submit')
    await flushPromises()
    expect(api.loginAccount).toHaveBeenCalledWith('演示账号', '演示密码', '', null, 'https://demo.invalid')
    expect(window.desktopAPI.saveCredentials).toHaveBeenCalledWith({ platformUrl: 'https://demo.invalid', username: '演示账号', password: '演示密码' })
    await login.findAll('button').find(button => button.text().includes('清除保存')).trigger('click')
    await flushPromises()
    expect(window.desktopAPI.clearCredentials).toHaveBeenCalled()
  })

  test('课程搜索可恢复全部课程，刷新后重置旧的搜索条件', async () => {
    await flushPromises()
    api.getAccountCourses.mockResolvedValue({ courses: [
      { course_id: 'course-a', name: '演示课程' },
      { course_id: 'course-b', name: '大学英语' }
    ] })
    const panel = wrapper.findComponent(CoursePanel)
    panel.vm.$emit('refresh')
    await flushPromises()
    const search = panel.get('.course-picker input')
    await search.setValue('英语')
    expect(panel.findAll('.course-option')).toHaveLength(1)
    expect(panel.get('.course-option').text()).toBe('大学英语')
    await search.setValue('不存在的课程')
    expect(panel.text()).toContain('没有找到匹配课程')
    await search.setValue('')
    expect(panel.findAll('.course-option')).toHaveLength(2)
    await search.setValue('英语')
    panel.vm.$emit('refresh')
    // 接口通常返回新的数组对象。
    api.getAccountCourses.mockResolvedValue({ courses: [{ course_id: 'course-c', name: '新课程' }] })
    await flushPromises()
    panel.vm.$emit('refresh')
    await flushPromises()
    expect(panel.get('.course-picker input').element.value).toBe('')
    expect(panel.get('.course-option').text()).toBe('新课程')
  })

  test('实时事件继续更新账号状态、两个进度条和常驻日志', async () => {
    await flushPromises()
    const onEvent = api.createEventSocket.mock.calls[0][0]
    onEvent({ type: 'progress', account_id: 'demo-a', is_playing: true, total_progress: 36, current_video_progress: 72, status_text: '正在播放第一章', message: '收到进度更新' })
    await flushPromises()
    const progress = wrapper.findComponent(PlaybackProgress)
    expect(progress.props('totalProgress')).toBe(36)
    expect(progress.props('currentVideoProgress')).toBe(72)
    expect(progress.text()).toContain('正在播放第一章')
    expect(wrapper.findComponent(PlaybackControls).props('isPlaying')).toBe(true)
    expect(wrapper.findComponent(AccountPool).text()).toContain('播放中')
    expect(wrapper.findComponent(LogPanel).text()).toContain('收到进度更新')
    onEvent({ type: 'error', account_id: 'demo-a', is_playing: false, message: '演示错误提示' })
    await flushPromises()
    expect(wrapper.findComponent(LogPanel).get('[data-level="error"]').text()).toContain('演示错误提示')
  })

  test('批量操作取消和移除账号取消均不调用接口，确认前显示范围', async () => {
    await flushPromises()
    wrapper.findComponent(PlaybackControls).vm.$emit('stop-all')
    await flushPromises()
    expect(api.stopAllAccountPlay).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('全部 1 个账号')
    expect(wrapper.text()).toContain('演示账号甲 · 无运行任务')
    await wrapper.findAll('.el-dialog button').find(b => b.text() === '取消').trigger('click')
    await flushPromises()
    expect(api.stopAllAccountPlay).not.toHaveBeenCalled()
    wrapper.findComponent(AccountPool).vm.$emit('remove', 'demo-a')
    await flushPromises()
    expect(api.removeAccount).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('仅移除以下账号')
    await wrapper.findAll('.el-dialog button').find(b => b.text() === '取消').trigger('click')
    await flushPromises()
    expect(api.removeAccount).not.toHaveBeenCalled()
  })

  test('任务总结保留其他账号结果，明确章节结果并重试正确账号', async () => {
    accountState.push({ account_id: 'demo-b', username: '演示账号乙', logged_in: true, is_playing: false })
    await flushPromises()
    wrapper.findComponent(AccountPool).vm.$emit('refresh')
    await flushPromises()
    const onEvent = api.createEventSocket.mock.calls[0][0]
    onEvent({ type: 'task_summary', account_id: 'demo-b', summary: { run_id: 'run-b', course_id: 'course-b', outcome: 'failed', message: '平台响应超时', completed: 1, failed: 1, chapters: [
      { node_id: 'one', name: '成功章节', outcome: 'success', message: '平台确认' },
      { node_id: 'two', name: '失败章节', outcome: 'failed', message: '可重试' },
      { node_id: 'three', name: '未执行章节', outcome: 'not_run', message: '尚未执行' }
    ] } })
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text().includes('任务总结')).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('演示账号乙 · course-b')
    expect(wrapper.text()).toContain('成功章节')
    expect(wrapper.text()).toContain('失败章节')
    expect(wrapper.text()).toContain('未执行章节')
    expect(wrapper.text()).toContain('检查网络和平台地址')
    await wrapper.findAll('button').find(b => b.text() === '重试未完成任务').trigger('click')
    await flushPromises()
    expect(api.startAccountPlay).toHaveBeenCalledWith('demo-b', 'course-b', { full_auto_mode: false, ...defaultWatchSettings() })
  })

  test('关于显示实际版本、更新内容和固定项目链接', async () => {
    await flushPromises()
    await wrapper.get('[aria-label="关于与版本"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('版本 0.1.0')
    expect(wrapper.text()).toContain('当前版本更新内容')
    expect(wrapper.text()).toContain('https://github.com/noo0o0o0ob/course-video-player')
  })

  test.each([false, true])('批量启动失败进入总结，刷新时不会被后端的旧结果覆盖（HTTP 错误：%s）', async (httpError) => {
    accountState[0].status = { task_summary: { run_id: 'old-run', finished_at: 1, course_id: 'course-a', outcome: 'success', message: '旧任务已完成', chapters: [] } }
    await flushPromises()
    wrapper.findComponent(AccountPool).vm.$emit('refresh')
    wrapper.findComponent(CoursePanel).vm.$emit('refresh')
    await flushPromises()
    await wrapper.get('.course-option').trigger('click')
    await flushPromises()
    const results = [{ account_id: 'demo-a', status: false, message: '账号没有所选课程' }]
    if (httpError) api.startAllAccountPlay.mockRejectedValue(Object.assign(new Error('未启动任何账号'), { results }))
    else api.startAllAccountPlay.mockResolvedValue({ status: false, message: '未启动任何账号', results })
    wrapper.findComponent(PlaybackControls).vm.$emit('start-all')
    await confirmPending()
    await wrapper.findAll('button').find(b => b.text().includes('任务总结')).trigger('click')
    await flushPromises()
    expect(wrapper.find('.summary-account').text()).toContain('账号没有所选课程')
    expect(wrapper.find('.summary-account').text()).not.toContain('旧任务已完成')
  })

  test('登录失效提供可执行的登录入口', async () => {
    await flushPromises()
    api.createEventSocket.mock.calls[0][0]({ type: 'error', account_id: 'demo-a', reason: 'session_expired', message: '登录已失效，请重新登录' })
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text().includes('错误排查')).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('在账号面板重新登录')
    expect(wrapper.findAll('button').some(b => b.text() === '前往登录')).toBe(true)
  })
  test('桌面诊断保存与取消状态准确，传给主进程的数据不含账号名称', async () => {
    await flushPromises()
    window.desktopAPI.saveDiagnostics = vi.fn(async () => ({ saved: true }))
    await wrapper.findAll('button').find(b => b.text().includes('错误排查')).trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === '导出匿名诊断信息').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('匿名诊断文件已保存')
    expect(JSON.stringify(window.desktopAPI.saveDiagnostics.mock.calls[0][0])).not.toContain('演示账号甲')
    window.desktopAPI.saveDiagnostics.mockResolvedValue({ saved: false })
    await wrapper.findAll('button').find(b => b.text() === '导出匿名诊断信息').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已取消保存诊断文件')
  })
})
