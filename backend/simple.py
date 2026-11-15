# -*- coding: utf-8 -*-
"""Starlette 小工具：JSON 响应 + 请求体/查询参数读取（替代 pydantic 模型）。"""
from starlette.requests import Request
from starlette.responses import JSONResponse


def J(data=None, status: int = 200):
    return JSONResponse(data if data is not None else {}, status_code=status)


async def body(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def qs(request: Request, key: str, default: str = '') -> str:
    v = request.query_params.get(key)
    return default if v is None else v


def qi(request: Request, key: str, default: int = 0) -> int:
    try:
        return int(request.query_params.get(key, default))
    except (TypeError, ValueError):
        return default
