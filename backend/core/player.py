# -*- coding: utf-8 -*-
import html as html_lib
import json
import re
import time
import threading
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit
from collections.abc import Callable
from typing import Any

import requests
from core.errors import NotLoggedInError, SessionExpiredError, safe_error_message

try:
    import ddddocr

    HAS_OCR = True
except ImportError:
    ddddocr = None
    HAS_OCR = False


DEFAULT_BASE_URL = "https://cqcst.tuozhikj.com"
DEFAULT_INTERVAL_SECONDS = 30


EventCallback = Callable[[str, dict[str, Any]], None]


class CoursePageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []
        self._anchor: dict[str, str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "a":
            self._anchor = {"href": dict(attrs).get("href", ""), "name": ""}

    def handle_data(self, data: str) -> None:
        if self._anchor is not None:
            self._anchor["name"] += data

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchor is not None:
            self.links.append(self._anchor)
            self._anchor = None


class AutoPlayer:
    def __init__(self, event_callback: EventCallback | None = None, profile: dict[str, Any] | None = None, platform_url: str | None = None) -> None:
        self._network_lock = threading.RLock()
        self._state_lock = threading.RLock()
        self._stop_event = threading.Event()
        self._sensitive_values: set[str] = set()
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.proxies = {}
        self.profile = profile or {}
        self.base_url = (platform_url or self.profile.get("platform_url") or DEFAULT_BASE_URL).rstrip("/")
        parsed_url = urlsplit(self.base_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname or parsed_url.username or parsed_url.password or parsed_url.query or parsed_url.fragment:
            raise ValueError("平台地址必须是不含凭据和查询参数的 HTTP 或 HTTPS 地址")
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
        for key, value in (self.profile.get("extra_headers") or {}).items():
            if key.lower() in {"host", "content-length"} or "\r" in key + value or "\n" in key + value:
                raise ValueError("自定义请求头格式不正确")
            self.session.headers[key] = value
            if value:
                self._sensitive_values.add(value)
                if key.lower() == "authorization" and " " in value:
                    self._sensitive_values.add(value.split(" ", 1)[1])
        if self.profile.get("cookie"):
            for item in self.profile["cookie"].split(";"):
                item = item.strip()
                if "=" in item:
                    key, value = item.split("=", 1)
                    self.session.cookies.set(key.strip(), value.strip(), domain=self._cookie_domain(), path="/", secure=parsed_url.scheme == "https")
                    self._sensitive_values.add(value.strip())
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
        def clean(value):
            if isinstance(value, dict):
                return {key: clean(item) for key, item in value.items() if not any(marker in re.sub(r"[^a-z0-9]", "", str(key).lower()) for marker in ("token", "password", "passwd", "secret", "cookie", "authorization", "credential", "sessionid", "apikey")) and str(key).lower() != "pwd"}
            if isinstance(value, list):
                return [clean(item) for item in value]
            return value
        return clean(user_info)

    def _cookie_domain(self) -> str:
        return urlsplit(self.base_url).hostname or ""

    @property
    def stop_flag(self) -> bool:
        return self._stop_event.is_set()

    @stop_flag.setter
    def stop_flag(self, value: bool) -> None:
        self._stop_event.set() if value else self._stop_event.clear()

    def _get(self, *args, **kwargs):
        with self._network_lock:
            return self.session.get(*args, **kwargs)

    def _post(self, *args, **kwargs):
        with self._network_lock:
            return self.session.post(*args, **kwargs)

    def _safe_text(self, message: str) -> str:
        for value in sorted(self._sensitive_values, key=len, reverse=True):
            if value:
                message = message.replace(value, "[已隐藏]")
        return message

    def _clear_auth(self) -> None:
        with self._network_lock, self._state_lock:
            self.token = None
            self.username = None
            self.password = None
            self.user_info = None
            self.duration_cache.clear()
            self.session.cookies.clear()

    def _invalidate_for_relogin(self) -> None:
        """清除失效会话，但保留内存中的凭据供当前播放任务重新登录。"""
        with self._network_lock, self._state_lock:
            self.token = None
            self.user_info = None
            self.duration_cache.clear()
            self.session.cookies.clear()
        self.emit("error", message="登录已失效，正在尝试重新登录", reason="session_expired")

    @classmethod
    def _response_is_session_expired(cls, response) -> bool:
        text = response.text
        path = urlsplit(response.url or "").path.lower()
        if response.status_code == 401 or "/user/login" in path or re.search(r"<input\b[^>]*\btype\s*=\s*['\"]?password", text, re.I):
            return True
        if text.lstrip().lstrip("\ufeff").startswith("{"):
            try:
                data = json.loads(text.lstrip("\ufeff"))
                return isinstance(data, dict) and cls.is_session_expired_message(cls.response_message(data))
            except json.JSONDecodeError:
                return False
        return False

    def _check_response(self, response) -> None:
        if self._response_is_session_expired(response):
            self.handle_session_expired("登录已失效，请重新登录")
        response.raise_for_status()

    def prepare_playback(self, course_id: str) -> None:
        self.require_login()
        self.stop_flag = False
        self.is_playing = True
        self.update_status(is_playing=True, is_stopping=False, course_id=course_id, current_node_id=None, current_node_name=None, current_index=0, total_nodes=0, current_video_progress=0, total_progress=0, failed_nodes=0, completed_nodes=0, message="正在启动")

    def _ensure_base_url(self) -> str:
        return self.base_url

    def emit(self, event_type: str, **payload: Any) -> None:
        if self.event_callback:
            self.event_callback(event_type, payload)

    def log(self, message: str, level: str = "info", **extra: Any) -> None:
        extra.pop("user", None)
        self.emit("log", level=level, message=self._safe_text(message), **self.public_user_info(extra))

    def update_status(self, **updates: Any) -> dict[str, Any]:
        with self._state_lock:
            self.status.update(updates)
            snapshot = self.status.copy()
        self.emit("status", **snapshot)
        return snapshot

    @staticmethod
    def response_message(response: dict[str, Any]) -> str:
        for key in ("msg", "message", "detail", "error"):
            value = response.get(key)
            if value:
                return str(value)
        return "平台请求未成功"

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

        while next_pages - visited and len(visited) < max_pages:
            page = min(next_pages - visited)
            visited.add(page)
            response = self._get(
                f"{self.base_url}/user/study_record.json?courseId={course_id}&page={page}",
                headers={
                    "Referer": f"{self.base_url}/user/study_record?courseId={course_id}",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=20,
            )
            self._check_response(response)
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
                "登录已失效",
                "login timeout",
                "session expired",
                "not logged in",
            )
        )

    def handle_session_expired(self, message: str, node_id: str | None = None) -> None:
        self._clear_auth()
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
            raise NotLoggedInError("尚未登录")

    def login(self, username: str, password: str) -> dict[str, Any]:
        with self._network_lock:
            self._sensitive_values.update(value for value in (username, password, self.token) if value)
            self._clear_auth()
            for item in (self.profile.get("cookie") or "").split(";"):
                if "=" in item:
                    key, value = item.strip().split("=", 1)
                    self.session.cookies.set(key.strip(), value.strip(), domain=self._cookie_domain(), path="/", secure=self.base_url.startswith("https:"))
            self.log("正在登录")
            self._get(f"{self.base_url}/user/login", timeout=15).raise_for_status()
            response = self._post(
                f"{self.base_url}/api/login",
                data={"username": username, "password": password, "remember": "on"},
                headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": self.profile.get("referer") or f"{self.base_url}/user/login", "X-Requested-With": self.profile.get("x_requested_with") or "XMLHttpRequest"},
                timeout=20,
            )
            response.raise_for_status()
            data = json.loads(response.text.lstrip("\ufeff"))
            if not isinstance(data, dict):
                raise ValueError("登录响应格式不正确")
            if data.get("status") in (True, 1):
                result = data.get("result") or {}
                user_info = result.get("data") if isinstance(result, dict) else None
                token = user_info.get("token") if isinstance(user_info, dict) else None
                if not isinstance(token, str) or not token.strip():
                    self._clear_auth()
                    self.log("登录响应缺少有效令牌", level="error")
                    return {"status": False, "message": "登录响应缺少有效令牌，请重新登录"}
                with self._state_lock:
                    self.username, self.password = username, password
                    self.token, self.user_info = token, user_info
                self._sensitive_values.add(token)
                self.session.cookies.set("token", token, domain=self._cookie_domain(), path="/", secure=self.base_url.startswith("https:"))
                self.log("登录成功")
                self.emit("session", logged_in=True)
                return {"status": True, "user": self.public_user_info(user_info)}
            message = self._safe_text(self.response_message(data))
            self._clear_auth()
            self.log(f"登录失败: {message}", level="error")
            return {"status": False, "message": message}

    def relogin(self, max_retries: int = 3) -> bool:
        if not self.username or not self.password:
            self.log("无法自动重新登录：缺少账号或密码", level="error")
            return False

        username, password = self.username, self.password
        for attempt in range(1, max_retries + 1):
            if self.stop_flag:
                return False
            self.log(f"登录超时，正在自动重新登录 ({attempt}/{max_retries})", level="warning")
            try:
                result = self.login(username, password)
            except Exception as exc:
                self.log(safe_error_message(exc), level="error")
                result = {"status": False, "message": safe_error_message(exc)}

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

    def get_courses(self, kind: str = "all") -> list[dict[str, Any]]:
        self.require_login()
        if kind not in {"all", "current", "finish"}:
            raise ValueError("课程状态不正确")
        self.log("正在获取课程列表")
        def read_page(url):
            for attempt in range(3):
                response = self._get(url, headers={"Referer": f"{self.base_url}/user"}, timeout=20)
                self._check_response(response)
                if response.text.lstrip().lstrip("\ufeff").startswith("{"):
                    self.log("课程页面返回异常，正在重试", level="warning")
                    self.interruptible_sleep(1)
                    continue
                parser = CoursePageParser()
                parser.feed(response.text)
                return parser
            raise ValueError("无法读取课程列表页面")

        current = read_page(f"{self.base_url}/user")
        pages = [("current", current)] if kind != "finish" else []
        ended_url = None
        for link in current.links:
            target = urljoin(f"{self.base_url}/user", link["href"])
            parsed = urlsplit(target)
            if parsed.netloc == urlsplit(self.base_url).netloc and parsed.scheme == urlsplit(self.base_url).scheme and parse_qs(parsed.query).get("kind") == ["finish"]:
                ended_url = target
                break
        if kind == "finish" or kind == "all" and ended_url:
            pages.append(("finish", read_page(ended_url or f"{self.base_url}/user?kind=finish")))
        courses: dict[str, dict[str, Any]] = {}
        for section, page in pages:
            for link in page.links:
                parsed = urlsplit(urljoin(self.base_url + "/user", link["href"]))
                course_id = (parse_qs(parsed.query).get("courseId") or [""])[0]
                if parsed.netloc != urlsplit(self.base_url).netloc or not parsed.path.endswith("/user/course") or not re.fullmatch(r"[0-9]+", course_id):
                    continue
                name = self.clean_html_text(link["name"])
                if name in {"继续学习", "开始学习", "查看课程", "进入课程"}:
                    name = ""
                if course_id not in courses:
                    courses[course_id] = {"course_id": course_id, "id": course_id, "name": name or f"课程 {course_id}", "kind": section}
                elif name and courses[course_id]["name"] == f"课程 {course_id}":
                    courses[course_id]["name"] = name
        self.log(f"找到 {len(courses)} 门课程", count=len(courses))
        return list(courses.values())

    def get_chapters(self, course_id: str) -> list[dict[str, Any]]:
        self.require_login()
        self.log("正在获取章节列表", course_id=course_id)
        response = self._get(
            f"{self.base_url}/user/course/chapter?courseId={course_id}",
            headers={"Referer": f"{self.base_url}/user/course?courseId={course_id}"},
            timeout=20,
        )
        self._check_response(response)
        html = response.text
        try:
            record_durations = self.get_study_record_durations(course_id)
            if record_durations:
                self.log(f"已从视频记录读取 {len(record_durations)} 个真实时长", course_id=course_id)
        except SessionExpiredError:
            raise
        except Exception as exc:
            record_durations = {}
            self.log(f"视频记录时长读取失败，将使用节点页面时长: {safe_error_message(exc)}", level="warning")

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
                duration = self.get_cached_video_duration(node_id, strict=True)
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

    def get_cached_video_duration(self, node_id: str, strict: bool = False) -> int:
        if node_id in self.duration_cache:
            return self.duration_cache[node_id]
        try:
            duration = self.get_video_duration(node_id)
        except SessionExpiredError:
            raise
        except Exception as exc:
            self.log(f"视频时长获取失败: {safe_error_message(exc)}", level="warning", node_id=node_id)
            if strict:
                raise
            duration = 0
        if duration > 0:
            self.duration_cache[node_id] = duration
        return duration

    def get_video_duration(self, node_id: str) -> int:
        self.require_login()
        response = self._get(f"{self.base_url}/user/node?nodeId={node_id}", timeout=20)
        self._check_response(response)
        match = re.search(
            r"""<input\b(?=[^>]*\bid=["']video-duration["'])[^>]*\bvalue=["']([^"']*)["']""",
            response.text,
            flags=re.I,
        )
        if match:
            duration = int(match.group(1))
            if duration > 0:
                return duration
        match = re.search(r'"duration"\s*:\s*(\d+)', response.text)
        if match:
            duration = int(match.group(1))
            if duration > 0:
                return duration
        if self.looks_like_video_node(response.text):
            raise ValueError("视频节点缺少有效时长")
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
        self.require_login()
        response = self._get(f"{self.base_url}/user/node?nodeId={node_id}", timeout=20)
        self._check_response(response)
        state = self.parse_study_state_from_html(response.text)
        if state is not None:
            return state
        raise ValueError("无法识别节点学习状态")

    def get_user_progress(self, course_id: str) -> dict[str, Any]:
        self.require_login()
        response = self._get(
            f"{self.base_url}/user/course?courseId={course_id}", timeout=20
        )
        self._check_response(response)
        html = response.text
        progress_match = re.search(r"学习进度[：:]\s*(\d+\.?\d*)%", html)
        completed_match = re.search(r"已完成\s*(\d+)", html)
        return {
            "progress": float(progress_match.group(1)) if progress_match else 0,
            "completed": int(completed_match.group(1)) if completed_match else 0,
        }

    def get_captcha(self) -> bytes:
        response = self._get(f"{self.base_url}/service/code?r={time.time()}", timeout=20)
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
        response = self._post(
            f"{self.base_url}/user/node/study",
            data=data,
            headers={
                "Referer": self.profile.get("referer") or f"{self.base_url}/user/node?nodeId={node_id}",
                "X-Requested-With": x_requested_with,
            },
            timeout=20,
        )
        if self._response_is_session_expired(response):
            self._invalidate_for_relogin()
            return {"status": False, "msg": "登录已失效，请重新登录", "reason": "session_expired"}
        response.raise_for_status()
        text = response.text.strip().lstrip("\ufeff")
        if not text:
            return {"status": False, "msg": "平台没有确认本次提交"}
        try:
            data = json.loads(text)
            if not isinstance(data, dict):
                raise ValueError("上报响应格式不正确")
            return data
        except json.JSONDecodeError:
            return {"status": False, "msg": "平台响应格式不正确"}

    def send_heartbeat(self) -> bool:
        try:
            x_requested_with = self.profile.get("x_requested_with") or "XMLHttpRequest"
            response = self._post(
                f"{self.base_url}/user/online",
                headers={"X-Requested-With": x_requested_with},
                timeout=10,
            )
            if self._response_is_session_expired(response):
                self._invalidate_for_relogin()
                return False
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

    def play_video(self, node_id: str, name: str, duration: int, index: int, total: int) -> bool:
        self.require_login()
        if self.stop_flag:
            return False
        completed_before = self.status.get("completed_nodes", index)
        self.update_status(current_node_id=node_id, current_node_name=name, current_index=index + 1, total_nodes=total, current_video_progress=0, total_progress=int(completed_before * 100 / total) if total else 0, message=f"正在播放 {name}")
        if self.get_study_state(node_id) == 2:
            self.update_status(current_video_progress=100)
            return True

        study_id: int | str = 0
        confirmed_seconds = 0
        pending_seconds = None
        errors = 0
        relogin_attempts = 0
        duration = max(1, int(duration))
        while confirmed_seconds < duration:
            if self.stop_flag:
                return False
            next_seconds = min(confirmed_seconds + DEFAULT_INTERVAL_SECONDS, duration)
            if pending_seconds != next_seconds:
                self.interruptible_sleep(next_seconds - confirmed_seconds)
                pending_seconds = next_seconds
            if self.stop_flag:
                return False
            try:
                result = self.report_time(node_id, next_seconds, study_id)
                self.send_heartbeat()
                if not self.token:
                    result = {"status": False, "msg": "登录已失效，请重新登录", "reason": "session_expired"}
                if not isinstance(result, dict):
                    raise ValueError("提交响应格式不正确")
                if result.get("need_code"):
                    result = self.handle_captcha(node_id, study_id, next_seconds)
                accepted = result.get("status") in (True, 1) and not result.get("need_code")
            except SessionExpiredError:
                raise
            except Exception as exc:
                result = {"status": False, "msg": safe_error_message(exc)}
                accepted = False

            if not accepted:
                message = self.response_message(result)
                if self.is_session_expired_message(message):
                    if relogin_attempts < 3:
                        relogin_attempts += 1
                        if self.relogin(max_retries=3):
                            continue
                    self.handle_session_expired("自动重新登录失败，播放已暂停", node_id=node_id)
                if "已完成" in message and self.get_study_state(node_id) == 2:
                    self.update_status(current_video_progress=100)
                    return True
                errors += 1
                self.log(f"学习时长提交未确认: {message}", level="warning", node_id=node_id)
                if errors >= 6:
                    self.emit("error", message="节点提交多次失败，未标记完成", node_id=node_id)
                    return False
                self.interruptible_sleep(5)
                continue

            confirmed_seconds = next_seconds
            study_id = result.get("studyId") or study_id
            errors = 0
            # 提交成功与节点完成分别确认，平台确认前不显示 100%。
            video_progress = min(99, int(confirmed_seconds * 100 / duration))
            total_progress = min(99, int((completed_before + video_progress / 100) * 100 / total)) if total else 0
            self.update_status(current_video_progress=video_progress, total_progress=total_progress, message=f"{name}: {video_progress}%")
            self.emit("progress", node_id=node_id, node_name=name, current_video_progress=video_progress, total_progress=total_progress, reported_seconds=confirmed_seconds, duration=duration, current_index=index + 1, total_nodes=total)

        if self.stop_flag:
            return False
        if self.get_study_state(node_id) != 2:
            self.emit("error", message="平台尚未确认节点完成", node_id=node_id)
            return False
        self.update_status(current_video_progress=100)
        self.log("平台已确认节点完成", node_id=node_id)
        return True

    def play_all(self, course_id: str) -> None:
        completed = failed = 0
        try:
            self.require_login()
            if self.stop_flag:
                self.update_status(message="已停止")
                return
            self.is_playing = True
            self.update_status(is_playing=True, is_stopping=False, course_id=course_id, current_node_id=None, current_node_name=None, current_index=0, current_video_progress=0, completed_nodes=0, failed_nodes=0, total_progress=0, message="正在启动")
            videos = self.get_chapters(course_id)
            self.update_status(total_nodes=len(videos))
            if self.stop_flag:
                self.update_status(message="已停止")
                return
            if not videos:
                self.update_status(message="未找到可播放视频")
                return
            start_index = self.find_start_index(videos)
            if self.stop_flag:
                self.update_status(message="已停止")
                return
            completed = start_index
            self.update_status(completed_nodes=completed, total_progress=int(completed * 100 / len(videos)))
            if start_index == len(videos):
                self.update_status(current_video_progress=100, total_progress=100, message="已完成")
                return
            for index in range(start_index, len(videos)):
                if self.stop_flag:
                    break
                video = videos[index]
                duration = self.get_cached_video_duration(str(video["node_id"])) or int(video.get("duration") or 0)
                if duration <= 0:
                    failed += 1
                elif self.play_video(str(video["node_id"]), str(video["name"]), duration, index, len(videos)):
                    completed += 1
                elif not self.stop_flag:
                    failed += 1
                self.update_status(completed_nodes=completed, failed_nodes=failed, total_progress=int(completed * 100 / len(videos)))
                if index < len(videos) - 1:
                    self.interruptible_sleep(3)
            if self.stop_flag:
                self.update_status(message="已停止")
            elif failed:
                self.update_status(message=f"有 {failed} 个节点未完成")
                self.emit("error", message=f"有 {failed} 个节点未完成")
            elif completed == len(videos):
                self.update_status(current_video_progress=100, total_progress=100, message="已完成")
        except SessionExpiredError:
            self.update_status(message="登录已失效，请重新登录")
            self.emit("error", message="登录已失效，请重新登录", reason="session_expired")
        except Exception as exc:
            message = safe_error_message(exc)
            self.log(message, level="error")
            self.emit("error", message=message)
            self.update_status(message=message)
        finally:
            self.is_playing = False
            self.update_status(is_playing=False, is_stopping=False)

    def stop(self) -> None:
        self.stop_flag = True
        running = self.is_playing
        self.update_status(is_stopping=running, message="正在停止" if running else "已停止")
        self.log("已发送停止指令" if running else "当前任务已停止")
