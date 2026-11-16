# -*- coding: utf-8 -*-
"""封面 / 缩略图 / 波形 / 流式播放 / 系统播放器。Starlette 版。"""
import hashlib
import logging
import mimetypes
import os
import re
import shutil
import subprocess

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import FileResponse, Response, StreamingResponse
from starlette.routing import Route

from ..config import COVER_CACHE_DIR, MEDIA_EXTS, PUBLIC_PREFIXES
from .. import ffbin
from ..ffmpeg import execute
from ..meta import cover_bytes, cover_from_fileobj, probe_file_detail
from ..simple import J, body, qs
from ..storage import get_dav_client, parse_ref
from ..storage.dav import HttpRangeFile
from ..waveform import compute_wave_peaks

routes = []
logger = logging.getLogger("ac2.media")

THUMB_SIZES = (48, 96, 128, 192)
PLAYER_RE = re.compile(r'^[A-Za-z0-9._]+$')
ACTIVITY_RE = re.compile(r'^[A-Za-z0-9._]+/[A-Za-z0-9._$]+$')


def _in_public_storage(path):
    cands = {os.path.normpath(path)}
    try:
        cands.add(os.path.realpath(path))
    except Exception:
        pass
    for c in cands:
        for base in PUBLIC_PREFIXES:
            if c == base or c.startswith(base + '/'):
                return True
    return False


async def api_play(request: Request):
    data = await body(request)
    return await run_in_threadpool(_play_impl, data)


