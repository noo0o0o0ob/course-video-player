# -*- coding: utf-8 -*-
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.session import session_manager


router = APIRouter()


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


@router.post("/login")
async def login(request: LoginRequest):
    try:
        result = session_manager.login(request.username, request.password)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not result.get("status"):
        raise HTTPException(status_code=401, detail=result.get("message", "登录失败"))
    return result


@router.get("/session")
async def session():
    return {"status": True, **session_manager.session_info()}
