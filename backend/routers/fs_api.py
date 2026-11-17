# -*- coding: utf-8 -*-
"""目录树 / 移动 / 删除 / 重命名（本地 + WebDAV，禁止跨源）。Starlette 版。

注意：涉及 WebDAV 的同步 IO 必须放在线程池（run_in_threadpool），否则会阻塞事件循环导致整个服务无响应。
"""
import errno
import os
import re
import shutil

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.routing import Route

from ..config import PUBLIC_PREFIXES, FORBIDDEN_ROOTS
from ..simple import J, body, qs
from ..storage import get_dav_client, parse_ref, to_uri

routes = []
BAD_DIR_NAME = re.compile(r'[\\/:*?"<>|]')


def _valid_dir_name(name):
    name = (name or '').strip()
    if not name or name in ('.', '..'):
        return None
    if BAD_DIR_NAME.search(name):
        return None
    return name


def _same_kind(refs, target):
    kinds = {r.kind for r in refs} | {target.kind}
    if len(kinds) > 1:
        raise HTTPException(400, "cross_source_not_supported")
    if target.kind == 'dav':
        srcs = {r.source for r in refs}
        if srcs and srcs != {target.source}:
            raise HTTPException(400, "cross_source_not_supported")


def api_tree(request: Request):
    path = qs(request, 'path')
    ref = parse_ref(path)
    if ref.kind == 'dav':
        try:
            d = get_dav_client(ref.source).list(ref.path)
        except Exception as e:
            raise HTTPException(400, f"WebDAV 读取失败: {e}")
        children = [{"name": x['name'], "path": 'dav:' + ref.source + x['path'],
                     "has_children": True} for x in d['dirs']]
        return J({"path": to_uri(ref), "children": children})
    p = ref.path
    if not os.path.isdir(p):
        raise HTTPException(400, "目录不存在或无权限")
    try:
        names = os.listdir(p)
    except Exception as e:
        raise HTTPException(400, f"无法读取目录: {e}")
    children = []
    for name in sorted(names, key=lambda n: n.lower()):
        full = os.path.join(p, name)
        if not os.path.isdir(full):
            continue
        has = False
        try:
            has = any(os.path.isdir(os.path.join(full, c)) for c in os.listdir(full))
        except Exception:
            has = False
        children.append({"name": name, "path": 'local:' + full, "has_children": has})
    return J({"path": to_uri(ref), "children": children})


def _move_impl(data, copy=False):
    src_refs = [parse_ref(p) for p in (data.get('sources') or [])]
    tgt = parse_ref(str(data.get('target') or ''))
    _same_kind(src_refs, tgt)
    mode = data.get('conflict')
    if mode not in ('skip', 'rename', 'overwrite'):
        mode = 'skip'
    if tgt.kind == 'dav':
        return _dav_move(src_refs, tgt, mode)
    target = tgt.path
    if not os.path.isdir(target):
        raise HTTPException(400, f"目标目录不存在: {target}")
    results, moved, skipped, failed = [], 0, 0, 0
    for ref in src_refs:
        src = ref.path
        dst = os.path.join(target, os.path.basename(src))
        try:
            src_is_dir = os.path.isdir(src)
            if not (os.path.isfile(src) or src_is_dir):
                results.append({"src": src, "dst": dst, "status": "error", "reason": "not_found"})
                failed += 1
                continue
            if src_is_dir:
                src_abs = os.path.abspath(src).rstrip(os.sep)
                tgt_abs = os.path.abspath(target).rstrip(os.sep)
                if tgt_abs == src_abs or tgt_abs.startswith(src_abs + os.sep):
                    results.append({"src": src, "dst": dst, "status": "error", "reason": "into_self"})
                    failed += 1
                    continue
            try:
                if os.path.exists(dst) and os.path.samefile(src, dst):
                    results.append({"src": src, "dst": dst, "status": "skip", "reason": "same_file"})
                    skipped += 1
                    continue
            except Exception:
                pass
            if os.path.exists(dst):
                if mode == 'skip':
                    results.append({"src": src, "dst": dst, "status": "skip", "reason": "exists"})
                    skipped += 1
                    continue
                if mode == 'rename':
                    if src_is_dir:
                        base, ext = os.path.basename(src), ''
                    else:
                        base, ext = os.path.splitext(os.path.basename(src))
                    i = 1
                    while os.path.exists(dst) and i <= 9999:
                        dst = os.path.join(target, f"{base}_{i}{ext}")
                        i += 1
                else:
                    if src_is_dir or os.path.isdir(dst):
                        results.append({"src": src, "dst": dst, "status": "error",
                                        "reason": "target_exists"})
                        failed += 1
                        continue
                    try:
                        os.remove(dst)
                    except Exception:
                        pass
            if copy:
                if src_is_dir:
                    shutil.copytree(src, dst)
                else:
                    shutil.copy2(src, dst)
            else:
                shutil.move(src, dst)
            results.append({"src": src, "dst": dst, "status": "ok"})
            moved += 1
        except Exception as e:
            results.append({"src": src, "dst": dst, "status": "error", "reason": str(e)[:300]})
            failed += 1
    return {"results": results, "moved": moved, "skipped": skipped, "failed": failed,
            "op": "copy" if copy else "move"}


