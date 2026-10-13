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

  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(wrapper.find('.account-workspace').exists()).toBe(true)
    expect(wrapper.find('.learning-workspace').exists()).toBe(true)
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
    expect(api.startAccountPlay).toHaveBeenCalledWith('demo-a', 'course-a')
    await buttons[2].trigger('click')
    await flushPromises()
    expect(api.stopAccountPlay).toHaveBeenCalledWith('demo-a')
    await buttons[1].trigger('click')
    await flushPromises()
    expect(api.startAllAccountPlay).toHaveBeenCalledWith('course-a')
    await buttons[3].trigger('click')
    await flushPromises()
    expect(api.stopAllAccountPlay).toHaveBeenCalled()
    expect(wrapper.findComponent(LogPanel).props('logs').length).toBeGreaterThan(0)
    wrapper.findComponent(LogPanel).vm.$emit('clear')
    await flushPromises()
    expect(wrapper.findComponent(LogPanel).props('logs')).toEqual([])
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
})
