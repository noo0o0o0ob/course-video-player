'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function chartFixture(summary, days) {
  const context = vm.createContext({
    require, Buffer, URL, __dirname,
    process: { env: { USAGE_STATS_DATABASE: path.resolve(__dirname, 'unused-test.sqlite3'), USAGE_STATS_SECRET: 'a'.repeat(64) }, umask() {} }
  })
  const source = fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8').replace('start().catch(() => process.exit(1))', '')
  vm.runInContext(source, context)
  context.syntheticResult = { summary, days }
  vm.runInContext('runDatabase = async () => syntheticResult; shanghaiDate = () => "2026-10-14"; globalThis.readChartForTest = readChart;', context)
  return context.readChartForTest
}

test('最近九十天无记录时保留历史累计并输出水平趋势', async () => {
  const read = chartFixture({ total: 123, first_day: '2026-01-01' }, [])
  const result = await read()
  assert.equal(result.total, 123)
  assert.equal(result.days.length, 90)
  assert.equal(result.days[0].date, '2026-07-17')
  assert.equal(result.days.at(-1).date, '2026-10-14')
  assert.ok(result.days.every(day => day.daily === 0 && day.cumulative === 123))
})

test('全新数据库没有记录时返回空图表', async () => {
  const result = await chartFixture({ total: 0, first_day: '' }, [])()
  assert.equal(result.total, 0)
  assert.equal(result.days.length, 0)
})

test('最近记录叠加历史累计并补齐没有启动的日期', async () => {
  const result = await chartFixture({ total: 130, first_day: '2026-01-01' }, [{ day: '2026-10-14', count: 4 }, { day: '2026-10-12', count: 3 }])()
  assert.equal(result.total, 130)
  assert.equal(result.days.find(day => day.date === '2026-10-11').cumulative, 123)
  assert.equal(result.days.find(day => day.date === '2026-10-13').cumulative, 126)
  assert.equal(result.days.at(-1).cumulative, 130)
})