def _dav_move(src_refs, tgt, mode, copy=False):
    cli = get_dav_client(tgt.source)
    results, moved, skipped, failed = [], 0, 0, 0
    for ref in src_refs:
        src = ref.path
        name = src.rstrip('/').split('/')[-1]
        dst = (tgt.path.rstrip('/') or '') + '/' + name
        try:
            if src.rstrip('/') == dst.rstrip('/'):
                results.append({"src": src, "dst": dst, "status": "skip", "reason": "same_file"})
                skipped += 1
                continue
            if mode == 'skip':
                try:
                    cli.stat(dst)
                    results.append({"src": src, "dst": dst, "status": "skip", "reason": "exists"})
                    skipped += 1
                    continue
                except Exception:
                    pass
            if mode == 'rename':
                base, ext = os.path.splitext(name)
                i = 1
                while i <= 999:
                    try:
                        cli.stat(dst)
                        dst = (tgt.path.rstrip('/') or '') + f'/{base}_{i}{ext}'
                        i += 1
                        continue
                    except Exception:
                        break
            cli.copy(src, dst) if copy else cli.move(src, dst)
            results.append({"src": src, "dst": dst, "status": "ok"})
            moved += 1
        except Exception as e:
            results.append({"src": src, "dst": dst, "status": "error", "reason": str(e)[:300]})
            failed += 1
    return {"results": results, "moved": moved, "skipped": skipped, "failed": failed}


