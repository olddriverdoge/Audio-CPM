# -*- coding: utf-8 -*-
"""目录浏览 / 图片 / 探测（本地 + WebDAV）。Starlette 版。"""
import mimetypes
import os

from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import FileResponse, StreamingResponse
from starlette.routing import Route

from ..config import DEFAULT_ROOT, MEDIA_EXTS, IMAGE_EXTS
from ..meta import probe_file_detail, probe_fileobj
from ..simple import J, qs
from ..storage import get_dav_client, local_uri, parse_ref, to_uri
from ..storage.dav import HttpRangeFile

routes = []


def _quote(s):
    from urllib.parse import quote
    return quote(s, safe='')


def api_browse(request: Request):
    path = qs(request, 'path')
    ref = parse_ref(path) if path else parse_ref(local_uri(DEFAULT_ROOT))
    if ref.kind == 'dav':
        try:
            d = get_dav_client(ref.source).list(ref.path)
        except Exception as e:
            raise HTTPException(400, f"WebDAV 读取失败: {e}")
        prefix = 'dav:' + ref.source
        for x in d['dirs']:
            x['path'] = prefix + x['path']
        for x in d['files']:
            x['path'] = prefix + x['path']
        cover = None
        if d.get('cover'):
            cover = '/api/image?path=' + _quote(prefix + d['cover'][6:])
        return J({"path": to_uri(ref), "parent": prefix + d['parent'],
                  "dirs": d['dirs'], "files": d['files'], "cover": cover})

    p = ref.path
    if not os.path.isdir(p):
        p = DEFAULT_ROOT if os.path.isdir(DEFAULT_ROOT) else os.path.expanduser("~")
    dirs, files = [], []
    try:
        names = sorted(os.listdir(p))
    except Exception as e:
        raise HTTPException(400, f"无法读取目录: {e}")
    dir_cover = None
    for name in names:
        full = os.path.join(p, name)
        try:
            if os.path.isdir(full):
                dirs.append({"name": name, "path": local_uri(full), "type": "dir",
                             "mtime": os.path.getmtime(full)})
            else:
                ext = os.path.splitext(name)[1].lower()
                if ext in MEDIA_EXTS:
                    files.append({"name": name, "path": local_uri(full), "type": "media",
                                  "size": os.path.getsize(full), "mtime": os.path.getmtime(full)})
                elif ext in IMAGE_EXTS:
                    files.append({"name": name, "path": local_uri(full), "type": "image",
                                  "size": os.path.getsize(full), "mtime": os.path.getmtime(full)})
                    if dir_cover is None:
                        dir_cover = '/api/image?path=' + _quote(local_uri(full))
        except Exception:
            continue
    parent = os.path.dirname(p.rstrip(os.sep)) or "/"
    return J({"path": local_uri(p), "parent": local_uri(parent),
              "dirs": dirs, "files": files, "cover": dir_cover})


def api_image(request: Request):
    path = qs(request, 'path')
    ref = parse_ref(path)
    if ref.kind == 'dav':
        try:
            resp = get_dav_client(ref.source).open_range(ref.path)
        except Exception as e:
            raise HTTPException(400, f"WebDAV 读取失败: {e}")
        if resp.status_code not in (200, 206):
            raise HTTPException(resp.status_code, "not found")
        mt = resp.headers.get('content-type') or mimetypes.guess_type(ref.path)[0] or 'application/octet-stream'
        headers = {}
        if resp.headers.get('content-length'):
            headers['Content-Length'] = resp.headers['content-length']

        def gen():
            try:
                for chunk in resp.iter_bytes():
                    yield chunk
            finally:
                try:
                    resp.close()
                except Exception:
                    pass
        return StreamingResponse(gen(), media_type=mt, headers=headers)
    if not os.path.isfile(ref.path):
        raise HTTPException(404, "not found")
    if os.path.splitext(ref.path)[1].lower() not in IMAGE_EXTS:
        raise HTTPException(400, "not image")
    mt = mimetypes.guess_type(ref.path)[0] or 'application/octet-stream'
    return FileResponse(ref.path, media_type=mt)


def api_probe_file(request: Request):
    path = qs(request, 'path')
    ref = parse_ref(path)
    if ref.kind == 'dav':
        try:
            cli = get_dav_client(ref.source)
            st = cli.stat(ref.path)
            fobj = HttpRangeFile(cli, ref.path, st['size'])
            d = probe_fileobj(fobj, os.path.basename(ref.path), st['size'])
        except Exception as e:
            raise HTTPException(400, f"WebDAV 探测失败: {e}")
        d['path'] = to_uri(ref)
        return J(d)
    if not os.path.isfile(ref.path):
        raise HTTPException(404, "file not found")
    d = probe_file_detail(ref.path)
    d['path'] = to_uri(ref)
    return J(d)


routes.append(Route('/api/browse', api_browse))
routes.append(Route('/api/image', api_image))
routes.append(Route('/api/probe_file', api_probe_file))
