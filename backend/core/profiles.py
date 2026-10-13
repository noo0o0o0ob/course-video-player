# -*- coding: utf-8 -*-
import json
import os
import sys
import threading
import tempfile
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any
from uuid import uuid4
from core.secret_storage import PREFIX, protect_secret, recover_secret


def _get_profiles_path() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(os.environ.get("APPDATA", str(Path.home()))) / "CourseAutoPlayer"
        base.mkdir(parents=True, exist_ok=True)
        return base / "profiles.json"
    return Path(__file__).resolve().parent.parent / "profiles.json"


PROFILES_FILE = _get_profiles_path()

PRESET_TEMPLATES: dict[str, dict[str, str]] = {
    "chrome-win": {
        "name": "Chrome (Windows)",
        "description": "Chrome 120 on Windows 10/11",
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "accept_language": "zh-CN,zh;q=0.9,en;q=0.8",
        "x_requested_with": "XMLHttpRequest",
    },
    "chrome-mac": {
        "name": "Chrome (macOS)",
        "description": "Chrome 120 on macOS",
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "accept_language": "zh-CN,zh;q=0.9,en;q=0.8",
        "x_requested_with": "XMLHttpRequest",
    },
    "firefox-win": {
        "name": "Firefox (Windows)",
        "description": "Firefox 121 on Windows 10/11",
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) "
            "Gecko/20100101 Firefox/121.0"
        ),
        "accept_language": "zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3",
        "x_requested_with": "XMLHttpRequest",
    },
    "edge-win": {
        "name": "Edge (Windows)",
        "description": "Edge 120 on Windows 10/11",
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
        ),
        "accept_language": "zh-CN,zh;q=0.9,en;q=0.8",
        "x_requested_with": "XMLHttpRequest",
    },
    "safari-mac": {
        "name": "Safari (macOS)",
        "description": "Safari 17 on macOS",
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) "
            "Version/17.2 Safari/605.1.15"
        ),
        "accept_language": "zh-CN,zh;q=0.9",
        "x_requested_with": "XMLHttpRequest",
    },
    "mobile-android": {
        "name": "Mobile (Android)",
        "description": "Chrome Mobile on Android",
        "user_agent": (
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Mobile Safari/537.36"
        ),
        "accept_language": "zh-CN,zh;q=0.9,en;q=0.8",
        "x_requested_with": "XMLHttpRequest",
    },
}


@dataclass
class BrowserProfile:
    profile_id: str
    name: str
    description: str = ""
    user_agent: str = ""
    cookie: str = ""
    referer: str = ""
    accept_language: str = "zh-CN,zh;q=0.9,en;q=0.8"
    x_requested_with: str = "XMLHttpRequest"
    extra_headers: dict[str, str] = field(default_factory=dict)
    is_preset: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_request_headers(self, base_referer: str = "") -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.user_agent:
            headers["User-Agent"] = self.user_agent
        if self.accept_language:
            headers["Accept-Language"] = self.accept_language
        if self.x_requested_with:
            headers["X-Requested-With"] = self.x_requested_with
        referer = self.referer or base_referer
        if referer:
            headers["Referer"] = referer
        headers.update(self.extra_headers)
        return headers

    def to_cookie_dict(self) -> dict[str, str]:
        if not self.cookie:
            return {}
        cookies: dict[str, str] = {}
        for item in self.cookie.split(";"):
            item = item.strip()
            if "=" in item:
                key, value = item.split("=", 1)
                cookies[key.strip()] = value.strip()
        return cookies


class ProfileManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._profiles: dict[str, BrowserProfile] = {}
        self._load()

    def _load(self) -> None:
        if PROFILES_FILE.exists():
            try:
                data = json.loads(PROFILES_FILE.read_text(encoding="utf-8"))
                if not isinstance(data, list):
                    raise ValueError("配置文件格式不正确")
                loaded = {}
                migrate = False
                for item in data:
                    item = dict(item)
                    encrypted_headers = item.pop("encrypted_extra_headers", "")
                    if encrypted_headers:
                        item["extra_headers"] = json.loads(recover_secret(encrypted_headers))
                    elif item.get("extra_headers"):
                        migrate = True
                    cookie = item.get("cookie", "")
                    if cookie and not cookie.startswith(PREFIX):
                        migrate = True
                    item["cookie"] = recover_secret(cookie)
                    profile = BrowserProfile(**item)
                    loaded[profile.profile_id] = profile
                if migrate:
                    self._save(loaded)
                self._profiles = loaded
            except Exception:
                raise RuntimeError("本地浏览器配置无法读取，请检查配置文件和 Windows 用户") from None

    def _save(self, profiles: dict[str, BrowserProfile] | None = None) -> None:
        data = []
        for profile in (self._profiles if profiles is None else profiles).values():
            if profile.is_preset:
                continue
            item = profile.to_dict()
            item["cookie"] = protect_secret(profile.cookie)
            item["extra_headers"] = {}
            if profile.extra_headers:
                item["encrypted_extra_headers"] = protect_secret(json.dumps(profile.extra_headers, ensure_ascii=False))
            data.append(item)
        PROFILES_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".profiles-", suffix=".tmp", dir=PROFILES_FILE.parent, delete=False) as file:
                temporary = Path(file.name)
                json.dump(data, file, ensure_ascii=False, indent=2)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, PROFILES_FILE)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()

    def list_all(self) -> list[dict[str, Any]]:
        with self._lock:
            presets = [
                BrowserProfile(
                    profile_id=f"preset:{key}",
                    is_preset=True,
                    **template,
                ).to_dict()
                for key, template in PRESET_TEMPLATES.items()
            ]
            custom = [p.to_dict() for p in self._profiles.values() if not p.is_preset]
            return presets + custom

    def get(self, profile_id: str) -> BrowserProfile | None:
        with self._lock:
            if profile_id.startswith("preset:"):
                key = profile_id.removeprefix("preset:")
                template = PRESET_TEMPLATES.get(key)
                if template:
                    return BrowserProfile(
                        profile_id=profile_id,
                        is_preset=True,
                        **template,
                    )
                return None
            return self._profiles.get(profile_id)

    def create(
        self,
        name: str,
        description: str = "",
        user_agent: str = "",
        cookie: str = "",
        referer: str = "",
        accept_language: str = "zh-CN,zh;q=0.9,en;q=0.8",
        x_requested_with: str = "XMLHttpRequest",
        extra_headers: dict[str, str] | None = None,
    ) -> BrowserProfile:
        profile_id = uuid4().hex[:12]
        profile = BrowserProfile(
            profile_id=profile_id,
            name=name,
            description=description,
            user_agent=user_agent,
            cookie=cookie,
            referer=referer,
            accept_language=accept_language,
            x_requested_with=x_requested_with,
            extra_headers=extra_headers or {},
        )
        with self._lock:
            updated = {**self._profiles, profile_id: profile}
            self._save(updated)
            self._profiles = updated
        return profile

    def update(self, profile_id: str, **kwargs: Any) -> BrowserProfile | None:
        with self._lock:
            profile = self._profiles.get(profile_id)
            if not profile or profile.is_preset:
                return None
            changes = {key: value for key, value in kwargs.items() if key in BrowserProfile.__dataclass_fields__ and key not in {"profile_id", "is_preset"}}
            updated_profile = replace(profile, **changes)
            updated = {**self._profiles, profile_id: updated_profile}
            self._save(updated)
            self._profiles = updated
            return updated_profile

    def delete(self, profile_id: str) -> bool:
        with self._lock:
            if profile_id in self._profiles and not self._profiles[profile_id].is_preset:
                updated = {key: value for key, value in self._profiles.items() if key != profile_id}
                self._save(updated)
                self._profiles = updated
                return True
            return False


profile_manager = ProfileManager()