def _mkdir_impl(data):
    name = _valid_dir_name(str(data.get('name') or ''))
    if not name:
        return {"ok": False, "error": "名称非法"}
    parent_ref = parse_ref(str(data.get('parent') or ''))
    if parent_ref.kind == 'dav':
        path = (parent_ref.path.rstrip('/') or '') + '/' + name
        try:
            get_dav_client(parent_ref.source).mkdir(path)
            return {"ok": True, "path": 'dav:' + parent_ref.source + path}
        except Exception as e:
            return {"ok": False, "error": str(e)[:300]}
    parent = parent_ref.path
    if not os.path.isdir(parent):
        return {"ok": False, "error": "父目录不存在"}
    target = os.path.join(parent, name)
    if os.path.exists(target):
        return {"ok": False, "error": "exists"}
    try:
        os.mkdir(target)
        return {"ok": True, "path": 'local:' + target}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def _rmdir_impl(data):
    ref = parse_ref(str(data.get('path') or ''))
    if ref.kind == 'dav':
        try:
            get_dav_client(ref.source).delete(ref.path)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)[:300]}
    path = ref.path
    if not os.path.isdir(path):
        return {"ok": False, "error": "目录不存在"}
    if os.path.abspath(path).rstrip(os.sep) in FORBIDDEN_ROOTS:
        return {"ok": False, "error": "不允许删除根目录"}
    try:
        os.rmdir(path)
        return {"ok": True}
    except OSError as e:
        if e.errno in (getattr(errno, 'ENOTEMPTY', 39), getattr(errno, 'EEXIST', 17)):
            return {"ok": False, "error": "目录非空"}
        return {"ok": False, "error": str(e)[:300]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def _rename_impl(data):
    name = _valid_dir_name(str(data.get('new_name') or ''))
    if not name:
        return {"ok": False, "error": "名称非法"}
    ref = parse_ref(str(data.get('path') or ''))
    if ref.kind == 'dav':
        parent = os.path.dirname(ref.path.rstrip('/')) or '/'
        target = (parent.rstrip('/') or '') + '/' + name
        try:
            get_dav_client(ref.source).move(ref.path, target)
            return {"ok": True, "path": 'dav:' + ref.source + target}
        except Exception as e:
            return {"ok": False, "error": str(e)[:300]}
    path = ref.path
    if not os.path.isdir(path):
        return {"ok": False, "error": "目录不存在"}
    target = os.path.join(os.path.dirname(path.rstrip(os.sep)), name)
    if os.path.abspath(target) == os.path.abspath(path):
        return {"ok": True, "path": 'local:' + target}
    if os.path.exists(target):
        return {"ok": False, "error": "exists"}
    try:
        os.rename(path, target)
        return {"ok": True, "path": 'local:' + target}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def _delete_impl(data):
    refs = [parse_ref(p) for p in (data.get('paths') or [])]
    results, deleted, failed = [], 0, 0
    for ref in refs:
        try:
            if ref.kind == 'dav':
                get_dav_client(ref.source).delete(ref.path)
                results.append({"path": to_uri(ref), "status": "ok"})
                deleted += 1
                continue
            real = os.path.realpath(ref.path)
            if not any(real == pre or real.startswith(pre + '/') for pre in PUBLIC_PREFIXES):
                results.append({"path": to_uri(ref), "status": "error", "reason": "outside_sdcard"})
                failed += 1
                continue
            if real.rstrip(os.sep) in FORBIDDEN_ROOTS:
                results.append({"path": to_uri(ref), "status": "error", "reason": "root_forbidden"})
                failed += 1
                continue
            if os.path.islink(real) or os.path.isfile(real):
                os.remove(real)
            elif os.path.isdir(real):
                shutil.rmtree(real)
            else:
                results.append({"path": to_uri(ref), "status": "error", "reason": "not_found"})
                failed += 1
                continue
            results.append({"path": to_uri(ref), "status": "ok"})
            deleted += 1
        except Exception as e:
            results.append({"path": to_uri(ref), "status": "error", "reason": str(e)[:300]})
            failed += 1
    return {"results": results, "deleted": deleted, "failed": failed}


async def api_move(request: Request):
    data = await body(request)
    return J(await run_in_threadpool(_move_impl, data))


async def api_copy(request: Request):
    data = await body(request)
    return J(await run_in_threadpool(_move_impl, data, True))


async def api_mkdir(request: Request):
    data = await body(request)
    return J(await run_in_threadpool(_mkdir_impl, data))


async def api_rmdir(request: Request):
    data = await body(request)
    return J(await run_in_threadpool(_rmdir_impl, data))


async def api_rename_dir(request: Request):
    data = await body(request)
    return J(await run_in_threadpool(_rename_impl, data))


async def api_delete(request: Request):
    data = await body(request)
    return J(await run_in_threadpool(_delete_impl, data))


routes.append(Route('/api/tree', api_tree))
routes.append(Route('/api/move', api_move, methods=['POST']))
routes.append(Route('/api/copy', api_copy, methods=['POST']))
routes.append(Route('/api/mkdir', api_mkdir, methods=['POST']))
routes.append(Route('/api/rmdir', api_rmdir, methods=['POST']))
routes.append(Route('/api/rename_dir', api_rename_dir, methods=['POST']))
routes.append(Route('/api/delete', api_delete, methods=['POST']))
