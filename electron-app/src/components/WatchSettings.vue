<template>
  <el-dialog :model-value="visible" title="观看设置" width="min(900px, calc(100vw - 32px))" top="5vh" class="watch-settings-dialog" @update:model-value="$emit('update:visible', $event)">
    <p class="settings-intro">设置自动保存，下次启动任务时生效。全自动模式会持续重试验证码，直到通过或手动停止。</p>
    <div class="settings-scroll">
      <section v-for="group in watchSettingGroups" :key="group.title" class="settings-group" :aria-label="group.title">
        <h3>{{ group.title }}</h3>
        <div v-if="group.title === '播放与进度提交'" class="setting-row setting-fixed">
          <span class="setting-label">学习时长提交间隔</span>
          <span class="setting-fixed-value">30 秒 · 固定</span>
          <div class="setting-details"><p>正常播放时每 30 秒提交学习时长，平台确认后才更新进度。此项不可修改。</p></div>
        </div>
        <div v-for="item in group.items" :key="item.key" class="setting-row">
          <label :for="`setting-${item.key}`" class="setting-label">{{ item.label }}</label>
          <div class="setting-control">
            <el-input-number :id="`setting-${item.key}`" :model-value="settings[item.key]" :min="item.min" :max="item.max" :precision="0" controls-position="right" :aria-label="item.label" @change="updateSetting(item, $event)" />
            <span class="setting-unit">{{ item.unit }}</span>
          </div>
          <div class="setting-details" :id="`detail-${item.key}`">
            <p>{{ item.detail }}</p>
            <span>{{ item.min }}～{{ item.max }} {{ item.unit }} · 默认 {{ item.default }} {{ item.unit }}</span>
          </div>
        </div>
      </section>
    </div>
    <template #footer>
      <div class="settings-footer">
        <el-button @click="$emit('reset')">恢复默认设置</el-button>
        <el-button type="primary" @click="$emit('update:visible', false)">完成</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { watchSettingGroups } from '../utils/watchSettings.mjs'
const props = defineProps({ visible: Boolean, settings: { type: Object, required: true } })
const emit = defineEmits(['update:visible', 'change', 'reset'])
function updateSetting(item, value) {
  emit('change', { ...props.settings, [item.key]: Number.isInteger(value) ? Math.max(item.min, Math.min(item.max, value)) : item.default })
}
</script>
