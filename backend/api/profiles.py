# -*- coding: utf-8 -*-
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.profiles import profile_manager


router = APIRouter()


class ProfileCreateRequest(BaseModel):
    name: str = Field(..., min_length=1)
    description: str = ""
    user_agent: str = ""
    cookie: str = ""
    referer: str = ""
    accept_language: str = "zh-CN,zh;q=0.9,en;q=0.8"
    x_requested_with: str = "XMLHttpRequest"
    extra_headers: dict[str, str] | None = None


class ProfileUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    user_agent: str | None = None
    cookie: str | None = None
    referer: str | None = None
    accept_language: str | None = None
    x_requested_with: str | None = None
    extra_headers: dict[str, str] | None = None


@router.get("/profiles")
async def list_profiles():
    return {"status": True, "profiles": profile_manager.list_all()}


@router.get("/profiles/{profile_id}")
async def get_profile(profile_id: str):
    profile = profile_manager.get(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    return {"status": True, "profile": profile.to_dict()}


@router.post("/profiles")
async def create_profile(request: ProfileCreateRequest):
    profile = profile_manager.create(
        name=request.name,
        description=request.description,
        user_agent=request.user_agent,
        cookie=request.cookie,
        referer=request.referer,
        accept_language=request.accept_language,
        x_requested_with=request.x_requested_with,
        extra_headers=request.extra_headers,
    )
    return {"status": True, "profile": profile.to_dict()}


@router.put("/profiles/{profile_id}")
async def update_profile(profile_id: str, request: ProfileUpdateRequest):
    updates = request.model_dump(exclude_none=True)
    profile = profile_manager.update(profile_id, **updates)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在或为预设配置，无法修改")
    return {"status": True, "profile": profile.to_dict()}


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str):
    if not profile_manager.delete(profile_id):
        raise HTTPException(status_code=404, detail="配置不存在或为预设配置，无法删除")
    return {"status": True, "message": "配置已删除"}
