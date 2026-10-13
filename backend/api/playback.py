# -*- coding: utf-8 -*-
from fastapi import APIRouter, HTTPException
from api.errors import raise_api_error
from pydantic import BaseModel, Field

from core.task_manager import play_task_manager


router = APIRouter()


class PlayStartRequest(BaseModel):
    course_id: str = Field(..., min_length=1)


@router.post("/play/start")
def start_playback(request: PlayStartRequest):
    try:
        result = play_task_manager.start(request.course_id)
    except RuntimeError as exc:
        raise_api_error(exc)
    if not result.get("status"):
        raise HTTPException(status_code=409, detail=result.get("message", "无法启动播放任务"))
    return result


@router.post("/play/stop")
def stop_playback():
    return play_task_manager.stop()


@router.get("/play/status")
def playback_status():
    return play_task_manager.status()
