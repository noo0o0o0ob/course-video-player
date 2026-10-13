# -*- coding: utf-8 -*-
from threading import RLock
from typing import Any

from core.events import manager
from core.player import AutoPlayer
from core.errors import NotLoggedInError, TaskRunningError


class SessionManager:
    def __init__(self) -> None:
        self._lock = RLock()
        self._player: AutoPlayer | None = None

    def _emit_player_event(self, event_type: str, payload: dict[str, Any]) -> None:
        manager.emit(event_type, **payload)

    def get_or_create_player(self) -> AutoPlayer:
        with self._lock:
            if self._player is None:
                self._player = AutoPlayer(event_callback=self._emit_player_event)
            return self._player

    def get_player(self) -> AutoPlayer | None:
        with self._lock:
            return self._player

    def require_player(self) -> AutoPlayer:
        player = self.get_player()
        if player is None or not player.token:
            raise NotLoggedInError("尚未登录")
        return player

    def login(self, username: str, password: str) -> dict[str, Any]:
        with self._lock:
            player = self.get_or_create_player()
            if player.is_playing:
                raise TaskRunningError("播放任务运行中，停止任务后才能切换账号")
            return player.login(username, password)

    def session_info(self) -> dict[str, Any]:
        player = self.get_player()
        if not player:
            return {"logged_in": False, "username": None, "user": None, "is_playing": False}
        return player.session_info()


session_manager = SessionManager()
