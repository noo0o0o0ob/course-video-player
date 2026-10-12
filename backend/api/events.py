# -*- coding: utf-8 -*-
import asyncio
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.events import manager


router = APIRouter()


@router.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    manager.set_loop(asyncio.get_running_loop())
    await manager.connect(websocket)
    await websocket.send_json(
        {"type": "log", "level": "info", "message": "实时日志已连接", "timestamp": time.time()}
    )
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
