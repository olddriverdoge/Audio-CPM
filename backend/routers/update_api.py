# -*- coding: utf-8 -*-
"""更新检查路由：GET /api/app_update[?force=1&channel=release|test]。"""
from starlette.responses import JSONResponse
from starlette.routing import Route

from ..update import check_update


async def api_app_update(request):
    channel = request.query_params.get("channel")
    force = request.query_params.get("force") in ("1", "true", "yes")
    result = await check_update(channel=channel, force=force)
    return JSONResponse(result)


routes = [
    Route("/api/app_update", api_app_update, methods=["GET"]),
]
