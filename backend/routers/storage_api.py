# -*- coding: utf-8 -*-
"""存储源管理：本地根 / WebDAV 连接（增删查、测试连接）。Starlette 版。"""
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.routing import Route

from ..simple import J, body
from ..storage import get_dav_client, get_source, load_sources, roots, save_sources

routes = []
MASK = '••••••'


def api_roots(request: Request):
    return J({"roots": roots()})


def api_sources(request: Request):
    srcs = load_sources()
    out = []
    for sid, s in srcs.items():
        item = dict(s)
        item['id'] = sid
        if item.get('password'):
            item['password'] = MASK
        out.append(item)
    return J({"sources": out})


async def api_save_source(request: Request):
    data = await body(request)
    sid = str(data.get('id') or '').strip()
    kind = str(data.get('kind') or 'dav').strip()
    if not sid or not sid.replace('-', '').replace('_', '').isalnum():
        raise HTTPException(400, "源 id 只能包含字母、数字、-、_")
    if kind not in ('local', 'dav'):
        raise HTTPException(400, "kind 必须是 local 或 dav")
    srcs = load_sources()
    cur = dict(srcs.get(sid) or {})
    if kind == 'local':
        root = str(data.get('root') or '').strip()
        if not root:
            raise HTTPException(400, "本地根路径不能为空")
        cur.update({"kind": "local", "name": str(data.get('name') or sid),
                    "roots": [root]})
    else:
        url = str(data.get('url') or '').strip()
        if not url:
            raise HTTPException(400, "WebDAV 地址不能为空")
        pwd = data.get('password')
        if pwd == MASK:
            pwd = cur.get('password', '')
        cur.update({
            "kind": "dav", "name": str(data.get('name') or sid),
            "url": url,
            "username": str(data.get('username') or ''),
            "password": pwd or '',
            "readonly": bool(data.get('readonly', True)),
            "start_path": str(data.get('start_path') or '/'),
            "verify": bool(data.get('verify', True)),
        })
    srcs[sid] = cur
    save_sources(srcs)
    return J({"ok": True, "roots": roots()})


async def api_delete_source(request: Request):
    data = await body(request)
    sid = str(data.get('id') or '')
    if sid == 'local':
        raise HTTPException(400, "本地源不能删除")
    srcs = load_sources()
    srcs.pop(sid, None)
    save_sources(srcs)
    return J({"ok": True, "roots": roots()})


async def api_test_source(request: Request):
    data = await body(request)
    return await run_in_threadpool(_test_impl, data)


def _test_impl(data):
    sid = str(data.get('id') or '').strip()
    cfg = get_source(sid) if sid else None
    if not cfg and data.get('url'):
        cfg = {"kind": "dav", "url": data.get('url'),
               "username": data.get('username') or '',
               "password": data.get('password') or '',
               "verify": bool(data.get('verify', True))}
    if not cfg or cfg.get('kind') != 'dav':
        raise HTTPException(400, "没有可测试的 WebDAV 配置")
    from ..storage.dav import DavClient, DavError
    try:
        cli = get_dav_client(sid) if sid and get_source(sid) else DavClient(cfg)
        return J(cli.test())
    except DavError as e:
        return J({"ok": False, "error": str(e)})
    except Exception as e:
        return J({"ok": False, "error": str(e)[:300]})


routes.append(Route('/api/roots', api_roots))
routes.append(Route('/api/storage/sources', api_sources))
routes.append(Route('/api/storage/sources', api_save_source, methods=['POST']))
routes.append(Route('/api/storage/sources/delete', api_delete_source, methods=['POST']))
routes.append(Route('/api/storage/test', api_test_source, methods=['POST']))
