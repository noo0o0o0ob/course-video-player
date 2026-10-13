# -*- coding: utf-8 -*-
from fastapi import APIRouter, HTTPException
from api.errors import raise_api_error

from core.session import session_manager
from typing import Literal


router = APIRouter()


def _player_or_401():
    try:
        return session_manager.require_player()
    except RuntimeError as exc:
        raise HTTPException(status_code=401, detail="尚未登录") from exc


@router.get("/courses")
def courses(kind: Literal["all", "current", "finish"] = "all"):
    player = _player_or_401()
    try:
        course_list = player.get_courses(kind)
    except Exception as exc:
        raise_api_error(exc)
    return {"status": True, "courses": course_list}


@router.get("/courses/{course_id}/chapters")
def chapters(course_id: str):
    player = _player_or_401()
    try:
        chapter_list = player.get_chapters(course_id)
    except Exception as exc:
        raise_api_error(exc)
    return {"status": True, "course_id": course_id, "chapters": chapter_list}
