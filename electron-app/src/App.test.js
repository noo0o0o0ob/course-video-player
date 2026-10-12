import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { describe, expect, test, vi } from 'vitest'
import App from './App.vue'

vi.mock('./api/client', () => ({
  createEventSocket: vi.fn(() => ({ close: vi.fn(), onclose: null })),
  getAccountChapters: vi.fn(),
  getAccountCourseProgress: vi.fn(),
  getAccountCourses: vi.fn(),
  getAccounts: vi.fn(async () => ({ accounts: [] })),
  initApiBase: vi.fn(async () => undefined),
  loginAccount: vi.fn(),
  removeAccount: vi.fn(),
  startAccountPlay: vi.fn(),
  startAllAccountPlay: vi.fn(),
  stopAccountPlay: vi.fn(),
  stopAllAccountPlay: vi.fn()
}))

describe('App Element Plus shell', () => {
  test('renders the rebuilt Element Plus control console', async () => {
    window.desktopAPI = {
      loadCredentials: vi.fn(async () => null)
    }

    const wrapper = mount(App, {
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

    expect(wrapper.find('.el-container').exists()).toBe(true)
    expect(wrapper.find('.workbench').exists()).toBe(true)
    expect(wrapper.find('.left-rail').exists()).toBe(true)
    expect(wrapper.find('.el-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('课程视频播放控制台')
    expect(wrapper.text()).toContain('账号池')
    expect(wrapper.text()).toContain('课程与节点')
  })
})
