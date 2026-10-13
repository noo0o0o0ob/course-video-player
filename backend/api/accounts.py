# -*- coding: utf-8 -*-
from fastapi import APIRouter, HTTPException
from api.errors import raise_api_error
from pydantic import BaseModel, Field

from core.accounts import account_manager
from typing import Literal


router = APIRouter()


class AccountLoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    label: str | None = None
    profile_id: str | None = None
    platform_url: str | None = None


class AccountPlayStartRequest(BaseModel):
    course_id: str = Field(..., min_length=1)


def _raise_backend_error(exc: Exception):
    raise_api_error(exc)


@router.get("/accounts")
def list_accounts():
    return {"status": True, "accounts": account_manager.list_accounts()}


@router.post("/accounts/login")
def login_account(request: AccountLoginRequest):
    try:
        result = account_manager.login(request.username, request.password, request.label, request.profile_id, request.platform_url)
    except Exception as exc:
        _raise_backend_error(exc)
    if not result.get("status"):
        raise HTTPException(status_code=401, detail=result.get("message", "登录失败"))
    return result


@router.delete("/accounts/{account_id}")
def remove_account(account_id: str):
    return account_manager.remove(account_id)


@router.get("/accounts/{account_id}/courses")
def account_courses(account_id: str, kind: Literal["all", "current", "finish"] = "all"):
    try:
        courses = account_manager.get_courses(account_id, kind)
    except RuntimeError as exc:
        raise_api_error(exc)
    except Exception as exc:
        _raise_backend_error(exc)
    return {"status": True, "account_id": account_id, "courses": courses}


@router.get("/accounts/{account_id}/courses/{course_id}/chapters")
def account_chapters(account_id: str, course_id: str):
    try:
        snapshot = account_manager.get_course_snapshot(account_id, course_id)
    except RuntimeError as exc:
        raise_api_error(exc)
    except Exception as exc:
        _raise_backend_error(exc)
    return {"status": True, "account_id": account_id, "course_id": course_id, **snapshot}


@router.get("/accounts/{account_id}/courses/{course_id}/progress")
def account_course_progress(account_id: str, course_id: str):
    try:
        progress = account_manager.get_progress(account_id, course_id)
    except RuntimeError as exc:
        raise_api_error(exc)
    except Exception as exc:
        _raise_backend_error(exc)
    return {"status": True, "account_id": account_id, "course_id": course_id, "progress": progress}


@router.post("/accounts/{account_id}/play/start")
def start_account_playback(account_id: str, request: AccountPlayStartRequest):
    try:
        result = account_manager.start(account_id, request.course_id)
    except RuntimeError as exc:
        raise_api_error(exc)
    if not result.get("status"):
        raise HTTPException(status_code=409, detail=result.get("message", "无法启动播放任务"))
    return result


@router.post("/accounts/play/start-all")
def start_all_accounts_playback(request: AccountPlayStartRequest):
    result = account_manager.start_all(request.course_id)
    if not result.get("status"):
        raise HTTPException(status_code=409, detail=result.get("message", "没有可启动的账号"))
    return result


@router.post("/accounts/{account_id}/play/stop")
def stop_account_playback(account_id: str):
    try:
        return account_manager.stop(account_id)
    except RuntimeError as exc:
        raise_api_error(exc)


@router.post("/accounts/play/stop-all")
def stop_all_accounts_playback():
    return account_manager.stop_all()


@router.get("/accounts/{account_id}/play/status")
def account_playback_status(account_id: str):
    try:
        return account_manager.status(account_id)
    except RuntimeError as exc:
        raise_api_error(exc)
