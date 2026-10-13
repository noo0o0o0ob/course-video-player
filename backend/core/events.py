# -*- coding: utf-8 -*-
import asyncio
import time
from typing import Any

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, websocket: WebSocket, subprotocol: str | None = None) -> None:
        await websocket.accept(subprotocol=subprotocol)
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, event: dict[str, Any]) -> None:
        event.setdefault("timestamp", time.time())
        disconnected: list[WebSocket] = []
        for connection in list(self._connections):
            try:
                await connection.send_json(event)
            except Exception:
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection)

    def emit(self, event_type: str, **payload: Any) -> None:
        event = {"type": event_type, **payload, "timestamp": time.time()}
        if self._loop and self._loop.is_running():
            coroutine = self.broadcast(event)
            try:
                asyncio.run_coroutine_threadsafe(coroutine, self._loop)
            except RuntimeError:
                coroutine.close()


manager = WebSocketManager()
