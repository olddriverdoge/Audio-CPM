# -*- coding: utf-8 -*-
"""WebDAV 播放：把远端文件落到本地缓存再交给 FileResponse。

原因：Chrome/WebView 的 <audio> 和 ExoPlayer 都依赖 Range 请求与准确的 Content-Length，
不同 WebDAV 服务端对 Range 的实现差异很大（有的直接回 200 全量、有的漏 Content-Length），
表现为“点开没反应 / UnrecognizedInputFormat / 播两秒断”。落盘后由本机静态服务提供，
Range 稳定；同一个文件按 源+路径+大小 缓存，第二次起秒开。
"""
import hashlib
import os

from .config import DATA_DIR
from .storage import get_dav_client

CACHE_DIR = os.path.join(DATA_DIR, 'dav_cache')


class DavStreamError(Exception):
    pass


def cached_path(source, path):
    cli = get_dav_client(source)
    try:
        st = cli.stat(path)
        size = int(st.get('size') or 0)
    except Exception as e:
        raise DavStreamError('WebDAV 读取失败: %s' % e)
    key = hashlib.md5(('%s|%s|%d' % (source, path, size)).encode('utf-8')).hexdigest()
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
    except Exception as e:
        raise DavStreamError('缓存目录不可写: %s' % e)
    local = os.path.join(CACHE_DIR, key + (os.path.splitext(path)[1] or '.bin'))
    if os.path.isfile(local) and (size <= 0 or os.path.getsize(local) == size):
        return local
    tmp = local + '.part'
    try:
        resp = cli.open_range(path, None)
    except Exception as e:
        raise DavStreamError('WebDAV 读取失败: %s' % e)
    if resp.status_code not in (200, 206):
        raise DavStreamError('WebDAV 返回 %s' % resp.status_code)
    try:
        with open(tmp, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=1024 * 64):
                if chunk:
                    f.write(chunk)
    finally:
        try:
            resp.close()
        except Exception:
            pass
    if not os.path.isfile(tmp) or os.path.getsize(tmp) <= 0:
        try:
            os.remove(tmp)
        except Exception:
            pass
        raise DavStreamError('WebDAV 返回空文件')
    os.replace(tmp, local)
    return local
