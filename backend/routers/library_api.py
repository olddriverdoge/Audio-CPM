# -*- coding: utf-8 -*-
"""曲库 API：配置目录、增量扫描、搜索、专辑聚合。"""
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ..library import DEFAULT_SEARCH_FIELDS, SEARCH_FIELDS, library
from ..simple import body, qi, qs


def _json(d, status=200):
    return JSONResponse(d, status_code=status)


async def library_state(request: Request):
    return _json(await run_in_threadpool(library.state))


async def library_config(request: Request):
    data = await body(request)
    out = await run_in_threadpool(library.set_dirs, data.get("dirs") or [])
    if not out.get("ok"):
        return _json(out, 400)
    state = await run_in_threadpool(library.state)
    return _json({"ok": True, "dirs": out.get("dirs") or [], "state": state})


async def library_scan(request: Request):
    data = await body(request)
    out = await run_in_threadpool(library.start_scan, bool(data.get("force") or False))
    if not out.get("ok"):
        return _json(out, 400)
    return _json(out)


async def library_cancel(request: Request):
    return _json(await run_in_threadpool(library.cancel_scan))


async def library_search(request: Request):
    fields_raw = qs(request, "fields", "")
    fields = [x.strip() for x in fields_raw.split(",") if x.strip()] if fields_raw else list(DEFAULT_SEARCH_FIELDS)
    fields = [x for x in fields if x in SEARCH_FIELDS]
    out = await run_in_threadpool(
        library.search, qs(request, "q", ""), fields,
        qi(request, "limit", 120), qi(request, "offset", 0)
    )
    return _json(out, 200 if out.get("ok") else 500)


async def library_album(request: Request):
    out = await run_in_threadpool(library.album, qs(request, "path", ""))
    # “曲目不在曲库”是可预期的业务状态，不返回 HTTP 400：
    # 浮窗/播放管理会把错误当成资源失败，页面控制台会留下无意义的红字。
    return _json(out)


routes = [
    Route('/api/library/state', library_state, methods=['GET']),
    Route('/api/library/config', library_config, methods=['POST']),
    Route('/api/library/scan', library_scan, methods=['POST']),
    Route('/api/library/scan/cancel', library_cancel, methods=['POST']),
    Route('/api/library/search', library_search, methods=['GET']),
    Route('/api/library/album', library_album, methods=['GET']),
]