def _play_impl(data):
    ref = parse_ref(str(data.get('path') or ''))
    if ref.kind == 'dav':
        return J({"status": "blocked", "message": "WebDAV 文件不支持外部播放器"})
    path = ref.path
    if not path or not os.path.isfile(path):
        return J({"status": "error", "message": "文件不存在"})
    if not _in_public_storage(path):
        return J({"status": "blocked", "message": "路径不在公共存储，系统播放器无法访问"})
    player = str(data.get('player') or '').strip()
    activity = str(data.get('activity') or '').strip()
    # app 内走原生桥（Intent + FileProvider）；Termux 返回 None 继续用 am
    from .. import native_bridge
    native = native_bridge.open_external(path, player, activity)
    if native is not None:
        return J(native)
    if player and not PLAYER_RE.match(player):
        return J({"status": "error", "message": "播放器包名格式不合法"})
    if activity and not ACTIVITY_RE.match(activity):
        return J({"status": "error", "message": "Activity 格式应为 包名/Activity"})
    if not shutil.which('am'):
        return J({"status": "error", "message": "设备不支持 am 命令"})
    from urllib.parse import quote as _q
    uri = 'file://' + _q(path, safe='/')
    cmd = ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', uri, '-t', 'audio/*']
    if activity:
        cmd += ['-n', activity]
    elif player:
        cmd += ['-p', player]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except subprocess.TimeoutExpired:
        return J({"status": "error", "message": "am start 超时"})
    except Exception as e:
        return J({"status": "error", "message": str(e)[:300]})
    if r.returncode == 0:
        return J({"status": "ok", "message": "intent sent"})
    msg = ((r.stderr or '') + (r.stdout or '')).strip()[-300:] or f"am exit {r.returncode}"
    if player or activity:
        msg += "（可在 ⚙ 播放设置中更换或清空播放器）"
    return J({"status": "error", "message": msg})


def api_stream(request: Request):
    path = qs(request, 'path')
    ref = parse_ref(path)
    if ref.kind == 'dav':
        try:
            resp = get_dav_client(ref.source).open_range(ref.path, request.headers.get('range'))
        except Exception as e:
            raise HTTPException(400, f"WebDAV 读取失败: {e}")
        if resp.status_code not in (200, 206):
            raise HTTPException(resp.status_code, "not found")
        mt = (resp.headers.get('content-type') or
              mimetypes.guess_type(ref.path)[0] or 'application/octet-stream')
        headers = {}
        for h, name in (('content-range', 'Content-Range'),
                        ('content-length', 'Content-Length'),
                        ('accept-ranges', 'Accept-Ranges')):
            if resp.headers.get(h):
                headers[name] = resp.headers[h]
        headers.setdefault('Accept-Ranges', 'bytes')
        if request.headers.get('range') and 'Content-Range' not in headers:
            headers['X-AC2-Range'] = 'unsupported'
        def gen():
            try:
                for chunk in resp.iter_bytes():
                    yield chunk
            finally:
                try:
                    resp.close()
                except Exception:
                    pass
        return StreamingResponse(gen(), status_code=resp.status_code,
                                 media_type=mt, headers=headers)
    if not os.path.isfile(ref.path):
        # 区分“文件不存在”和“有文件但没权限”：安卓上未授权时 stat 同样返回 False，
        # 直接报 404 会让人误以为文件丢了。
        try:
            os.stat(ref.path)
        except PermissionError as e:
            logger.warning("stream: permission denied %s: %s", ref.path, e)
            raise HTTPException(403, "无权限读取该文件，请在系统设置里授予“所有文件访问权限”")
        except Exception as e:
            logger.warning("stream: stat failed %s: %s", ref.path, e)
        raise HTTPException(404, "file not found")
    ext = os.path.splitext(ref.path)[1].lower()
    if ext not in MEDIA_EXTS:
        raise HTTPException(400, "not media")
    if ext in ('.aif', '.aiff'):
        # 纯 Python 重封装成 WAV（不重编码、不依赖 FFmpeg）
        from ..aiff import to_wav, AiffError
        try:
            wav = to_wav(ref.path)
        except AiffError as e:
            raise HTTPException(415, f"AIFF 暂不支持: {e}")
        return FileResponse(wav, media_type='audio/wav')
    mt = mimetypes.guess_type(ref.path)[0] or 'application/octet-stream'
    return FileResponse(ref.path, media_type=mt)


def api_thumb(request: Request):
    path = qs(request, 'path')
    try:
        size = int(qs(request, 'size', '96'))
    except (TypeError, ValueError):
        size = 96
    if size not in THUMB_SIZES:
        size = 96
    ref = parse_ref(path)
    if ref.kind == 'dav':
        try:
            cli = get_dav_client(ref.source)
            st = cli.stat(ref.path)
            got = cover_from_fileobj(HttpRangeFile(cli, ref.path, st['size']))
        except Exception as e:
            raise HTTPException(400, f"WebDAV 读取失败: {e}")
        if not got:
            raise HTTPException(404, "no cover")
        return Response(content=got[0], media_type=got[1] or 'image/jpeg')
    path = ref.path
    if not os.path.isfile(path):
        raise HTTPException(404, "file not found")
    if os.path.splitext(path)[1].lower() not in MEDIA_EXTS:
        raise HTTPException(400, "not media")
    detail = probe_file_detail(path)
    if detail.get('error') or not detail.get('has_cover'):
        raise HTTPException(404, "no cover")
    try:
        mt, fsz = os.path.getmtime(path), os.path.getsize(path)
    except Exception:
        mt, fsz = 0, 0
    h = hashlib.md5(f"{path}|{mt}|{fsz}|{size}".encode('utf-8')).hexdigest()
    temp = os.path.join(COVER_CACHE_DIR, f"{h}.jpg")
    if os.path.exists(temp):
        return FileResponse(temp, media_type="image/jpeg")
    try:
        os.makedirs(COVER_CACHE_DIR, exist_ok=True)
    except Exception:
        pass
    cmd = [ffbin.FFMPEG, '-y', '-i', path, '-an', '-vcodec', 'mjpeg',
           '-vf', f'scale={size}:-1', '-frames:v', '1', '-f', 'image2', temp]
    ok, err = execute(cmd, timeout=20)
    if not ok or not os.path.exists(temp):
        raise HTTPException(500, (err or 'extract failed')[-300:])
    return FileResponse(temp, media_type="image/jpeg")


def api_cover(request: Request):
    path = qs(request, 'path')
    ref = parse_ref(path)
    if ref.kind == 'dav':
        try:
            cli = get_dav_client(ref.source)
            st = cli.stat(ref.path)
            got = cover_from_fileobj(HttpRangeFile(cli, ref.path, st['size']))
        except Exception as e:
            raise HTTPException(400, f"WebDAV 读取失败: {e}")
        if not got:
            raise HTTPException(404, "no cover")
        return Response(content=got[0], media_type=got[1] or 'image/jpeg')
    path = ref.path
    if not os.path.isfile(path):
        raise HTTPException(404, "file not found")
    try:
        mt = os.path.getmtime(path)
        fsz = os.path.getsize(path)
    except Exception:
        mt, fsz = 0, 0
    h = hashlib.md5(f"{path}|{mt}|{fsz}".encode('utf-8')).hexdigest()
    got = cover_bytes(path)
    if got:
        data, mime = got
        ext = '.png' if 'png' in (mime or '') else '.jpg'
        temp = os.path.join(COVER_CACHE_DIR, h + ext)
        if not os.path.exists(temp):
            try:
                os.makedirs(COVER_CACHE_DIR, exist_ok=True)
                tmp = temp + '.tmp'
                with open(tmp, 'wb') as f:
                    f.write(data)
                os.replace(tmp, temp)
            except Exception:
                raise HTTPException(500, "cache write failed")
        return FileResponse(temp, media_type=mime or 'image/jpeg')
    raise HTTPException(404, "no cover")



def api_waveform(request: Request):
    path = qs(request, 'path')
    try:
        buckets = int(qs(request, 'buckets', '160'))
    except (TypeError, ValueError):
        buckets = 160
    ref = parse_ref(path)
    if ref.kind == 'dav':
        raise HTTPException(501, "waveform not supported for webdav")
    path = ref.path
    if not os.path.isfile(path):
        raise HTTPException(404, "file not found")
    if os.path.splitext(path)[1].lower() not in MEDIA_EXTS:
        raise HTTPException(400, "not media")
    peaks = compute_wave_peaks(path, buckets)
    if not peaks:
        raise HTTPException(500, "decode failed")
    return J({"path": path, "buckets": len(peaks), "peaks": peaks})


routes.append(Route('/api/play', api_play, methods=['POST']))
routes.append(Route('/api/stream', api_stream))
routes.append(Route('/api/thumb', api_thumb))
routes.append(Route('/api/cover', api_cover))
routes.append(Route('/api/waveform', api_waveform))
