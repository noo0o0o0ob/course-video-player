# -*- coding: utf-8 -*-
from fastapi import HTTPException
import requests

from core.errors import AccountNotFoundError, NotLoggedInError, TaskRunningError, safe_error_message


def raise_api_error(exc: Exception):
    status = 409 if isinstance(exc, TaskRunningError) else 401 if isinstance(exc, NotLoggedInError) else 404 if isinstance(exc, AccountNotFoundError) else 504 if isinstance(exc, requests.Timeout) else 502
    raise HTTPException(status_code=status, detail=safe_error_message(exc)) from exc
