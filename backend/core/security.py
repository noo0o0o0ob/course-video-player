# -*- coding: utf-8 -*-
"""限制本地客户端的 HTTP 和 WebSocket 访问。"""
import hmac
import ipaddress
import os
import secrets
from urllib.parse import urlsplit

from starlette.responses import JSONResponse


class LocalAccessPolicy:
    def __init__(self) -> None:
        self.token = os.environ.get("COURSE_BACKEND_TOKEN") or secrets.token_urlsafe(32)
        self.browser_origins = {"http://127.0.0.1:5173", "http://localhost:5173"}
        for origin in os.environ.get("COURSE_BROWSER_ORIGINS", "").split(","):
            origin = origin.strip().rstrip("/")
            parsed = urlsplit(origin)
            if parsed.scheme == "http" and self.is_local_host(parsed.hostname or "") and not parsed.username and not parsed.password and parsed.path == "" and not parsed.query and not parsed.fragment:
                self.browser_origins.add(origin)

    @staticmethod
    def is_local_host(host: str) -> bool:
        if host.lower() == "localhost":
            return True
        try:
            return ipaddress.ip_address(host).is_loopback
        except ValueError:
            return False

    def trusted_host(self, headers: dict[str, str]) -> bool:
        try:
            parsed = urlsplit("//" + headers.get("host", ""))
            return bool(parsed.hostname) and not parsed.username and not parsed.password and self.is_local_host(parsed.hostname)
        except ValueError:
            return False

    def trusted_origin(self, scope, headers: dict[str, str], *, browser_session: bool = False) -> bool:
        origin = headers.get("origin")
        if origin is None:
            return not browser_session
        if origin == "null":
            return not browser_session
        scheme = "https" if scope.get("scheme") in {"https", "wss"} else "http"
        return origin in self.browser_origins or origin == f"{scheme}://{headers.get('host', '')}"

    def authenticated(self, scope, headers: dict[str, str]) -> bool:
        authorization = headers.get("authorization", "")
        candidates = [authorization[7:]] if authorization.startswith("Bearer ") else []
        if scope["type"] == "websocket":
            candidates += scope.get("subprotocols", [])
        return any(hmac.compare_digest(self.token.encode(), candidate.encode()) for candidate in candidates)


access_policy = LocalAccessPolicy()


class LocalAccessMiddleware:
    def __init__(self, app, policy: LocalAccessPolicy) -> None:
        self.app, self.policy = app, policy

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers", [])}
        status, message = 0, ""
        if not self.policy.trusted_host(headers):
            status, message = 400, "仅允许通过本机地址访问"
        elif not self.policy.trusted_origin(scope, headers):
            status, message = 403, "请求来源不被允许"
        elif scope.get("path", "").startswith("/api/") and scope["path"] not in {"/api/health", "/api/client-session"} and not self.policy.authenticated(scope, headers):
            status, message = 401, "本地客户端验证失败"
        if status:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                body = {"detail": message}
                if status == 401:
                    body["code"] = "client_auth_failed"
                await JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})(scope, receive, send)
            return
        await self.app(scope, receive, send)
