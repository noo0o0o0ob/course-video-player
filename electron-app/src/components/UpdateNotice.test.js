import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { afterEach, expect, test, vi } from 'vitest'
import UpdateNotice from './UpdateNotice.vue'

let wrapper
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = '' })

test('可选更新可忽略，发布页和下载按钮分别触发对应动作', async () => {
  window.desktopAPI = { openReleasePage: vi.fn() }
  wrapper = mount(UpdateNotice, { props: { status: { status: 'available', version: '0.3.0', forced: false } }, global: { plugins: [ElementPlus] } })
  const buttons = wrapper.findAll('button')
  await buttons.find(button => button.text() === '前往发布页').trigger('click')
  expect(window.desktopAPI.openReleasePage).toHaveBeenCalledOnce()
  await buttons.find(button => button.text() === '立即更新').trigger('click')
  expect(wrapper.emitted('download')).toHaveLength(1)
  await buttons.find(button => button.text() === '稍后').trigger('click')
  expect(wrapper.find('.update-toast').exists()).toBe(false)
})

test('强制更新无关闭按钮，Escape 无法关闭，错误后仍可重试', async () => {
  wrapper = mount(UpdateNotice, { attachTo: document.body, props: { status: { status: 'error', version: '0.3.0', forced: true, message: '下载失败' } }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  expect(document.body.textContent).toContain('需要更新才能继续使用')
  expect(document.querySelector('.el-dialog__headerbtn')).toBeNull()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  const retry = [...document.querySelectorAll('button')].find(button => button.textContent.includes('重试更新'))
  retry.click()
  await flushPromises()
  expect(wrapper.emitted('download')).toHaveLength(1)
  expect(document.querySelector('.update-toast')).toBeNull()
})
