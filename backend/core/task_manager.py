# -*- coding: utf-8 -*-
import threading
from typing import Any

from core.session import session_manager


class PlayTaskManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None

    def start(self, course_id: str) -> dict[str, Any]:
        with self._lock, session_manager._lock:
            player = session_manager.require_player()
            if self._thread and self._thread.is_alive():
                return {"status": False, "message": "播放任务正在运行"}
            if player.is_playing:
                return {"status": False, "message": "播放任务正在运行"}

            player.prepare_playback(course_id)
            self._thread = threading.Thread(
                target=player.play_all,
                args=(course_id,),
                daemon=True,
                name="course-playback",
            )
            self._thread.start()
            return {"status": True, "message": "播放任务已启动", "course_id": course_id}

    def stop(self) -> dict[str, Any]:
        player = session_manager.get_player()
        if not player:
            return {"status": False, "message": "尚未登录"}
        player.stop()
        return {"status": True, "message": "已发送停止指令"}

    def status(self) -> dict[str, Any]:
        player = session_manager.get_player()
        thread_alive = bool(self._thread and self._thread.is_alive())
        if not player:
            return {"status": True, "is_playing": False, "thread_alive": thread_alive}
        return {"status": True, **player.status.copy(), "thread_alive": thread_alive}


play_task_manager = PlayTaskManager()
