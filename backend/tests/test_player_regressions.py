# -*- coding: utf-8 -*-
"""使用合成平台响应验证播放和会话行为，不连接外部平台。"""
import json
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import requests
import core.player as player_module
from core.player import AutoPlayer, SessionExpiredError
from core.accounts import AccountContext, AccountManager
from core.errors import TaskRunningError
from core.session import SessionManager


def response(text, path="/user"):
    value = requests.Response()
    value.status_code = 200
    value.url = "https://school.example.test" + path
    value._content = text.encode("utf-8")
    value.encoding = "utf-8"
    return value


class PlayerRegressionTests(unittest.TestCase):
    def setUp(self):
        self.ocr = patch.object(player_module, "HAS_OCR", False)
        self.ocr.start()
        self.addCleanup(self.ocr.stop)
        self.player = AutoPlayer(platform_url="https://school.example.test")
        self.player.token = "synthetic-platform-token"
        self.player.events = []
        self.player.event_callback = lambda kind, data: self.player.events.append((kind, data.copy()))
        self.player.session.get = Mock(return_value=response("<html></html>"))
        self.player.session.post = Mock(return_value=response('{"status":true}', "/api/login"))
        self.player.interruptible_sleep = lambda seconds: None

    def prepare_video(self):
        self.player.get_study_state = Mock(return_value=0)
        self.player.send_heartbeat = lambda: True

    def prepare_course(self):
        self.player.get_chapters = lambda course_id: [{"node_id": "1", "name": "合成节点", "duration": 30}]
        self.player.find_start_index = lambda videos: 0
        self.player.get_cached_video_duration = lambda node_id: 30

    def test_summary_records_confirmed_failed_and_unexecuted_chapters(self):
        self.prepare_course()
        self.player.get_chapters = lambda course: [{"node_id": str(i), "name": f"合成章节{i}", "duration": 30} for i in range(4)]
        self.player.find_start_index = lambda videos: 1
        self.player.play_video = Mock(side_effect=[False, SessionExpiredError("失效")])
        self.player.play_all("synthetic-course")
        summary = self.player.status["task_summary"]
        self.assertEqual(summary["outcome"], "failed")
        self.assertEqual(summary["reason"], "session_expired")
        self.assertEqual([item["outcome"] for item in summary["chapters"]], ["success", "failed", "failed", "not_run"])
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(summary["failed"], 2)
        self.assertTrue(any(kind == "task_summary" and data["summary"] == summary for kind, data in self.player.events))

    def test_summary_distinguishes_stopped_from_failed_and_completed(self):
        self.prepare_course()
        def stop_video(*args):
            self.player.stop_flag = True
            return False
        self.player.play_video = stop_video
        self.player.play_all("synthetic-course")
        self.assertEqual(self.player.status["task_summary"]["outcome"], "stopped")
        self.assertEqual(self.player.status["task_summary"]["chapters"][0]["outcome"], "stopped")
        self.player.stop_flag = False
        self.player.play_video = Mock(return_value=True)
        self.player.play_all("synthetic-course")
        self.assertEqual(self.player.status["task_summary"]["outcome"], "success")
        self.assertEqual(self.player.status["task_summary"]["completed"], 1)

    def test_empty_course_is_not_reported_as_success(self):
        self.player.get_chapters = lambda course: []
        self.player.play_all("synthetic-course")
        self.assertEqual(self.player.status["task_summary"]["outcome"], "failed")
        self.assertEqual(self.player.status["task_summary"]["chapters"], [])

    def test_summary_retains_confirmed_nodes_when_progress_check_times_out(self):
        self.prepare_course()
        self.player.get_chapters = lambda course: [{"node_id": str(i), "name": f"合成章节{i}", "duration": 30} for i in range(3)]
        self.player.find_start_index = AutoPlayer.find_start_index.__get__(self.player)
        self.player.get_study_state = Mock(side_effect=[2, requests.Timeout("合成超时")])
        self.player.play_all("synthetic-course")
        summary = self.player.status["task_summary"]
        self.assertEqual([item["outcome"] for item in summary["chapters"]], ["success", "failed", "not_run"])
        self.assertEqual(summary["reason"], "timeout")
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(self.player.status["failed_nodes"], 1)

    def test_rejected_reports_do_not_complete_node(self):
        self.prepare_video()
        self.player.report_time = Mock(return_value={"status": False, "msg": "合成拒绝"})
        self.assertFalse(self.player.play_video("1", "合成节点", 30, 0, 1))
        self.assertLess(self.player.status["current_video_progress"], 100)

    def test_timed_out_reports_do_not_complete_node(self):
        self.prepare_video()
        self.player.report_time = Mock(side_effect=requests.Timeout("合成超时"))
        self.assertFalse(self.player.play_video("1", "合成节点", 30, 0, 1))

    def test_retry_does_not_skip_unaccepted_seconds(self):
        self.prepare_video()
        self.player.get_study_state.side_effect = [0, 2]
        accepted = []
        def report(node, seconds, study_id):
            accepted.append(seconds)
            return {"status": len(accepted) > 1, "msg": "合成响应"}
        self.player.report_time = report
        self.assertTrue(self.player.play_video("1", "合成节点", 60, 0, 1))
        self.assertEqual(accepted, [30, 30, 60])

    def test_fixed_report_interval_and_custom_failure_policy(self):
        self.prepare_video()
        self.player.configure_playback(report_interval=20, report_max_failures=2, report_retry_interval=7)
        self.player.get_study_state.side_effect = [0, 2]
        self.player.report_time = Mock(side_effect=[{"status": False}, {"status": True}, {"status": True}])
        self.player.interruptible_sleep = Mock()
        self.assertTrue(self.player.play_video("1", "合成节点", 35, 0, 1))
        self.assertEqual([call.args[1] for call in self.player.report_time.call_args_list], [30, 30, 35])
        self.assertEqual([call.args for call in self.player.interruptible_sleep.call_args_list], [(30,), (7,), (5,)])
        self.player.get_study_state = Mock(return_value=0)
        self.player.report_time = Mock(return_value={"status": False})
        self.assertFalse(self.player.play_video("1", "合成节点", 35, 0, 1))
        self.assertEqual(self.player.report_time.call_count, 2)

    def test_custom_chapter_interval_and_relogin_policy(self):
        self.prepare_course()
        self.player.configure_playback(chapter_interval=7, relogin_max_retries=4, relogin_max_rounds=2, relogin_retry_interval=6)
        video = {"node_id": "1", "name": "合成节点", "duration": 30}
        self.player.get_chapters = lambda course: [video, {**video, "node_id": "2"}]
        self.player.play_video = Mock(return_value=True)
        self.player.interruptible_sleep = Mock()
        self.player.play_all("1")
        self.player.interruptible_sleep.assert_called_once_with(7)
        self.player.username, self.player.password = "synthetic", "synthetic"
        self.player.login = Mock(return_value={"status": False})
        self.player.interruptible_sleep.reset_mock()
        self.assertFalse(self.player.relogin())
        self.assertEqual(self.player.login.call_count, 4)
        self.assertEqual([call.args for call in self.player.interruptible_sleep.call_args_list], [(6,)] * 3)
        self.prepare_video()
        self.player.play_video = AutoPlayer.play_video.__get__(self.player)
        self.player.report_time = Mock(return_value={"status": False, "msg": "登录已失效"})
        self.player.relogin = Mock(return_value=True)
        with self.assertRaises(SessionExpiredError):
            self.player.play_video("1", "合成节点", 30, 0, 1)
        self.assertEqual(self.player.relogin.call_count, 2)
        self.player.relogin.assert_called_with(max_retries=4)

    def test_custom_request_timeouts_reach_platform_requests(self):
        self.player.configure_playback(network_timeout=45, login_page_timeout=25, heartbeat_timeout=35)
        self.player.get_captcha()
        self.assertEqual(self.player.session.get.call_args.kwargs["timeout"], 45)
        self.player.report_time("1", 30)
        self.assertEqual(self.player.session.post.call_args.kwargs["timeout"], 45)
        self.player.send_heartbeat()
        self.assertEqual(self.player.session.post.call_args.kwargs["timeout"], 35)
        self.player.login("synthetic", "synthetic")
        self.assertEqual(self.player.session.get.call_args.kwargs["timeout"], 25)

    def test_unconfirmed_server_state_does_not_complete_node(self):
        self.prepare_video()
        self.player.report_time = Mock(return_value={"status": True})
        self.assertFalse(self.player.play_video("1", "合成节点", 30, 0, 1))
        self.assertLess(self.player.status["current_video_progress"], 100)

    def test_captcha_rejection_does_not_advance_progress(self):
        self.prepare_video()
        self.player.report_time = Mock(return_value={"status": True, "need_code": True})
        self.player.handle_captcha = Mock(return_value={"status": False, "msg": "合成验证码拒绝"})
        self.assertFalse(self.player.play_video("1", "合成节点", 30, 0, 1))
        self.assertLess(self.player.status["current_video_progress"], 100)

    def prepare_captcha(self):
        self.player.get_captcha = Mock(return_value=b"synthetic-image")
        self.player.solve_captcha = Mock(return_value="ABCD")
        self.player.report_time = Mock(return_value={"status": False, "msg": "验证码错误"})

    def test_captcha_default_limit_stops_entire_course_and_emits_retry_prompt(self):
        self.prepare_video()
        self.prepare_course()
        self.prepare_captcha()
        def report(node, seconds, study_id=0, code=None):
            return {"status": False, "msg": "验证码错误"} if code else {"need_code": True}
        self.player.report_time.side_effect = report
        self.player.play_all("course-1")
        self.assertEqual(self.player.get_captcha.call_count, 3)
        self.assertFalse(self.player.is_playing)
        self.assertEqual(self.player.status["message"], "验证码识别错误，请手动点击重试")
        errors = [data for kind, data in self.player.events if kind == "error"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["reason"], "captcha_retries_exhausted")
        self.assertEqual(errors[0]["course_id"], "course-1")

    def test_captcha_custom_limit_and_empty_recognition(self):
        self.prepare_captcha()
        self.player.captcha_max_retries = 10
        self.player.solve_captcha.return_value = None
        result = self.player.handle_captcha("1")
        self.assertEqual(self.player.get_captcha.call_count, 10)
        self.assertEqual(result["reason"], "captcha_retries_exhausted")
        self.player.report_time.assert_not_called()

    def test_configured_interval_applies_to_both_captcha_failure_paths(self):
        for full_auto_mode in (False, True):
            self.prepare_captcha()
            self.player.full_auto_mode = full_auto_mode
            self.player.captcha_retry_interval = 5
            self.player.interruptible_sleep = Mock()
            self.player.solve_captcha.side_effect = [None, "ABCD", "EFGH"]
            self.player.report_time.side_effect = [{"status": False, "msg": "验证码错误"}, {"status": True}]
            self.assertTrue(self.player.handle_captcha("1")["status"])
            self.assertEqual([call.args for call in self.player.interruptible_sleep.call_args_list], [(5,), (5,)])

    def test_captcha_limit_does_not_wait_after_last_attempt(self):
        self.prepare_captcha()
        self.player.interruptible_sleep = Mock()
        self.player.handle_captcha("1")
        self.assertEqual([call.args for call in self.player.interruptible_sleep.call_args_list], [(1,), (1,)])

    def test_full_auto_retries_beyond_ten_until_confirmed(self):
        self.prepare_captcha()
        self.player.full_auto_mode = True
        self.player.report_time.side_effect = [{"status": True, "need_code": True}] * 12 + [{"status": True, "studyId": "study-1"}]
        result = self.player.handle_captcha("1", current_time=30)
        self.assertEqual(self.player.get_captcha.call_count, 13)
        self.assertEqual(result["studyId"], "study-1")
        self.assertTrue(all(call.args[1] == 30 for call in self.player.report_time.call_args_list))

    def test_full_auto_can_be_stopped_and_does_not_retry_unrelated_failure(self):
        self.prepare_captcha()
        self.player.full_auto_mode = True
        self.player.report_time.return_value = {"status": False, "msg": "登录已失效", "reason": "session_expired"}
        self.assertEqual(self.player.handle_captcha("1")["reason"], "session_expired")
        self.assertEqual(self.player.get_captcha.call_count, 1)
        self.player.report_time.return_value = {"status": False, "msg": "验证码错误"}
        self.player.interruptible_sleep = lambda seconds: setattr(self.player, "stop_flag", True)
        self.assertEqual(self.player.handle_captcha("1")["msg"], "已停止")

    def test_failed_nodes_do_not_complete_course(self):
        self.prepare_course()
        self.player.play_video = lambda *args: False
        self.player.play_all("1")
        self.assertLess(self.player.status["total_progress"], 100)
        self.assertNotEqual(self.player.status["message"], "已完成")

    def test_page_exhaustion_returns_collected_durations(self):
        self.player.session.get.return_value = response('<tr><td><a href="/user/node?nodeId=1">节点</a></td><td>x</td><td>x</td><td>x</td><td>x</td><td>01:30</td></tr>页次：1/1')
        try:
            actual = self.player.get_study_record_durations("1")
        except ValueError as exc:
            self.fail(f"读取完分页后不应抛出异常：{exc}")
        self.assertEqual(actual, {"1": 90})

    def test_failed_login_clears_previous_identity(self):
        self.player.username = "synthetic-first"
        self.player.password = "synthetic-old-password"
        self.player.user_info = {"name": "合成旧用户"}
        self.player.session.post.return_value = response('{"status":false,"message":"合成密码错误"}', "/api/login")
        result = self.player.login("synthetic-second", "synthetic-new-password")
        self.assertFalse(result["status"])
        self.assertFalse(self.player.session_info()["logged_in"])
        self.assertIsNone(self.player.session_info()["user"])
        self.assertIsNone(self.player.password)

    def test_failed_login_request_clears_previous_identity(self):
        self.player.session.post.side_effect = requests.Timeout("合成超时")
        with self.assertRaises(requests.Timeout):
            self.player.login("synthetic-user", "synthetic-password")
        self.assertFalse(self.player.session_info()["logged_in"])

    def test_login_requires_token(self):
        self.player.token = None
        self.player.session.post.return_value = response('{"status":true,"result":{"data":{"name":"合成用户"}}}', "/api/login")
        result = self.player.login("synthetic-user", "synthetic-password")
        self.assertFalse(result["status"])
        self.assertFalse(self.player.session_info()["logged_in"])

    def test_login_event_does_not_include_user_information(self):
        self.player.session.post.return_value = response('{"status":true,"result":{"data":{"token":"synthetic-token","name":"合成姓名"}}}', "/api/login")
        self.player.login("synthetic-user", "synthetic-password")
        self.assertNotIn("合成姓名", json.dumps(self.player.events, ensure_ascii=False))
        self.assertNotIn("synthetic-token", json.dumps(self.player.events))

    def test_login_page_invalidates_node_session(self):
        self.player.session.get.return_value = response('<form action="/api/login"><input type="password" name="password"></form>', "/user/login")
        with self.assertRaises(SessionExpiredError):
            self.player.get_study_state("1")
        self.assertFalse(self.player.session_info()["logged_in"])

    def test_login_page_invalidates_course_session(self):
        self.player.session.get.return_value = response('<form><input type="password"></form>', "/user/login")
        with self.assertRaises(SessionExpiredError):
            self.player.get_courses()

    def test_unknown_node_is_not_marked_complete(self):
        with self.assertRaises(ValueError):
            self.player.get_study_state("1")

    def test_temporary_duration_failure_is_retried(self):
        self.player.session.get.side_effect = [requests.Timeout("合成超时"), response('<input id="video-duration" value="90">', "/user/node")]
        self.assertEqual(self.player.get_cached_video_duration("1"), 0)
        self.assertEqual(self.player.get_cached_video_duration("1"), 90)

    def test_idle_stop_finishes_immediately(self):
        self.player.stop()
        self.assertFalse(self.player.status["is_stopping"])
        self.assertFalse(self.player.status["is_playing"])

    def test_single_session_cannot_switch_identity_during_playback(self):
        manager = SessionManager()
        manager._player = self.player
        self.player.is_playing = True
        self.player.login = Mock()
        with self.assertRaises(TaskRunningError):
            manager.login("synthetic-second-user", "synthetic-second-password")
        self.player.login.assert_not_called()

    def test_stop_after_start_is_preserved(self):
        self.prepare_course()
        self.prepare_video()
        reports = []
        self.player.report_time = lambda node, seconds, study: reports.append(seconds) or {"status": True}
        original = self.player.play_all
        entered, release = threading.Event(), threading.Event()
        def delayed(course_id):
            entered.set()
            if release.wait(2):
                original(course_id)
        self.player.play_all = delayed
        manager = AccountManager()
        manager._accounts["synthetic"] = AccountContext("synthetic", "synthetic-user", self.player)
        manager.start("synthetic", "1")
        self.assertTrue(entered.wait(2))
        manager.stop("synthetic")
        release.set()
        manager._accounts["synthetic"].thread.join(2)
        self.assertEqual(reports, [])
        self.assertFalse(manager.status("synthetic")["thread_alive"])

    def test_expired_account_cannot_start_worker(self):
        self.player.token = None
        manager = AccountManager()
        manager._accounts["synthetic"] = AccountContext("synthetic", "synthetic-user", self.player)
        with patch.object(threading, "excepthook"):
            try:
                result = manager.start("synthetic", "1")
            except RuntimeError:
                result = {"status": False}
            if manager._accounts["synthetic"].thread:
                manager._accounts["synthetic"].thread.join(2)
        self.assertFalse(result["status"])

    def test_extra_headers_are_sent(self):
        value = AutoPlayer(profile={"extra_headers": {"X-Custom": "synthetic"}}, platform_url="https://school.example.test")
        outgoing = value.session.prepare_request(requests.Request("GET", value.base_url + "/user"))
        self.assertEqual(outgoing.headers.get("X-Custom"), "synthetic")

    def test_profile_cookie_is_not_sent_to_sibling_host(self):
        value = AutoPlayer(profile={"cookie": "synthetic=example"}, platform_url="https://school.example.test")
        correct = value.session.prepare_request(requests.Request("GET", value.base_url + "/user"))
        other = value.session.prepare_request(requests.Request("GET", "https://other.example.test/user"))
        self.assertIn("synthetic=example", correct.headers.get("Cookie", ""))
        self.assertIsNone(other.headers.get("Cookie"))

    def test_apex_cookie_is_not_sent_to_unrelated_host(self):
        value = AutoPlayer(profile={"cookie": "synthetic=example"}, platform_url="https://example.test")
        other = value.session.prepare_request(requests.Request("GET", "https://unrelated.test/user"))
        self.assertIsNone(other.headers.get("Cookie"))

    def test_nested_sensitive_user_fields_are_removed(self):
        value = AutoPlayer.public_user_info({"name": "合成用户", "access_token": "synthetic", "PASSWORD": "synthetic", "nested": {"token": "synthetic", "display": "public"}, "items": [{"cookie": "synthetic", "title": "public"}]})
        self.assertEqual(value, {"name": "合成用户", "nested": {"display": "public"}, "items": [{"title": "public"}]})

    def test_courses_include_ended_section_and_deduplicate(self):
        current = '<a href="/user/course?courseId=1">课程一</a><a href="/user/index?kind=finish">已结束</a>'
        ended = '<a href="/user/course?courseId=2">课程二</a><a href="/user/course?courseId=1">课程一</a>'
        def get(url, **kwargs):
            return response(ended if parse_qs(urlsplit(url).query).get("kind") == ["finish"] else current)
        self.player.session.get.side_effect = get
        self.assertEqual([item["course_id"] for item in self.player.get_courses()], ["1", "2"])

    def test_empty_report_response_is_not_success(self):
        self.player.session.post.return_value = response("", "/user/node/study")
        self.assertFalse(self.player.report_time("1", 30)["status"])

    def test_report_login_page_invalidates_session_without_losing_relogin_credentials(self):
        self.player.username = "synthetic-user"
        self.player.password = "synthetic-password"
        self.player.session.post.return_value = response('<form><input type="password"></form>', "/user/login")
        result = self.player.report_time("1", 30)
        self.assertFalse(result["status"])
        self.assertIsNone(self.player.token)
        self.assertEqual(self.player.username, "synthetic-user")
        self.assertEqual(self.player.password, "synthetic-password")

    def test_heartbeat_login_page_invalidates_session(self):
        self.player.session.post.return_value = response('<form><input type="password"></form>', "/user/login")
        self.assertFalse(self.player.send_heartbeat())
        self.assertIsNone(self.player.token)

    def test_duration_failure_cannot_remove_video_from_course_total(self):
        chapter_page = response(
            '<a href="/user/node?nodeId=1">节点一</a>'
            '<a href="/user/node?nodeId=2">节点二</a>',
            "/user/course/chapter",
        )
        known_video = response('<input id="video-duration" value="30">', "/user/node")
        self.player.session.get.side_effect = [chapter_page, known_video, requests.Timeout("合成超时")]
        self.player.get_study_record_durations = Mock(return_value={})
        self.player.get_study_state = Mock(return_value=2)
        self.player.play_all("course-1")
        self.assertNotEqual(self.player.status["total_progress"], 100)
        self.assertNotEqual(self.player.status["message"], "已完成")

    def test_video_without_parsable_duration_cannot_be_skipped(self):
        chapter_page = response(
            '<a href="/user/node?nodeId=1">节点一</a>'
            '<a href="/user/node?nodeId=2">节点二</a>',
            "/user/course/chapter",
        )
        known_video = response('<input id="video-duration" value="30">', "/user/node")
        unknown_video = response('<input id="study-state" value="0"><video id="video-file" src="synthetic-video.mp4"></video>', "/user/node")
        self.player.session.get.side_effect = [chapter_page, known_video, unknown_video]
        self.player.get_study_record_durations = Mock(return_value={})
        self.player.get_study_state = Mock(return_value=2)
        self.player.play_all("course-1")
        self.assertNotEqual(self.player.status["total_progress"], 100)
        self.assertNotEqual(self.player.status["message"], "已完成")

    def test_custom_header_secret_is_redacted_from_login_error_and_events(self):
        secret = "synthetic-custom-header-secret"
        player = AutoPlayer(profile={"extra_headers": {"Authorization": f"Bearer {secret}"}}, platform_url="https://school.example.test")
        events = []
        player.event_callback = lambda kind, data: events.append((kind, data.copy()))
        player.session.get = Mock(return_value=response("<html></html>"))
        player.session.post = Mock(return_value=response(json.dumps({"status": False, "message": f"invalid credential {secret}"}), "/api/login"))
        result = player.login("synthetic-user", "synthetic-password")
        self.assertNotIn(secret, result["message"])
        self.assertNotIn(secret, json.dumps(events))

    def test_error_event_updates_account_last_error(self):
        manager = AccountManager()
        manager._accounts["synthetic"] = AccountContext("synthetic", "synthetic-user", self.player)
        manager._emit_account_event("synthetic", "error", {"message": "合成错误"})
        self.assertEqual(manager.status("synthetic")["last_error"], "合成错误")
        manager._emit_account_event("synthetic", "session", {"logged_in": True})
        self.assertIsNone(manager.status("synthetic")["last_error"])

    def test_stop_all_keeps_stopping_snapshot_when_an_account_is_removed(self):
        manager = AccountManager()
        first = AccountContext("first", "synthetic-one", self.player)
        second_player = Mock()
        second = AccountContext("second", "synthetic-two", second_player)
        manager._accounts.update({"first": first, "second": second})
        original_stop = self.player.stop
        def remove_second_then_stop():
            manager.remove("second")
            original_stop()
        self.player.stop = remove_second_then_stop
        result = manager.stop_all()
        self.assertEqual(len(result["results"]), 2)
        self.assertTrue(second_player.stop.called)

    def test_start_all_continues_after_one_account_start_fails(self):
        manager = AccountManager()
        first = AccountContext("first", "synthetic-one", self.player)
        second = AccountContext("second", "synthetic-two", self.player)
        manager._accounts.update({"first": first, "second": second})
        manager.start = Mock(side_effect=[RuntimeError("合成并发错误"), {"status": True, "message": "已启动"}])
        result = manager.start_all("course-1")
        self.assertEqual(manager.start.call_count, 2)
        self.assertFalse(result["results"][0]["status"])
        self.assertTrue(result["results"][1]["status"])


if __name__ == "__main__":
    unittest.main()
