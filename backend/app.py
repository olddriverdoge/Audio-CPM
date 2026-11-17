# -*- coding: utf-8 -*-
"""Starlette 装配：API 路由 + 静态前端（frontend/）。"""
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

from .config import FRONTEND_DIR
from .routers import (audio_api, browse_api, caps_api, fs_api, media_api, playback_api,
                      storage_api, tags_api, tasks_api, ui_api)


async def _no_cache(request, call_next):
    """静态前端不缓存，改完 js/css 刷新即生效。"""
    resp = await call_next(request)
    path = request.url.path
    if (path == '/' or path.endswith('.html')
            or path.startswith('/js/') or path.startswith('/css/')):
        resp.headers['Cache-Control'] = 'no-cache, must-revalidate'
    return resp


def create_app() -> Starlette:
    routes = []
    for mod in (browse_api, tags_api, tasks_api, media_api, fs_api, ui_api,
                storage_api, playback_api, caps_api, audio_api):
        routes.extend(mod.routes)
    # 静态前端放最后挂载：未命中 API 的请求都交给 frontend/
    routes.append(Mount("/", app=StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend"))
    return Starlette(routes=routes,
                     middleware=[Middleware(BaseHTTPMiddleware, dispatch=_no_cache)])


app = create_app()
