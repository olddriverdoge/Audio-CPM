# -*- coding: utf-8 -*-
"""本地 HiFi 播放控制（Android 原生桥；Termux 返回 not_supported）。"""
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.routing import Route

import os
import time

from .. import native_bridge
from ..config import DATA_DIR
from ..storage import parse_ref


def _log(msg):
    try:
        with open(os.path.join(DATA_DIR, 'ac2.log'), 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + str(msg) + '\n')
    except Exception:
        pass


async def _body(request):
    try:
        return await request.json()
    except Exception:
        return {}


def _local_path(raw):
    """前端传的是 local:/sdcard/... 这种引用，Java 侧只认真实路径。"""
    try:
        ref = parse_ref(raw or '')
        if ref.kind == 'local':
            return ref.path
    except Exception:
        pass
    return raw or ''


async def playback_open(request):
    d = await _body(request)
    raw = d.get('path') or ''
    path = _local_path(raw)
    if path.startswith('dav:'):
        return JSONResponse({'ok': False, 'error': 'HiFi 只支持本机文件'})
    r = await run_in_threadpool(
        native_bridge.playback_open,
        path,
        int(d.get('startMs') or 0),
        int(d.get('sampleRate') or 0),
        int(d.get('bitDepth') or 0),
        int(d.get('channels') or 0))
    _log('playback open %s -> %s' % (path, r))
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


async def playback_diag(request):
    """真机排查入口：浏览器打开 http://127.0.0.1:8765/api/playback/diag 即可。"""
    st = await run_in_threadpool(native_bridge.playback_state)
    sp = await run_in_threadpool(native_bridge.playback_spectrum, None)
    return JSONResponse({
        'ok': True,
        'android': bool(os.environ.get('AC2_ANDROID')),
        'bridge': native_bridge.playback_available(),
        'state': st,
        'spectrum': sp,
    })


async def playback_queue(request):
    d = await _body(request)
    raw = d.get('paths') or []
    paths = [_local_path(x) for x in raw if x]
    if not paths:
        return JSONResponse({'ok': False, 'error': 'empty queue'})
    r = await run_in_threadpool(
        native_bridge.playback_queue, paths,
        int(d.get('index') or 0), int(d.get('startMs') or 0))
    _log('playback queue size=%d index=%s -> %s' % (len(paths), d.get('index'), r))
    return JSONResponse(r)


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
    Route('/api/playback/queue', playback_queue, methods=['POST']),
    Route('/api/playback/diag', playback_diag, methods=['GET']),
]
