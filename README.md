# 课程自动化桌面客户端

面向获准测试环境的本地课程管理与播放桌面工具。用户通过桌面界面管理账号、选择课程、控制任务并查看进度和日志。

## 项目结构

- `electron-app/src/`：Vue 界面、页面组件、状态展示和前端接口客户端。
- `electron-app/electron/`：Electron 主进程、应用窗口、IPC 和凭据加密存储。
- `backend/api/`：登录、账号、课程、播放、事件和配置接口。
- `backend/core/`：会话、账号、配置、事件及播放任务逻辑。
- `backend/backend.spec`：PyInstaller 后端打包配置。

## 界面原则

- 优先展示当前账号、课程、任务状态和进度。
- 使用熟悉、清楚的表单、选择框、按钮、进度条和状态提示。
- 保持信息紧凑；错误和下一步操作要容易理解。
- 使用中文界面文案，并支持键盘操作、清晰对比度和减少动态效果设置。
- 产品表述限于获准测试和会话管理，不使用夸大或误导性描述。

## 本地开发

需要 Python 3.12、Node.js 和 npm。推荐在后端目录建立独立环境：

```powershell
py -3.12 -m venv backend/.venv312
backend/.venv312/Scripts/python.exe -m pip install -r backend/requirements.txt
Set-Location electron-app
npm ci
npm run electron:dev
```

Electron 优先使用 `backend/.venv312`，其次使用 `backend/.venv`；也可通过 `COURSE_PYTHON` 指定 Python 可执行文件。后端仅监听 `127.0.0.1`，优先使用 8765 端口，端口被占用时自动选择其他本机端口。桌面界面通过 IPC 获取本次启动的连接参数。

浏览器开发模式默认连接 8765，可使用 `http://127.0.0.1:5173/?backendPort=18765` 指定已有调试服务。浏览器只在内存中保存本地访问凭据；可信本地页面可建立会话，其他来源无法获取凭据。自定义本地开发页面的来源可通过 `COURSE_BROWSER_ORIGINS` 配置。

独立运行后端时，可通过 `COURSE_BACKEND_PORT` 指定端口，通过 `COURSE_BACKEND_TOKEN` 指定访问凭据；不设置凭据时，后端会在每次启动时生成随机值。私有 HTTP 接口要求 Bearer 凭据，WebSocket 通过子协议传递凭据，避免写入 URL 和访问日志。

## 回归检查

在项目根目录运行后端测试，测试仅使用合成响应，不会登录或修改真实平台记录：

```powershell
backend/.venv312/Scripts/python.exe -m unittest discover -s backend/tests -v
Set-Location electron-app
npm test
node --test electron/backend-launcher.node.cjs
npm run build
```

课程列表默认合并当前课程与页面提供的结束课程入口，并按课程 ID 去重。`/api/courses` 与账号课程接口支持 `kind=all`、`kind=current`、`kind=finish`。播放仅在提交得到确认后推进已确认时长，并单独查询平台节点状态；失败或未确认的节点不会被计为完成，部分失败也不会显示课程完成。

## Windows 打包

先生成 Electron 打包所需的 Python 后端，再构建桌面应用：

```powershell
backend/.venv312/Scripts/python.exe -m pip install pyinstaller
Set-Location backend
.venv312/Scripts/pyinstaller.exe backend.spec --clean
Set-Location ..\electron-app
npm ci
npm run electron:build
```

## 本地数据与安全

账号凭据由 Electron `safeStorage` 加密后保存在应用用户目录；自定义浏览器配置中的 Cookie 和额外请求头通过当前 Windows 用户的 DPAPI 加密。开发模式配置保存在 `backend/profiles.json`，打包版配置保存在应用用户目录。旧明文配置会在成功读取后原子迁移，解密失败时会明确报错并保留原文件。

凭据、Cookie、Token、会话、个人数据、抓包、日志和构建产物均为本地运行数据，不应提交。配置机密的加密功能面向 Windows；其他系统不支持时会拒绝明文保存机密。

只在已获授权的测试环境和账号上使用。不要把密码、Cookie、Token 或包含这些内容的网络抓包写入源码或提交到版本库。
