# -*- coding: utf-8 -*-
import asyncio
import json
import os
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["COURSE_BACKEND_TOKEN"] = "synthetic-local-client-token"
import requests
from main import app
import api.accounts as accounts_api
import core.player as player_module
from core.accounts import AccountContext, AccountManager


async def request(path, method="GET", body=None, authenticated=True, origin=None, host="127.0.0.1"):
    headers = [(b"host", host.encode()), (b"content-type", b"application/json")]
    if authenticated:
        headers.append((b"authorization", b"Bearer synthetic-local-client-token"))
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http", "path": path, "raw_path": path.encode(), "root_path": "", "query_string": b"", "headers": headers, "client": ("127.0.0.1", 1000), "server": ("127.0.0.1", 8765)}
    messages = []
    async def receive():
        return {"type": "http.request", "body": json.dumps(body).encode() if body is not None else b"", "more_body": False}
    async def send(message):
        messages.append(message)
    await app(scope, receive, send)
    started = next(item for item in messages if item["type"] == "http.response.start")
    raw = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {"message": raw.decode()}
    return started["status"], data, dict(started.get("headers", []))


async def websocket_handshake(origin, authenticated):
    protocols = ["course-events", "synthetic-local-client-token"] if authenticated else ["course-events"]
    scope = {"type": "websocket", "asgi": {"version": "3.0"}, "http_version": "1.1", "scheme": "ws", "path": "/api/ws/events", "query_string": b"", "root_path": "", "headers": [(b"host", b"127.0.0.1"), (b"origin", origin.encode()), (b"sec-websocket-protocol", ", ".join(protocols).encode())], "subprotocols": protocols, "client": ("127.0.0.1", 1000), "server": ("127.0.0.1", 8765)}
    messages = []
    inputs = iter([{"type": "websocket.connect"}, {"type": "websocket.disconnect", "code": 1000}])
    async def receive():
        return next(inputs)
    async def send(message):
        messages.append(message)
    await app(scope, receive, send)
    return messages


class ApiRegressionTests(unittest.TestCase):
    def test_private_api_requires_client_token(self):
        status, _, _ = asyncio.run(request("/api/profiles", authenticated=False))
        self.assertEqual(status, 401)

    def test_untrusted_origin_is_rejected_even_with_token(self):
        status, _, _ = asyncio.run(request("/api/accounts", origin="https://untrusted.example.test"))
        self.assertEqual(status, 403)

    def test_untrusted_host_is_rejected(self):
        status, _, _ = asyncio.run(request("/api/accounts", host="untrusted.example.test"))
        self.assertEqual(status, 400)

    def test_trusted_browser_can_obtain_client_session(self):
        status, data, _ = asyncio.run(request("/api/client-session", "POST", {}, authenticated=False, origin="http://127.0.0.1:5173"))
        self.assertEqual(status, 200)
        self.assertEqual(data.get("token"), "synthetic-local-client-token")

    def test_client_session_requires_browser_origin(self):
        status, _, _ = asyncio.run(request("/api/client-session", "POST", {}, authenticated=False))
        self.assertEqual(status, 403)

    def test_valid_client_can_read_accounts(self):
        status, data, _ = asyncio.run(request("/api/accounts", origin="http://127.0.0.1:5173"))
        self.assertEqual(status, 200)
        self.assertIsInstance(data.get("accounts"), list)

    def test_health_is_available_without_credentials(self):
        status, data, _ = asyncio.run(request("/api/health", authenticated=False))
        self.assertEqual(status, 200)
        self.assertTrue(data["status"])

    def test_course_read_does_not_block_health(self):
        entered = threading.Event()
        def slow(account_id, kind="all"):
            entered.set()
            time.sleep(0.2)
            return []
        async def concurrent():
            started = time.monotonic()
            async def health():
                while not entered.is_set():
                    await asyncio.sleep(0.001)
                await request("/api/health")
                return time.monotonic() - started
            course_task = asyncio.create_task(request("/api/accounts/synthetic/courses"))
            elapsed = await health()
            self.assertEqual((await course_task)[0], 200)
            return elapsed
        with patch.object(accounts_api.account_manager, "get_courses", side_effect=slow):
            elapsed = asyncio.run(concurrent())
        self.assertLess(elapsed, 0.12)

    def test_expired_account_start_returns_401(self):
        with patch.object(player_module, "HAS_OCR", False):
            player = player_module.AutoPlayer()
        manager = AccountManager()
        manager._accounts["synthetic"] = AccountContext("synthetic", "synthetic-user", player)
        with patch.object(accounts_api, "account_manager", manager):
            status, _, _ = asyncio.run(request("/api/accounts/synthetic/play/start", "POST", {"course_id": "1"}))
        self.assertEqual(status, 401)

    def test_platform_exception_does_not_expose_secrets(self):
        with patch.object(accounts_api.account_manager, "get_courses", side_effect=requests.RequestException("token=synthetic-sensitive-value")):
            status, data, _ = asyncio.run(request("/api/accounts/synthetic/courses"))
        self.assertEqual(status, 502)
        self.assertNotIn("synthetic-sensitive-value", json.dumps(data))

    def test_websocket_requires_client_token(self):
        messages = asyncio.run(websocket_handshake("http://127.0.0.1:5173", False))
        self.assertFalse(any(item["type"] == "websocket.accept" for item in messages))

    def test_websocket_rejects_untrusted_origin(self):
        messages = asyncio.run(websocket_handshake("https://untrusted.example.test", True))
        self.assertFalse(any(item["type"] == "websocket.accept" for item in messages))

    def test_valid_websocket_selects_event_protocol(self):
        messages = asyncio.run(websocket_handshake("http://127.0.0.1:5173", True))
        accepted = next(item for item in messages if item["type"] == "websocket.accept")
        self.assertEqual(accepted.get("subprotocol"), "course-events")


if __name__ == "__main__":
    unittest.main()
