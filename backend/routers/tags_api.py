# -*- coding: utf-8 -*-
"""标签编辑 / 预设。Starlette 版。"""
import os

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.routing import Route

from ..config import TASK_PRESETS_FILE
from ..jobs_core import edit_tags_file
from ..task_presets import load_task_presets, save_task_presets
from ..simple import J, body
from ..storage import parse_ref

routes = []


async def api_edit_tags(request: Request):
    data = await body(request)
    return await run_in_threadpool(_edit_tags_impl, data)


def _edit_tags_impl(data):
    path = str(data.get('path') or '')
    ref = parse_ref(path)
    if ref.kind == 'dav':
        raise HTTPException(403, "readonly_source")
    if not os.path.isfile(ref.path):
        raise HTTPException(400, "file not found")
    return J(edit_tags_file(ref.path, data.get('tags') or {}, data.get('remove') or []))


def api_get_task_presets(request: Request):
    return J(load_task_presets())


async def api_save_task_presets(request: Request):
    data = await body(request)
    if not isinstance(data.get('presets'), dict):
        raise HTTPException(400, "格式错误")
    save_task_presets(data)
    return J({"ok": True, "file": TASK_PRESETS_FILE})


routes.append(Route('/api/edit_tags', api_edit_tags, methods=['POST']))
routes.append(Route('/api/task-presets', api_get_task_presets))
routes.append(Route('/api/task-presets', api_save_task_presets, methods=['POST']))
