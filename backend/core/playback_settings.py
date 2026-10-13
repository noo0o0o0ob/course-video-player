# -*- coding: utf-8 -*-
from pydantic import BaseModel, Field


class PlaybackSettings(BaseModel):
    full_auto_mode: bool = False
    captcha_max_retries: int = Field(3, ge=1, le=10, strict=True)
    captcha_retry_interval: int = Field(1, ge=1, le=60, strict=True)
    chapter_interval: int = Field(3, ge=0, le=60, strict=True)
    report_retry_interval: int = Field(5, ge=1, le=60, strict=True)
    report_max_failures: int = Field(6, ge=1, le=20, strict=True)
    relogin_max_retries: int = Field(3, ge=1, le=10, strict=True)
    relogin_max_rounds: int = Field(3, ge=1, le=5, strict=True)
    relogin_retry_interval: int = Field(2, ge=1, le=60, strict=True)
    network_timeout: int = Field(20, ge=5, le=120, strict=True)
    login_page_timeout: int = Field(15, ge=5, le=120, strict=True)
    heartbeat_timeout: int = Field(10, ge=5, le=120, strict=True)
