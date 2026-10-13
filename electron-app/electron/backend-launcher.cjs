const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')

function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const selected = server.address().port
      server.close(error => error ? reject(error) : resolve(selected))
    })
  })
}

async function findAvailablePort(preferred = 8765) {
  try {
    return await probePort(preferred)
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error
    return probePort(0)
  }
}

function createBackendSpec({ rootDir, isPackaged, resourcesPath, port, token, env = process.env, platform = process.platform }) {
  const backendDir = path.join(rootDir, 'backend')
  let command
  if (isPackaged) {
    command = path.join(resourcesPath, 'backend', 'backend.exe')
  } else {
    const executable = platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']
    const candidates = ['.venv312', '.venv'].map(directory => path.join(backendDir, directory, ...executable))
    command = env.COURSE_PYTHON || candidates.find(candidate => fs.existsSync(candidate)) || 'python'
  }
  return {
    command,
    args: isPackaged ? [] : [path.join(backendDir, 'main.py')],
    cwd: isPackaged ? path.dirname(command) : backendDir,
    env: { ...env, PYTHONIOENCODING: 'utf-8', COURSE_BACKEND_PORT: String(port), COURSE_BACKEND_TOKEN: token }
  }
}

module.exports = { createBackendSpec, findAvailablePort }
