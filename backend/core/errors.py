# -*- coding: utf-8 -*-
import requests


class NotLoggedInError(RuntimeError):
    """当前账号没有有效的登录会话。"""


class SessionExpiredError(NotLoggedInError):
    """平台明确要求重新登录。"""


class AccountNotFoundError(RuntimeError):
    """账号已经不存在。"""


class TaskRunningError(RuntimeError):
    """活动任务期间不允许切换单会话账号。"""


def safe_error_message(exc: Exception) -> str:
    if isinstance(exc, NotLoggedInError):
        return "登录已失效，请重新登录"
    if isinstance(exc, AccountNotFoundError):
        return "账号不存在"
    if isinstance(exc, TaskRunningError):
        return "播放任务运行中，停止任务后才能切换账号"
    if isinstance(exc, requests.Timeout):
        return "平台响应超时，请稍后重试"
    if isinstance(exc, requests.RequestException):
        return "连接平台失败，请检查网络后重试"
    if isinstance(exc, (ValueError, KeyError, TypeError)):
        return "平台返回的数据不完整或格式不正确"
    return "操作失败，请稍后重试"
