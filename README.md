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

需要 Python 3、Node.js 和 npm。

```powershell
python -m pip install -r backend/requirements.txt
Set-Location electron-app
npm ci
npm run electron:dev
```

## Windows 打包

先生成 Electron 打包所需的 Python 后端，再构建桌面应用：

```powershell
python -m pip install pyinstaller
Set-Location backend
pyinstaller backend.spec --clean
Set-Location ..\electron-app
npm ci
npm run electron:build
```

## 本地数据与安全

打包版账号凭据由 Electron `safeStorage` 加密后保存在应用用户目录；开发模式的自定义配置保存在 `backend/profiles.json`。凭据、Cookie、Token、会话、个人数据、抓包、日志和构建产物均为本地运行数据，不应提交。

只在已获授权的测试环境和账号上使用。不要把密码、Cookie、Token 或包含这些内容的网络抓包写入源码或提交到版本库。
