# -*- coding: utf-8 -*-
"""使用当前 Windows 用户的 DPAPI 保存本地配置机密。"""
import base64
import ctypes
import sys
from ctypes import wintypes


PREFIX = "dpapi:"


class DataBlob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def _crypt(data: bytes, decrypt: bool) -> bytes:
    if sys.platform != "win32":
        raise OSError("当前系统不支持 Windows 配置加密")
    library = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    function = library.CryptUnprotectData if decrypt else library.CryptProtectData
    function.argtypes = [ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    buffer = ctypes.create_string_buffer(data, len(data))
    source = DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output = DataBlob()
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise OSError("Windows 配置加密或解密失败")
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel.LocalFree(ctypes.cast(output.data, ctypes.c_void_p))


def protect_secret(value: str) -> str:
    return PREFIX + base64.b64encode(_crypt(value.encode("utf-8"), False)).decode("ascii") if value else ""


def recover_secret(value: str) -> str:
    if not value.startswith(PREFIX):
        return value
    return _crypt(base64.b64decode(value[len(PREFIX):], validate=True), True).decode("utf-8")
