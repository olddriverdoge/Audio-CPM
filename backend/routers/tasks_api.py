# -*- coding: utf-8 -*-
"""任务启动 / 状态 / SSE。Starlette 版。"""
import asyncio
import json
import os
import queue

from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import StreamingResponse
from starlette.routing import Route

from ..jobs import cancel_task, create_task, list_tasks, tasks, tasks_lock
from ..jobs_core import (check_tags_v2, convert_album_v2, manage_tags_v2,
                         modify_cover_v2)
from ..simple import J, body
from ..storage import parse_ref

routes = []


def _parse_format_spec(spec):
    from ..ffmpeg import parse_format_spec
    return parse_format_spec(spec)


async def api_start(request: Request):
    data = await body(request)
    ref = parse_ref(str(data.get('path') or ''))
    if ref.kind == 'dav':
        raise HTTPException(400, "本地文件处理任务不支持 WebDAV 路径")
    path = ref.path
    if not os.path.isdir(path):
        raise HTTPException(400, f"目录不存在: {path}")
    # only_files 也接受路径引用（local:/...），统一转成本地路径；非本地源忽略
    only_files = []
    for item in (data.get('only_files') or []):
        r2 = parse_ref(str(item or ''))
        if r2.kind == 'local' and r2.path:
            only_files.append(r2.path)
    only_files = only_files or None
    task = str(data.get('task') or '')
    if task == 'convert':
        spec = data.get('format') or 'FLAC'
        params = _parse_format_spec(spec)
        raw_out = str(data.get('output_dir') or '').strip()
        output_dir = None
        if raw_out:
            out_ref = parse_ref(raw_out)
            if out_ref.kind == 'dav':
                raise HTTPException(400, "输出目录不支持 WebDAV，请用本地目录")
            output_dir = out_ref.path or None
        delete_src = bool(data.get('delete_source')) if data.get('delete_source') is not None else True
        also_tags = bool(data.get('also_tags'))

        def fn(cb):
            r1 = convert_album_v2(path, spec, output_dir=output_dir,
                                  delete_source=delete_src,
                                  only_files=only_files, progress_cb=cb)
            if also_tags:
                cb({"event": "phase", "phase": "tags"})
                # 指定了输出目录时整理输出产物；否则整理源目录（与旧版原地转换语义一致）
                tags_root = output_dir or path
                r2 = manage_tags_v2(tags_root, format=params['codec'],
                                    name_pattern=data.get('name_pattern') or None,
                                    only_files=(None if output_dir else only_files),
                                    progress_cb=cb)
                return {"convert": r1, "tags": r2}
            return r1
        return J({"task_id": create_task(fn, f"转换 {spec} @ {path}")})
    if task == 'tags':
        fmt = (data.get('format') or 'flac').lower()

        def fn(cb):
            return manage_tags_v2(path, format=fmt,
                                  name_pattern=data.get('name_pattern') or None,
                                  only_files=only_files, progress_cb=cb)
        return J({"task_id": create_task(fn, f"整理标签 @ {path}")})
    if task == 'cover':
        fmt = (data.get('format') or 'flac').lower()

        def fn(cb):
            return modify_cover_v2(path, formats=fmt, only_files=only_files, progress_cb=cb)
        return J({"task_id": create_task(fn, f"替换封面 @ {path}")})
    if task == 'check':
        fmt = (data.get('format') or 'flac').lower()

        def fn(cb):
            return check_tags_v2(path, format=fmt, only_files=only_files, progress_cb=cb)
        return J({"task_id": create_task(fn, f"检查标签 @ {path}")})
    raise HTTPException(400, f"未知任务类型: {task}")


def api_task_status(request: Request):
    task_id = request.path_params['task_id']
    with tasks_lock:
        t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "task not found")
    return J({"task_id": task_id, "status": t["status"], "result": t["result"]})


async def api_task_stream(request: Request):
    task_id = request.path_params['task_id']
    with tasks_lock:
        t = tasks.get(task_id)
    if not t:
        raise HTTPException(404, "task not found")
    q = t["queue"]

    async def gen():
        loop = asyncio.get_running_loop()
        while True:
            try:
                item = await loop.run_in_executor(None, q.get, True, 0.3)
            except queue.Empty:
                with tasks_lock:
                    st = tasks[task_id]["status"]
                if st in ("done", "error", "cancelled") and q.empty():
                    break
                yield ": ping\n\n"
                continue
            if item is None:
                break
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def api_task_cancel(request: Request):
    tid = request.path_params['task_id']
    r = cancel_task(tid)
    if not r.get('ok'):
        raise HTTPException(404, r.get('error') or 'task not found')
    return J(r)


def api_tasks(request: Request):
    return J({'tasks': list_tasks()})


routes.append(Route('/api/start', api_start, methods=['POST']))
routes.append(Route('/api/task/{task_id}/cancel', api_task_cancel, methods=['POST']))
routes.append(Route('/api/tasks', api_tasks))
routes.append(Route('/api/task/{task_id}/status', api_task_status))
routes.append(Route('/api/task/{task_id}/stream', api_task_stream))
