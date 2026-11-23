# -*- coding: utf-8 -*-
"""音频输出：EQ / 音效 / 输出信息（Android 原生 AudioEffect；Termux 返回 not_supported）"""
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.routing import Route

from .. import native_bridge


async def _body(request):
    try:
        return await request.json()
    except Exception:
        return {}


async def audio_fx(request):
    d = await _body(request)
    r = await run_in_threadpool(native_bridge.audio_fx,
                                str(d.get('op') or ''),
                                int(d.get('a') or 0),
                                int(d.get('b') or 0))
    return JSONResponse(r)


async def audio_info(request):
    return JSONResponse(await run_in_threadpool(native_bridge.audio_info))


async def audio_devices(request):
    return JSONResponse(await run_in_threadpool(native_bridge.audio_devices))


async def set_audio_device(request):
    d = await _body(request)
    return JSONResponse(await run_in_threadpool(native_bridge.set_audio_device, int(d.get('id') or 0)))


async def set_audio_focus(request):
    d = await _body(request)
    return JSONResponse(await run_in_threadpool(native_bridge.set_audio_focus, bool(d.get('enabled'))))


routes = [
    Route('/api/audio/fx', audio_fx, methods=['POST']),
    Route('/api/audio/info', audio_info, methods=['GET']),
    Route('/api/audio/devices', audio_devices, methods=['GET']),
    Route('/api/audio/device', set_audio_device, methods=['POST']),
    Route('/api/audio/focus', set_audio_focus, methods=['POST']),
]
