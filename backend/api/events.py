# -*- coding: utf-8 -*-
import asyncio
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.events import manager


router = APIRouter()


@router.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    manager.set_loop(asyncio.get_running_loop())
    try:
        await manager.connect(websocket, subprotocol="course-events" if "course-events" in websocket.scope.get("subprotocols", []) else None)
        await websocket.send_json({"type": "log", "level": "info", "message": "实时日志已连接", "timestamp": time.time()})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        manager.disconnect(websocket)
