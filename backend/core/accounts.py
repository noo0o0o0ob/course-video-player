# -*- coding: utf-8 -*-
import threading
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from core.events import manager
from core.player import AutoPlayer
from core.profiles import profile_manager


@dataclass
class AccountContext:
    account_id: str
    username: str
    player: AutoPlayer
    label: str | None = None
    profile_id: str | None = None
    platform_url: str | None = None
    thread: threading.Thread | None = None
    last_error: str | None = None
    courses_cache: list[dict[str, Any]] = field(default_factory=list)


class AccountManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._accounts: dict[str, AccountContext] = {}

    def _emit_account_event(self, account_id: str, event_type: str, payload: dict[str, Any]) -> None:
        account = self._accounts.get(account_id)
        manager.emit(
            event_type,
            account_id=account_id,
            account_username=account.username if account else None,
            **payload,
        )

    def _public_account(self, account: AccountContext) -> dict[str, Any]:
        session = account.player.session_info()
        thread_alive = bool(account.thread and account.thread.is_alive())
        return {
            "account_id": account.account_id,
            "username": account.username,
            "label": account.label,
            "profile_id": account.profile_id,
            "platform_url": account.platform_url,
            "logged_in": session.get("logged_in", False),
            "user": session.get("user"),
            "is_playing": session.get("is_playing", False),
            "thread_alive": thread_alive,
            "status": account.player.status.copy(),
            "last_error": account.last_error,
            "course_count": len(account.courses_cache),
        }

    def login(self, username: str, password: str, label: str | None = None, profile_id: str | None = None, platform_url: str | None = None) -> dict[str, Any]:
        account_id = uuid4().hex[:12]

        def emit(event_type: str, payload: dict[str, Any]) -> None:
            self._emit_account_event(account_id, event_type, payload)

        profile_data = None
        if profile_id:
            profile = profile_manager.get(profile_id)
            if profile:
                profile_data = profile.to_dict()

        player = AutoPlayer(event_callback=emit, profile=profile_data, platform_url=platform_url)
        account = AccountContext(
            account_id=account_id,
            username=username,
            label=label,
            profile_id=profile_id,
            platform_url=platform_url,
            player=player,
        )

        with self._lock:
            self._accounts[account_id] = account

        try:
            result = player.login(username, password)
        except Exception as exc:
            with self._lock:
                self._accounts.pop(account_id, None)
            raise exc

        if not result.get("status"):
            with self._lock:
                self._accounts.pop(account_id, None)
            return result

        manager.emit(
            "account",
            account_id=account_id,
            account_username=username,
            message=f"账号 {username} 已加入账号池",
        )
        return {"status": True, "account": self._public_account(account), "user": result.get("user")}

    def list_accounts(self) -> list[dict[str, Any]]:
        with self._lock:
            return [self._public_account(account) for account in self._accounts.values()]

    def get_account(self, account_id: str) -> AccountContext:
        with self._lock:
            account = self._accounts.get(account_id)
            if not account:
                raise RuntimeError("账号不存在")
            return account

    def remove(self, account_id: str) -> dict[str, Any]:
        with self._lock:
            account = self._accounts.pop(account_id, None)
        if not account:
            return {"status": False, "message": "账号不存在"}
        account.player.stop()
        return {"status": True, "message": "账号已移除"}

    def get_courses(self, account_id: str) -> list[dict[str, Any]]:
        account = self.get_account(account_id)
        courses = account.player.get_courses()
        account.courses_cache = courses
        return courses

    def get_chapters(self, account_id: str, course_id: str) -> list[dict[str, Any]]:
        account = self.get_account(account_id)
        return account.player.get_chapters(course_id)

    def get_progress(self, account_id: str, course_id: str) -> dict[str, Any]:
        account = self.get_account(account_id)
        return account.player.get_user_progress(course_id)

    def get_course_snapshot(self, account_id: str, course_id: str) -> dict[str, Any]:
        account = self.get_account(account_id)
        chapters = account.player.get_chapters(course_id)
        completed = 0
        for chapter in chapters:
            try:
                state = account.player.get_study_state(str(chapter["node_id"]))
            except Exception as exc:
                state = 0
                chapter["state_error"] = str(exc)
            chapter["study_state"] = state
            if state == 2:
                completed += 1

        progress = account.player.get_user_progress(course_id)
        if chapters and not progress.get("progress"):
            progress = {
                **progress,
                "progress": round(completed * 100 / len(chapters), 1),
            }
        return {
            "chapters": chapters,
            "progress": {
                **progress,
                "completed": progress.get("completed") or completed,
                "total": len(chapters),
            },
        }

    def start(self, account_id: str, course_id: str) -> dict[str, Any]:
        account = self.get_account(account_id)
        with self._lock:
            if account.thread and account.thread.is_alive():
                return {"status": False, "message": "该账号已有播放任务正在运行"}
            if account.player.is_playing:
                return {"status": False, "message": "该账号已有播放任务正在运行"}

            account.player.stop_flag = False
            account.last_error = None
            account.thread = threading.Thread(
                target=account.player.play_all,
                args=(course_id,),
                daemon=True,
                name=f"course-playback-{account_id}",
            )
            account.thread.start()

        return {
            "status": True,
            "message": f"账号 {account.username} 的播放任务已启动",
            "account_id": account_id,
            "course_id": course_id,
        }

    def start_all(self, course_id: str) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        with self._lock:
            account_ids = list(self._accounts)
        for account_id in account_ids:
            account = self.get_account(account_id)
            if not account.player.token:
                results.append(
                    {
                        "account_id": account_id,
                        "username": account.username,
                        "status": False,
                        "message": "账号未登录",
                    }
                )
                continue
            result = self.start(account_id, course_id)
            results.append(
                {
                    "account_id": account_id,
                    "username": account.username,
                    **result,
                }
            )
        started = sum(1 for item in results if item.get("status"))
        return {
            "status": started > 0,
            "message": f"已启动 {started}/{len(results)} 个账号的播放任务",
            "course_id": course_id,
            "results": results,
        }

    def stop(self, account_id: str) -> dict[str, Any]:
        account = self.get_account(account_id)
        account.player.stop()
        return {"status": True, "message": f"账号 {account.username} 已发送停止指令"}

    def stop_all(self) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        with self._lock:
            account_ids = list(self._accounts)
        for account_id in account_ids:
            account = self.get_account(account_id)
            result = self.stop(account_id)
            results.append(
                {
                    "account_id": account_id,
                    "username": account.username,
                    **result,
                }
            )
        return {
            "status": True,
            "message": f"已向 {len(results)} 个账号发送停止指令",
            "results": results,
        }

    def status(self, account_id: str) -> dict[str, Any]:
        account = self.get_account(account_id)
        return {"status": True, **self._public_account(account)}


account_manager = AccountManager()
