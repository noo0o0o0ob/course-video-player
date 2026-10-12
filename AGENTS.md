# 项目级开发约定

## 语言要求

- 本项目面向开发者和用户的文字默认使用简体中文，包括文档、界面文案、代码注释、提交说明、分支说明、Issue、Pull Request、发布说明和 GitHub 仓库 About。
- Git commit message 使用简洁中文，例如：`初始化项目`、`修复课程选择逻辑`、`调整播放进度展示`。
- 代码标识符、文件名、配置键、协议字段和第三方接口名称按技术约定保留原文；不为了中文化而破坏兼容性。

## 项目定位与安全

这是面向获准测试环境的本地课程管理与播放桌面客户端。操作外部平台前，确认测试账号和环境已获授权。不得在源码、日志、文档或提交中保留密码、Cookie、Token 或真实个人信息。

## 核心结构

- `electron-app/src/`：Vue 界面和前端 API 客户端。
- `electron-app/electron/`：Electron 主进程、IPC 和凭据加密存储。
- `backend/api/`：登录、账号、课程、播放、事件和配置接口。
- `backend/core/`：会话、账号、配置、事件及播放任务逻辑。
- `backend/backend.spec`：PyInstaller 后端打包配置。
- `README.md`：项目结构、运行方式与界面原则。

## 开发与打包

开发环境先安装 `backend/requirements.txt`，再在 `electron-app/` 执行 `npm ci` 和 `npm run electron:dev`。

Windows 打包需先安装 PyInstaller，并在 `backend/` 执行 `pyinstaller backend.spec --clean`；随后在 `electron-app/` 执行 `npm run electron:build`。

## 本地数据

打包版凭据由 Electron `safeStorage` 加密保存在应用用户目录。开发模式的自定义浏览器配置保存在 `backend/profiles.json`。凭据、会话、配置、课程导出、抓包、日志和构建目录均为本地运行数据，不应提交。
