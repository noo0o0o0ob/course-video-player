'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')

process.umask(0o077)

const PORT = Number(process.env.USAGE_STATS_PORT || 31876)
const HOST = '127.0.0.1'
const DATABASE_PATH = process.env.USAGE_STATS_DATABASE || '/var/lib/course-usage-stats/usage.sqlite3'
const SECRET_HEX = process.env.USAGE_STATS_SECRET || ''
const CHALLENGE_TTL_SECONDS = 60
const MAX_BODY_BYTES = 1024
const pythonPath = process.env.USAGE_STATS_PYTHON || '/usr/bin/python3'
const databaseWorker = path.join(__dirname, 'db_worker.py')
const rateBuckets = new Map()
const MAX_RATE_KEYS = 20000

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('USAGE_STATS_PORT 配置无效')
if (!path.isAbsolute(DATABASE_PATH) || DATABASE_PATH.startsWith('/www/wwwroot/')) throw new Error('统计数据库必须使用站点目录之外的绝对路径')
if (!/^[a-f0-9]{64,}$/.test(SECRET_HEX) || SECRET_HEX.length % 2 !== 0) throw new Error('USAGE_STATS_SECRET 必须是至少 32 字节的十六进制密钥')
const signingKey = Buffer.from(SECRET_HEX, 'hex')

function jsonResponse(response, status, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extraHeaders
  })
  response.end(payload)
}

function requestAddress(request) {
  const remote = request.socket.remoteAddress || ''
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return remote.slice(0, 64)
  const forwarded = request.headers['x-real-ip']
  return typeof forwarded === 'string' && forwarded.length <= 64 ? forwarded : remote
}

function allowRequest(request, bucketName, limit, windowMs) {
  const address = requestAddress(request)
  const key = `${bucketName}:${address}`
  const now = Date.now()
  let entry = rateBuckets.get(key)
  if (!entry || now >= entry.resetAt) {
    if (!entry && rateBuckets.size >= MAX_RATE_KEYS) {
      clearExpiredRateBuckets(now)
      if (rateBuckets.size >= MAX_RATE_KEYS) return false
    }
    entry = { count: 0, resetAt: now + windowMs }
    rateBuckets.set(key, entry)
  }
  entry.count += 1
  return entry.count <= limit
}

function clearExpiredRateBuckets(now = Date.now()) {
  for (const [key, entry] of rateBuckets) {
    if (now >= entry.resetAt) rateBuckets.delete(key)
  }
}

function runDatabase(operation, payload = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [databaseWorker, DATABASE_PATH, operation], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { PYTHONDONTWRITEBYTECODE: '1' }
    })
    let output = ''
    let overflow = false
    const timeout = setTimeout(() => child.kill(), 8000)
    child.stdout.on('data', chunk => {
      if (output.length + chunk.length > 64 * 1024) {
        overflow = true
        child.kill()
      } else output += chunk.toString('utf8')
    })
    child.on('error', () => { clearTimeout(timeout); reject(new Error('database unavailable')) })
    child.stdin.on('error', () => {})
    child.on('close', code => {
      clearTimeout(timeout)
      if (code !== 0 || overflow) return reject(new Error('database unavailable'))
      try {
        const result = JSON.parse(output)
        if (!result || result.ok !== true) return reject(new Error('database unavailable'))
        resolve(result)
      } catch { reject(new Error('database unavailable')) }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', signingKey).update(encodedPayload).digest('base64url')
}

function makeChallenge() {
  const payload = {
    nonce: crypto.randomBytes(32).toString('hex'),
    expires: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

function verifyChallenge(token) {
  if (typeof token !== 'string' || token.length > 512) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null
  const expected = Buffer.from(sign(parts[0]), 'base64url')
  const actual = Buffer.from(parts[1], 'base64url')
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    const now = Math.floor(Date.now() / 1000)
    if (!/^[a-f0-9]{64}$/.test(payload.nonce) || !Number.isInteger(payload.expires) || payload.expires <= now || payload.expires > now + CHALLENGE_TTL_SECONDS) return null
    return payload
  } catch { return null }
}

function shanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(isoDate, offset) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + offset))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

