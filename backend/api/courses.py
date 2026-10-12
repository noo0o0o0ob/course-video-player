# -*- coding: utf-8 -*-
from fastapi import APIRouter, HTTPException

from core.session import session_manager


router = APIRouter()


def _player_or_401():
    try:
        return session_manager.require_player()
    except RuntimeError as exc:
        raise HTTPException(status_code=401, detail="尚未登录") from exc


@router.get("/courses")
async def courses():
    player = _player_or_401()
    try:
        course_list = player.get_courses()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"status": True, "courses": course_list}


@router.get("/courses/{course_id}/chapters")
async def chapters(course_id: str):
    player = _player_or_401()
    try:
        chapter_list = player.get_chapters(course_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"status": True, "course_id": course_id, "chapters": chapter_list}
