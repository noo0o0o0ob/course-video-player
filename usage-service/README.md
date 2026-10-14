# 匿名启动次数统计服务

该服务为客户端和 `download.meetuu.top` 下载页提供累计启动次数数据。Node.js 20 负责 HTTP API，SQLite 读写由服务器自带的 Python 3 标准库完成；不安装 npm 包或 Python 包。

## API

- `GET /api/usage/challenge`：签发 60 秒有效的一次性随机挑战。
- `POST /api/usage/launch`：提交 `{ "challenge": "..." }`，同一挑战只能成功记一次。
- `GET /api/usage/chart`：读取最近至多 90 天的每日次数及累计次数。

服务只监听 `127.0.0.1:31876`。Nginx 负责公网 TLS 和 `/api/usage/` 转发。`USAGE_STATS_SECRET` 必须由部署环境生成，不能写入仓库；SQLite 文件配置在 `/var/lib/course-usage-stats/`，不得放入网页目录。

短时挑战摘要用于防重放，后续 API 请求会清理过期记录。匿名事件按 Asia/Shanghai 日期聚合。客户端/IP 只用于服务进程内存中的短时限流，不写入数据库或应用日志。
