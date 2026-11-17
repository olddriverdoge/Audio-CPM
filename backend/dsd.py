# -*- coding: utf-8 -*-
"""DSD（.dsf/.dff）播放：ExoPlayer 不解 DSD，这里用 FFmpeg 一次性转成 PCM WAV 并缓存。

不是 native DSD 直通：DSD 位流必须先低通解成 PCM，任何播放器都一样，区别只是在哪一步做。
转换结果按 路径+mtime+size 缓存，点进度条/切歌不会重复转。
"""
import hashlib
import os

from . import ffbin
from .config import DATA_DIR
from .ffmpeg import execute

CACHE_DIR = os.path.join(DATA_DIR, 'dsd_cache')


class DsdError(Exception):
    pass


def to_pcm_wav(path):
    try:
        st = os.stat(path)
    except OSError as e:
        raise DsdError('无法读取文件: %s' % e)
    key = hashlib.md5(('%s|%d|%d' % (path, st.st_mtime, st.st_size)).encode('utf-8')).hexdigest()
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
    except Exception as e:
        raise DsdError('缓存目录不可写: %s' % e)
    out = os.path.join(CACHE_DIR, key + '.wav')
    if os.path.isfile(out) and os.path.getsize(out) > 44:
        return out
    tmp = out + '.part'
    ok, msg = execute(ffbin.cmd('-y', '-i', path, '-map', '0:a:0',
                                '-ar', '48000', '-ac', '2',
                                '-c:a', 'pcm_s24le', '-f', 'wav', tmp), timeout=600)
    if not ok or not os.path.isfile(tmp) or os.path.getsize(tmp) <= 44:
        try:
            os.remove(tmp)
        except Exception:
            pass
        tail = (msg or '').strip().splitlines()
        raise DsdError('DSD 转 PCM 失败: ' + (tail[-1] if tail else 'ffmpeg error'))
    os.replace(tmp, out)
    return out
