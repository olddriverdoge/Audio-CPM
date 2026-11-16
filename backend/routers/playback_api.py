# -*- coding: utf-8 -*-
"""本地 HiFi 播放控制（Android 原生桥；Termux 返回 not_supported）。"""
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.routing import Route

from .. import native_bridge


async def _body(request):
    try:
        return await request.json()
    except Exception:
        return {}


async def playback_open(request):
    d = await _body(request)
    r = await run_in_threadpool(
        native_bridge.playback_open,
        d.get('path') or '',
        int(d.get('startMs') or 0),
        int(d.get('sampleRate') or 0),
        int(d.get('bitDepth') or 0),
        int(d.get('channels') or 0))
    return JSONResponse(r)


async def playback_pause(request):
    return JSONResponse(await run_in_threadpool(native_bridge.playback_control, 'pause'))


async def playback_resume(request):
    return JSONResponse(await run_in_threadpool(native_bridge.playback_control, 'resume'))


async def playback_stop(request):
    return JSONResponse(await run_in_threadpool(native_bridge.playback_control, 'stop'))


async def playback_seek(request):
    d = await _body(request)
    return JSONResponse(await run_in_threadpool(native_bridge.playback_control, 'seek', int(d.get('positionMs') or 0)))


async def playback_state(request):
    return JSONResponse(await run_in_threadpool(native_bridge.playback_state))


async def playback_spectrum(request):
    enabled = request.query_params.get('enabled')
    r = await run_in_threadpool(native_bridge.playback_spectrum,
                                None if enabled is None else enabled == '1')
    return JSONResponse(r)


routes = [
    Route('/api/playback/open', playback_open, methods=['POST']),
    Route('/api/playback/pause', playback_pause, methods=['POST']),
    Route('/api/playback/resume', playback_resume, methods=['POST']),
    Route('/api/playback/stop', playback_stop, methods=['POST']),
    Route('/api/playback/seek', playback_seek, methods=['POST']),
    Route('/api/playback/state', playback_state, methods=['GET']),
    Route('/api/playback/spectrum', playback_spectrum, methods=['GET']),
]