async function readChart() {
  const today = shanghaiDate()
  const result = await runDatabase('chart', { today, cutoff: addDays(today, -89) })
  const summary = result.summary
  const recent = result.days
  if (!summary.first_day) return { total: Number(summary.total), days: [] }

  const start = summary.first_day > addDays(today, -89) ? summary.first_day : addDays(today, -89)
  const rows = new Map(recent.map(row => [row.day, Number(row.count)]))
  let cumulative = Number(summary.total) - recent.reduce((sum, row) => sum + Number(row.count), 0)
  const days = []
  for (let date = start; date <= today; date = addDays(date, 1)) {
    const daily = rows.get(date) || 0
    cumulative += daily
    days.push({ date, daily, cumulative })
  }
  return { total: Number(summary.total), days }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    let tooLarge = false
    let settled = false
    request.on('data', chunk => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        settled = true
        chunks.length = 0
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) return
      settled = true
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('invalid body'), { status: 400 })) }
    })
    request.on('error', error => { if (!settled) reject(error) })
  })
}

async function recordLaunch(challenge) {
  const payload = verifyChallenge(challenge)
  if (!payload) return false
  const now = Math.floor(Date.now() / 1000)
  const tokenHash = crypto.createHash('sha256').update(payload.nonce).digest('hex')
  const day = shanghaiDate()
  const result = await runDatabase('record', { tokenHash, expires: payload.expires, now, day })
  return result.accepted === true
}

async function handle(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const origin = request.headers.origin
  const previewCors = pathname === '/api/usage/chart' && request.method === 'GET'
    && ['http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)
    ? { 'access-control-allow-origin': origin, vary: 'Origin' }
    : {}
  if (pathname === '/api/usage/challenge' && request.method === 'GET') {
    if (!allowRequest(request, 'challenge', 6, 60_000)) return jsonResponse(response, 429, { error: '请求过于频繁' })
    return jsonResponse(response, 200, { challenge: makeChallenge(), expiresIn: CHALLENGE_TTL_SECONDS })
  }
  if (pathname === '/api/usage/launch' && request.method === 'POST') {
    if (!allowRequest(request, 'launch', 4, 60_000)) return jsonResponse(response, 429, { error: '请求过于频繁' })
    try {
      const body = await readRequestBody(request)
      if (Object.keys(body || {}).length !== 1 || typeof body.challenge !== 'string') return jsonResponse(response, 400, { error: '请求格式无效' })
      const accepted = await recordLaunch(body.challenge)
      if (!accepted) return jsonResponse(response, 409, { error: '挑战无效、过期或已使用' })
      return jsonResponse(response, 202, { accepted: true })
    } catch (error) {
      if (response.destroyed || response.writableEnded) return
      return jsonResponse(response, error.status || 503, { error: error.status === 413 ? '请求内容过大' : error.status === 400 ? '请求格式无效' : '暂时无法处理统计请求' })
    }
  }
  if (pathname === '/api/usage/chart' && request.method === 'GET') {
    if (!allowRequest(request, 'chart', 120, 60_000)) return jsonResponse(response, 429, { error: '请求过于频繁' }, previewCors)
    try { return jsonResponse(response, 200, await readChart(), previewCors) }
    catch { return jsonResponse(response, 503, { error: '统计数据暂时不可用' }, previewCors) }
  }
  const knownPath = ['/api/usage/challenge', '/api/usage/launch', '/api/usage/chart'].includes(pathname)
  return jsonResponse(response, knownPath ? 405 : 404, { error: knownPath ? '请求方法不受支持' : '未找到' })
}

async function start() {
  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true, mode: 0o700 })
  await runDatabase('init')

  const server = http.createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) jsonResponse(response, 503, { error: '服务暂时不可用' })
      else response.destroy()
    })
  })
  server.headersTimeout = 5000
  server.requestTimeout = 5000
  server.keepAliveTimeout = 5000
  server.listen(PORT, HOST)
  const cleanupTimer = setInterval(() => {
    clearExpiredRateBuckets()
    void runDatabase('cleanup', { now: Math.floor(Date.now() / 1000) }).catch(() => {})
  }, 60_000)
  cleanupTimer.unref()
}

start().catch(() => process.exit(1))
