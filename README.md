<div align="center">
  <img src="electron-app/public/icon.png" width="88" alt="课程工作台图标">
  <h1>课程工作台</h1>
  <p><strong>把账号、课程与观看任务，收进一个清晰的本地工作台。</strong></p>
  <p>面向获准测试环境的 Windows 桌面客户端</p>
  <p>
    <img src="https://img.shields.io/badge/License-GPL--3.0--only-176B56?style=flat-square" alt="GPL-3.0-only">
    <img src="https://img.shields.io/badge/Platform-Windows-547AA5?style=flat-square" alt="Windows">
    <img src="https://img.shields.io/badge/Frontend-Vue%203-42A57D?style=flat-square" alt="Vue 3">
    <img src="https://img.shields.io/badge/Desktop-Electron-547AA5?style=flat-square" alt="Electron">
  </p>
  <p>
    <a href="https://download.meetuu.top/">下载页面</a>
    &nbsp;·&nbsp;
    <a href="https://github.com/noo0o0o0ob/course-video-player">浏览 GitHub 仓库</a>
    &nbsp;·&nbsp;
    <a href="LICENSE">查看 GPL-3.0 许可证</a>
  </p>
</div>

<br>

<p align="center">
  <img src="https://download.meetuu.top/preview.png" alt="课程工作台实际运行界面" width="920">
</p>

## 一个工作台，掌握当前进度

课程工作台把课程账号、课程章节、播放控制和运行日志放在同一处。任务状态与进度清楚可见，操作留在桌面客户端完成。

| 账号与课程 | 任务与进度 | 本地安全 |
| --- | --- | --- |
| 管理测试账号，读取并选择课程 | 控制观看任务，查看章节和整体进度 | 凭据通过 Electron `safeStorage` 加密保存在本机 |

## 为授权测试而设计

- 仅用于获准的测试环境与账号。
- 课程操作、播放状态和运行日志集中展示，便于了解任务当前处于什么状态。
- 本地后端只监听回环地址；前端通过 Electron IPC 获取本次运行的本地连接信息。
- 不要在源码、日志或提交中保存密码、Cookie、Token 或网络抓包。

## 技术结构

```text
electron-app/
├─ src/                 Vue 界面、组件与 API 客户端
└─ electron/            Electron 主进程、IPC 与凭据存储

backend/
├─ api/                 登录、账号、课程、播放与配置接口
├─ core/                会话、配置与播放任务逻辑
└─ backend.spec         PyInstaller 打包配置
```

桌面端由 Electron 与 Vue 构成，本地服务由 Python 提供。开发模式下可以在浏览器预览界面，也可以启动完整 Electron 应用。

## 本地运行

需要 Python 3.12、Node.js 与 npm。第一次运行时，在项目根目录执行：

```powershell
py -3.12 -m venv backend/.venv312
backend/.venv312/Scripts/python.exe -m pip install -r backend/requirements.txt
Set-Location electron-app
npm ci
npm run electron:dev
```

浏览器模式可在 `electron-app` 中运行 `npm run dev`，默认打开 `http://127.0.0.1:5173/`。Electron 开发模式会自动启动 Vite 与本地后端。

## 构建 Windows 安装包

先在项目根目录安装 PyInstaller 并打包 Python 后端，再构建 Electron 安装包：

```powershell
backend/.venv312/Scripts/python.exe -m pip install pyinstaller
Set-Location backend
.venv312/Scripts/pyinstaller.exe backend.spec --clean
Set-Location ..\electron-app
npm ci
npm run electron:build
```

安装程序和更新清单输出到 `electron-app/release/`。

### 自动更新与发布

Windows 安装版从本仓库的 GitHub Releases 检查更新。启动时检查一次，也可以在“关于与更新 → 更新内容”中手动检查。可选更新提示可以忽略；强制更新弹窗不能通过关闭按钮、遮罩或 Escape 跳过，下载完成后自动安装并重启。

发布说明中用单独一行 `最低支持版本：0.2.0` 指定最低可使用版本。低于该版本的客户端必须更新；大于或等于该版本的客户端可以选择稍后更新。未填写该行时默认可选更新。最低支持版本不得高于本次发布版本。

每次发布先修改 `electron-app/package.json` 的版本号和更新内容，重新构建后端与客户端并完成测试，再创建与版本号一致的 Git 标签（如 `v0.2.0`）。把安装程序 `.exe`、对应 `.exe.blockmap` 和 `latest.yml` 一起上传到正式 Release；建议先创建草稿，文件全部上传后再公开，避免客户端读到不完整版本。保留旧版安装包与 blockmap，以支持差分更新。

客户端优先差分下载，无法差分时回退为完整下载；首次安装仍需完整安装包。下载直接来自 GitHub，不消耗业务服务器的安装包流量。下载失败可以重试或前往发布页手动安装。开发预览版不执行真实更新，`0.1.0` 等使用旧下载源的版本需要手动安装一次新版本。

## 参与改进

欢迎通过 GitHub Issues 反馈问题，或提交 Pull Request 一起改进界面、易用性与稳定性。提交前请移除本地账号信息、Cookie、Token、日志和构建产物。

## 项目成长

<p align="center">
  <a href="https://github.com/noo0o0o0ob/course-video-player/stargazers">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/noo0o0o0ob/course-video-player/star-history/assets/repository-visuals/star-history-dark.svg">
      <img src="https://raw.githubusercontent.com/noo0o0o0ob/course-video-player/star-history/assets/repository-visuals/star-history-light.svg" alt="GitHub Star 增长趋势图" width="100%">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/noo0o0o0ob/course-video-player/graphs/contributors">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/noo0o0o0ob/course-video-player/star-history/assets/repository-visuals/contributors-dark.svg">
      <img src="https://raw.githubusercontent.com/noo0o0o0ob/course-video-player/star-history/assets/repository-visuals/contributors-light.svg" alt="课程工作台项目贡献者头像墙" width="100%">
    </picture>
  </a>
</p>

Star 图与贡献者头像墙由 GitHub Actions 自动生成。Star 趋势从首次运行开始记录，之后每日更新；新增 Star 也会触发更新。

## 许可证

本项目自有源代码采用 [GNU GPL 第 3 版（GPL-3.0-only）](LICENSE)。第三方依赖、图标及其他资源按各自附带的许可证使用。

<div align="center">
  <sub>由 <a href="https://github.com/noo0o0o0ob">Theycallmeuu</a> 维护 · 用清晰的状态，完成每一步。</sub>
</div>
