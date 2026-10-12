# -*- coding: utf-8 -*-
import html as html_lib
import json
import re
import time
from collections.abc import Callable
from typing import Any

import requests

try:
    import ddddocr

    HAS_OCR = True
except ImportError:
    ddddocr = None
    HAS_OCR = False


DEFAULT_BASE_URL = "https://cqcst.tuozhikj.com"
DEFAULT_INTERVAL_SECONDS = 30


EventCallback = Callable[[str, dict[str, Any]], None]


class SessionExpiredError(RuntimeError):
    """Raised when the platform says the current login session is no longer valid."""


class AutoPlayer:
    def __init__(self, event_callback: EventCallback | None = None, profile: dict[str, Any] | None = None, platform_url: str | None = None) -> None:
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.proxies = {}
        self.profile = profile or {}
        self.base_url = platform_url or self.profile.get("platform_url") or DEFAULT_BASE_URL
        self.session.headers.update(
            {
                "User-Agent": self.profile.get("user_agent") or (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "*/*",
                "Accept-Language": self.profile.get("accept_language") or "zh-CN,zh;q=0.9,en;q=0.8",
            }
        )
        if self.profile.get("cookie"):
            for item in self.profile["cookie"].split(";"):
                item = item.strip()
                if "=" in item:
                    key, value = item.split("=", 1)
                    self.session.cookies.set(key.strip(), value.strip(), domain=self._cookie_domain())
        self.ocr = ddddocr.DdddOcr(show_ad=False) if HAS_OCR else None
        self.event_callback = event_callback
        self.token: str | None = None
        self.username: str | None = None
        self.password: str | None = None
        self.user_info: dict[str, Any] | None = None
        self.duration_cache: dict[str, int] = {}
        self.is_playing = False
        self.stop_flag = False
        self.status: dict[str, Any] = {
            "is_playing": False,
            "is_stopping": False,
            "course_id": None,
            "current_node_id": None,
            "current_node_name": None,
            "current_index": 0,
            "total_nodes": 0,
            "current_video_progress": 0,
            "total_progress": 0,
            "message": "idle",
        }

    @staticmethod
    def public_user_info(user_info: dict[str, Any] | None) -> dict[str, Any] | None:
        if user_info is None:
            return None
        return {key: value for key, value in user_info.items() if key.lower() != "token"}

    def _cookie_domain(self) -> str:
        parsed = re.search(r"https?://([^/]+)", self.base_url)
        if parsed:
            domain = parsed.group(1)
            if domain.startswith("www."):
                domain = domain[4:]
            if "." in domain:
                return "." + domain.split(".", 1)[1]
        return ".cqcst.tuozhikj.com"

    def _ensure_base_url(self) -> str:
        return self.base_url

    def emit(self, event_type: str, **payload: Any) -> None:
        if self.event_callback:
            self.event_callback(event_type, payload)

    def log(self, message: str, level: str = "info", **extra: Any) -> None:
        self.emit("log", level=level, message=message, **extra)

    def update_status(self, **updates: Any) -> dict[str, Any]:
        self.status.update(updates)
        self.emit("status", **self.status)
        return self.status.copy()

    @staticmethod
    def response_message(response: dict[str, Any]) -> str:
        for key in ("msg", "message", "detail", "error"):
            value = response.get(key)
            if value:
                return str(value)
        return json.dumps(response, ensure_ascii=False)[:160]

    @staticmethod
    def parse_duration_from_text(text: str) -> int:
        clock_match = re.search(r"\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b", text)
        if clock_match:
            hours = int(clock_match.group(1) or 0)
            minutes = int(clock_match.group(2))
            seconds = int(clock_match.group(3))
            return hours * 3600 + minutes * 60 + seconds
        minute_match = re.search(r"[（(]\s*(\d+)\s*分钟\s*[）)]", text)
        if minute_match:
            return int(minute_match.group(1)) * 60
        time_match = re.search(r"(\d+)\s*分(?:钟)?\s*(?:(\d+)\s*秒)?", text)
        if time_match:
            minutes = int(time_match.group(1))
            seconds = int(time_match.group(2) or 0)
            return minutes * 60 + seconds
        seconds_match = re.search(r"(\d+)\s*秒", text)
        if seconds_match:
            return int(seconds_match.group(1))
        return 0

    @staticmethod
    def clean_html_text(value: str) -> str:
        text = re.sub(r"<[^>]+>", "", value)
        text = html_lib.unescape(text)
        return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def response_text_for_parse(text: str) -> str:
        normalized = text.strip().lstrip("\ufeff").replace("\\/", "/")
        if not normalized:
            return ""
        try:
            data = json.loads(normalized)
        except json.JSONDecodeError:
            return normalized

        parts: list[str] = []

        def collect(value: Any) -> None:
            if isinstance(value, str):
                parts.append(value)
            elif isinstance(value, dict):
                for item in value.values():
                    collect(item)
            elif isinstance(value, list):
                for item in value:
                    collect(item)

        collect(data)
        return "\n".join(parts).replace("\\/", "/") or normalized

    def parse_study_record_rows(self, text: str) -> dict[str, int]:
        html = self.response_text_for_parse(text)
        durations: dict[str, int] = {}
        for row_match in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S | re.I):
            row_html = row_match.group(1)
            node_match = re.search(r"nodeId=(\d+)", row_html)
            if not node_match:
                continue
            node_id = node_match.group(1)
            cells = [
                self.clean_html_text(cell)
                for cell in re.findall(r"<td[^>]*>(.*?)</td>", row_html, flags=re.S | re.I)
            ]
            if len(cells) >= 6:
                duration = self.parse_duration_from_text(cells[5])
            else:
                duration = self.parse_duration_from_text(row_html)
            if duration:
                durations[node_id] = duration
        return durations

    def get_study_record_durations(self, course_id: str, max_pages: int = 10) -> dict[str, int]:
        durations: dict[str, int] = {}
        next_pages = {1}
        visited: set[int] = set()

        while next_pages and len(visited) < max_pages:
            page = min(next_pages - visited)
            visited.add(page)
            response = self.session.get(
                f"{self.base_url}/user/study_record.json?courseId={course_id}&page={page}",
                headers={
                    "Referer": f"{self.base_url}/user/study_record?courseId={course_id}",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=20,
            )
            response.raise_for_status()
            parsed_text = self.response_text_for_parse(response.text)
            durations.update(self.parse_study_record_rows(response.text))
            for match in re.finditer(r"study_record\.json\?courseId=\d+&page=(\d+)", parsed_text):
                page_number = int(match.group(1))
                if 1 <= page_number <= max_pages:
                    next_pages.add(page_number)
            page_count_match = re.search(r"页次[：:]\s*\d+\s*/\s*(\d+)", parsed_text)
            if page_count_match:
                page_count = min(int(page_count_match.group(1)), max_pages)
                next_pages.update(range(1, page_count + 1))

        for node_id, duration in durations.items():
            self.duration_cache[node_id] = duration
        return durations

    @staticmethod
    def is_session_expired_message(message: str) -> bool:
        return any(
            marker in message
            for marker in (
                "登录超时",
                "请重新登录",
                "重新登陆",
                "login timeout",
                "session expired",
                "not logged in",
            )
        )

    def handle_session_expired(self, message: str, node_id: str | None = None) -> None:
        self.token = None
        self.stop_flag = True
        self.log(message, level="error", node_id=node_id)
        self.emit("error", message=message, node_id=node_id, reason="session_expired")
        self.update_status(
            is_playing=False,
            is_stopping=False,
            message="登录已失效，请重新登录后继续",
        )
        raise SessionExpiredError(message)

    def require_login(self) -> None:
        if not self.token:
            raise RuntimeError("尚未登录")

    def login(self, username: str, password: str) -> dict[str, Any]:
        self.username = username
        self.password = password
        self.log("正在登录")
        self.session.get(f"{self.base_url}/user/login", timeout=15)
        x_requested_with = self.profile.get("x_requested_with") or "XMLHttpRequest"
        response = self.session.post(
            f"{self.base_url}/api/login",
            data={"username": username, "password": password, "remember": "on"},
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": self.profile.get("referer") or f"{self.base_url}/user/login",
                "X-Requested-With": x_requested_with,
            },
            timeout=20,
        )
        response.raise_for_status()
        data = json.loads(response.text.lstrip("\ufeff"))

        if data.get("status"):
            user_info = data.get("result", {}).get("data", {})
            self.token = user_info.get("token")
            self.user_info = user_info
            if self.token:
                self.session.cookies.set(
                    "token", self.token, domain=self._cookie_domain(), path="/"
                )
            self.log("登录成功", user=self.public_user_info(user_info))
            return {"status": True, "user": self.public_user_info(user_info)}

        message = data.get("msg") or data.get("message") or "登录失败"
        self.log(f"登录失败: {message}", level="error")
        return {"status": False, "message": message}

    def relogin(self, max_retries: int = 3) -> bool:
        if not self.username or not self.password:
            self.log("无法自动重新登录：缺少账号或密码", level="error")
            return False

        for attempt in range(1, max_retries + 1):
            if self.stop_flag:
                return False
            self.log(f"登录超时，正在自动重新登录 ({attempt}/{max_retries})", level="warning")
            try:
                result = self.login(self.username, self.password)
            except Exception as exc:
                self.log(f"自动重新登录失败: {exc}", level="error")
                result = {"status": False, "message": str(exc)}

            if result.get("status"):
                self.log("自动重新登录成功，继续当前节点")
                return True

            message = self.response_message(result)
            self.log(f"自动重新登录失败: {message}", level="error")
            self.interruptible_sleep(2)

        return False

    def session_info(self) -> dict[str, Any]:
        return {
            "logged_in": bool(self.token),
            "username": self.username,
            "user": self.public_user_info(self.user_info),
            "is_playing": self.is_playing,
        }

    def get_courses(self) -> list[dict[str, Any]]:
        self.require_login()
        if self.token:
            self.session.cookies.set(
                "token", self.token, domain=".cqcst.tuozhikj.com", path="/"
            )
        self.log("正在获取课程列表")

        for attempt in range(3):
            response = self.session.get(
                f"{self.base_url}/user",
                headers={"Referer": f"{self.base_url}/user/login"},
                timeout=20,
            )
            response.raise_for_status()
            html = response.text
            if html.lstrip().startswith("{"):
                self.log(f"课程页面返回异常，正在重试 {attempt + 1}/3", level="warning")
                time.sleep(1)
                continue

            course_ids = re.findall(r'href="/user/course\?courseId=(\d+)"', html)
            name_matches = re.findall(
                r'<div class="name"><a href="/user/course\?courseId=(\d+)">(.*?)</a></div>',
                html,
                flags=re.S,
            )
            name_map = {
                course_id: re.sub(r"\s+", " ", name).strip()
                for course_id, name in name_matches
            }

            courses: list[dict[str, Any]] = []
            seen: set[str] = set()
            for course_id in course_ids:
                if course_id in seen:
                    continue
                seen.add(course_id)
                courses.append(
                    {
                        "course_id": course_id,
                        "id": course_id,
                        "name": name_map.get(course_id, f"课程 {course_id}"),
                    }
                )

            self.log(f"找到 {len(courses)} 门课程", count=len(courses))
            return courses

        self.log("课程列表获取失败", level="error")
        return []

    def get_chapters(self, course_id: str) -> list[dict[str, Any]]:
        self.require_login()
        self.log("正在获取章节列表", course_id=course_id)
        response = self.session.get(
            f"{self.base_url}/user/course/chapter?courseId={course_id}",
            headers={"Referer": f"{self.base_url}/user/course?courseId={course_id}"},
            timeout=20,
        )
        response.raise_for_status()
        html = response.text
        try:
            record_durations = self.get_study_record_durations(course_id)
            if record_durations:
                self.log(f"已从视频记录读取 {len(record_durations)} 个真实时长", course_id=course_id)
        except Exception as exc:
            record_durations = {}
            self.log(f"视频记录时长读取失败，将使用节点页面时长: {exc}", level="warning")

        matches = list(re.finditer(r'href="/user/node\?nodeId=(\d+)"[^>]*>([^<]+)</a>', html))
        skip_names = {"继续学习", "开始学习", "学习中"}
        node_names: dict[str, str] = {}

        for match in matches:
            node_id, name = match.groups()
            clean_name = re.sub(r"\s+", " ", name).strip()
            if not clean_name or "img" in clean_name.lower() or "ncoursecon" in clean_name:
                continue
            if clean_name not in skip_names:
                node_names[node_id] = clean_name

        chapters: list[dict[str, Any]] = []
        seen_nodes: set[str] = set()
        for index, match in enumerate(matches):
            node_id, name = match.groups()
            clean_name = re.sub(r"\s+", " ", name).strip()
            if node_id in seen_nodes:
                continue
            if not clean_name or "img" in clean_name.lower() or "ncoursecon" in clean_name:
                continue
            if clean_name in skip_names:
                continue
            seen_nodes.add(node_id)
            next_start = matches[index + 1].start() if index + 1 < len(matches) else len(html)
            nearby_html = html[match.end():next_start]
            duration = record_durations.get(node_id, 0) or self.parse_duration_from_text(nearby_html)
            if not duration:
                duration = self.get_cached_video_duration(node_id)
            if not duration:
                self.log("跳过非视频节点", level="warning", node_id=node_id, name=node_names.get(node_id, clean_name))
                continue
            chapters.append(
                {
                    "node_id": node_id,
                    "id": node_id,
                    "name": node_names.get(node_id, clean_name),
                    "duration": duration,
                }
            )

        self.log(
            f"找到 {len(chapters)} 个视频节点",
            course_id=course_id,
            count=len(chapters),
        )
        return chapters

    def get_cached_video_duration(self, node_id: str) -> int:
        if node_id in self.duration_cache:
            return self.duration_cache[node_id]
        try:
            duration = self.get_video_duration(node_id)
        except Exception as exc:
            self.log(f"视频时长获取失败: {exc}", level="warning", node_id=node_id)
            duration = 0
        self.duration_cache[node_id] = duration
        return duration

    def get_video_duration(self, node_id: str) -> int:
        response = self.session.get(f"{self.base_url}/user/node?nodeId={node_id}", timeout=20)
        response.raise_for_status()
        match = re.search(
            r"""<input\b(?=[^>]*\bid=["']video-duration["'])[^>]*\bvalue=["']([^"']*)["']""",
            response.text,
            flags=re.I,
        )
        if match:
            return int(match.group(1))
        match = re.search(r'"duration"\s*:\s*(\d+)', response.text)
        if match:
            return int(match.group(1))
        return 0

    @staticmethod
    def parse_study_state_from_html(text: str) -> int | None:
        match = re.search(
            r"""<input\b(?=[^>]*\bid=["']study-state["'])[^>]*\bvalue=["']([^"']*)["']""",
            text,
            flags=re.I,
        )
        if match:
            return int(match.group(1))
        match = re.search(r"""["']study-state["']\s*:\s*["']?(\d+)""", text)
        if match:
            return int(match.group(1))
        return None

    @staticmethod
    def looks_like_video_node(text: str) -> bool:
        return bool(re.search(r"""\bid=["'](?:study-state|video-duration|video-file)["']""", text, flags=re.I))

    def get_study_state(self, node_id: str) -> int:
        response = self.session.get(f"{self.base_url}/user/node?nodeId={node_id}", timeout=20)
        response.raise_for_status()
        state = self.parse_study_state_from_html(response.text)
        if state is not None:
            return state
        if not self.looks_like_video_node(response.text):
            self.log("非视频节点无学习状态，已跳过", level="warning", node_id=node_id)
            return 2
        return 0

    def get_user_progress(self, course_id: str) -> dict[str, Any]:
        response = self.session.get(
            f"{self.base_url}/user/course?courseId={course_id}", timeout=20
        )
        response.raise_for_status()
        html = response.text
        progress_match = re.search(r"学习进度[：:]\s*(\d+\.?\d*)%", html)
        completed_match = re.search(r"已完成\s*(\d+)", html)
        return {
            "progress": float(progress_match.group(1)) if progress_match else 0,
            "completed": int(completed_match.group(1)) if completed_match else 0,
        }

    def get_captcha(self) -> bytes:
        response = self.session.get(f"{self.base_url}/service/code?r={time.time()}", timeout=20)
        response.raise_for_status()
        return response.content

    def solve_captcha(self, image_bytes: bytes) -> str | None:
        if not self.ocr:
            self.log("未安装 ddddocr，无法自动识别验证码", level="error")
            return None
        try:
            return self.ocr.classification(image_bytes).upper()
        except Exception as exc:
            self.log(f"验证码识别失败: {exc}", level="error")
            return None

    def report_time(
        self, node_id: str, study_time: int, study_id: int | str = 0, code: str | None = None
    ) -> dict[str, Any]:
        data: dict[str, Any] = {
            "nodeId": node_id,
            "studyId": study_id,
            "studyTime": study_time,
        }
        if code:
            data["code"] = code

        x_requested_with = self.profile.get("x_requested_with") or "XMLHttpRequest"
        response = self.session.post(
            f"{self.base_url}/user/node/study",
            data=data,
            headers={
                "Referer": self.profile.get("referer") or f"{self.base_url}/user/node?nodeId={node_id}",
                "X-Requested-With": x_requested_with,
            },
            timeout=20,
        )
        response.raise_for_status()
        text = response.text.strip().lstrip("\ufeff")
        if not text:
            return {"status": True, "msg": "服务器返回为空"}
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"status": False, "msg": f"服务器返回解析失败: {text[:80]}"}

    def send_heartbeat(self) -> bool:
        try:
            x_requested_with = self.profile.get("x_requested_with") or "XMLHttpRequest"
            response = self.session.post(
                f"{self.base_url}/user/online",
                headers={"X-Requested-With": x_requested_with},
                timeout=10,
            )
            return response.status_code == 200
        except Exception:
            return False

    def handle_captcha(
        self, node_id: str, study_id: int | str = 0, current_time: int = 0, max_retries: int = 3
    ) -> dict[str, Any]:
        for attempt in range(max_retries):
            if self.stop_flag:
                return {"status": False, "msg": "已停止"}
            self.log(
                f"需要验证码，正在尝试识别 {attempt + 1}/{max_retries}",
                level="warning",
                node_id=node_id,
            )
            image_bytes = self.get_captcha()
            code = self.solve_captcha(image_bytes)
            if not code:
                time.sleep(2)
                continue
            response = self.report_time(node_id, current_time, study_id, code=code)
            if response.get("status"):
                self.log("验证码提交成功", node_id=node_id)
                return response
            message = self.response_message(response)
            if "验证码" in message or "code" in message.lower():
                self.log(f"验证码被拒绝: {message}", level="warning", node_id=node_id)
                time.sleep(1)
                continue
            return response
        return {"status": False, "msg": "验证码重试次数已用完"}

    def interruptible_sleep(self, seconds: int) -> None:
        for _ in range(seconds):
            if self.stop_flag:
                break
            time.sleep(1)

    def find_start_index(self, videos: list[dict[str, Any]]) -> int:
        self.log("正在检查服务器端学习进度")
        for index, video in enumerate(videos):
            if self.stop_flag:
                return index
            state = self.get_study_state(str(video["node_id"]))
            video["state"] = state
            if state == 2:
                self.log("已完成，跳过该节点", node_id=video["node_id"], name=video["name"])
                continue
            if state == 1:
                self.log("继续未完成节点", node_id=video["node_id"], name=video["name"])
            else:
                self.log("开始未学习节点", node_id=video["node_id"], name=video["name"])
            return index
        return len(videos)

    def play_video(
        self, node_id: str, name: str, duration: int, index: int, total: int
    ) -> bool:
        self.update_status(
            current_node_id=node_id,
            current_node_name=name,
            current_index=index + 1,
            total_nodes=total,
            current_video_progress=0,
            total_progress=int(index * 100 / total) if total else 0,
            message=f"正在播放 {name}",
        )
        self.log(f"正在播放节点 {index + 1}/{total}: {name}", node_id=node_id)

        state = self.get_study_state(node_id)
        if state == 2:
            self.log("节点已完成，跳过", node_id=node_id, name=name)
            self.update_status(
                current_video_progress=100,
                total_progress=int((index + 1) * 100 / total) if total else 100,
            )
            return True

        study_id: int | str = 0
        total_reported = 0
        error_count = 0
        duration = max(duration, DEFAULT_INTERVAL_SECONDS)

        while total_reported < duration:
            if self.stop_flag:
                self.log("收到停止请求", node_id=node_id)
                return False

            total_reported = min(total_reported + DEFAULT_INTERVAL_SECONDS, duration)
            try:
                response = self.report_time(node_id, total_reported, study_id)
                self.send_heartbeat()
            except Exception as exc:
                error_count += 1
                self.log(f"网络错误: {exc}", level="error", node_id=node_id)
                if error_count > 5:
                    self.log("网络错误次数过多，跳过该节点", level="error", node_id=node_id)
                    return False
                self.interruptible_sleep(5)
                continue

            if response.get("status"):
                new_study_id = response.get("studyId")
                if new_study_id and new_study_id != study_id:
                    study_id = new_study_id
                error_count = 0
                video_progress = int(total_reported * 100 / duration)
                total_progress = int((index + (video_progress / 100)) * 100 / total) if total else 0
                self.update_status(
                    current_video_progress=video_progress,
                    total_progress=total_progress,
                    message=f"{name}: {video_progress}%",
                )
                self.emit(
                    "progress",
                    node_id=node_id,
                    node_name=name,
                    current_video_progress=video_progress,
                    total_progress=total_progress,
                    reported_seconds=total_reported,
                    duration=duration,
                    current_index=index + 1,
                    total_nodes=total,
                )
                if response.get("need_code"):
                    captcha_response = self.handle_captcha(node_id, study_id, total_reported)
                    if captcha_response.get("status"):
                        study_id = captcha_response.get("studyId", study_id)
                    else:
                        self.log(
                            f"验证码处理失败: {captcha_response.get('msg')}",
                            level="error",
                            node_id=node_id,
                        )
                        self.interruptible_sleep(10)
                        continue
            else:
                error_count += 1
                if response.get("need_code"):
                    captcha_response = self.handle_captcha(node_id, study_id, total_reported)
                    if captcha_response.get("status"):
                        study_id = captcha_response.get("studyId", study_id)
                        continue
                message = self.response_message(response)
                if self.is_session_expired_message(message):
                    if self.relogin(max_retries=3):
                        total_reported = max(0, total_reported - DEFAULT_INTERVAL_SECONDS)
                        error_count = 0
                        continue
                    self.handle_session_expired(
                        f"{message}；自动重新登录 3 次失败，已暂停播放",
                        node_id=node_id,
                    )
                if "已完成" in message:
                    self.log(message, node_id=node_id)
                    return True
                self.log(f"学习时长上报失败: {message}", level="error", node_id=node_id)
                if error_count > 5:
                    return False
                self.interruptible_sleep(5)
                continue

            self.interruptible_sleep(DEFAULT_INTERVAL_SECONDS)

        self.log("节点已完成", node_id=node_id, name=name)
        return True

    def play_all(self, course_id: str) -> None:
        self.require_login()
        self.stop_flag = False
        self.is_playing = True
        self.update_status(
            is_playing=True,
            is_stopping=False,
            course_id=course_id,
            message="正在启动",
        )
        try:
            videos = self.get_chapters(course_id)
            self.update_status(total_nodes=len(videos), total_progress=0)
            if not videos:
                self.log("未找到视频节点", level="warning", course_id=course_id)
                return

            start_index = self.find_start_index(videos)
            if start_index >= len(videos):
                self.log("全部节点都已完成", course_id=course_id)
                self.update_status(current_video_progress=100, total_progress=100)
                return

            for index in range(start_index, len(videos)):
                if self.stop_flag:
                    break
                video = videos[index]
                duration = self.get_cached_video_duration(str(video["node_id"]))
                if duration > 0:
                    video["duration"] = duration
                success = self.play_video(
                    str(video["node_id"]),
                    str(video["name"]),
                    int(video.get("duration") or 300),
                    index,
                    len(videos),
                )
                if not success and not self.stop_flag:
                    self.log("节点播放失败，继续下一个节点", level="warning")
                if index < len(videos) - 1:
                    self.interruptible_sleep(3)

            if self.stop_flag:
                self.log("播放已停止")
                self.update_status(message="已停止")
            else:
                self.log("播放已完成")
                self.update_status(current_video_progress=100, total_progress=100, message="已完成")
        except SessionExpiredError as exc:
            self.log("登录已过期，播放已暂停", level="error")
            self.update_status(message=str(exc))
        except Exception as exc:
            self.log(f"播放异常退出: {exc}", level="error")
            self.emit("error", message=str(exc))
            self.update_status(message="发生错误")
        finally:
            self.is_playing = False
            self.update_status(is_playing=False, is_stopping=False)

    def stop(self) -> None:
        self.stop_flag = True
        self.update_status(is_stopping=True, message="正在停止")
        self.log("正在停止播放")
