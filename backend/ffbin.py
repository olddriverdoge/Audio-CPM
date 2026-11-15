# -*- coding: utf-8 -*-
"""FFmpeg 二进制定位：Termux/PC 直接用 PATH，app 内从 nativeLibraryDir 复制到私有目录并设 LD_LIBRARY_PATH。

业务代码统一用 `ffbin.FFMPEG` / `ffbin.ENV`，不关心平台差异。
"""
import os
import shutil
import sys

from .config import DATA_DIR, FFMPEG_BIN

FFMPEG = FFMPEG_BIN
ENV = None          # None = 继承当前进程环境
_ready = False


def is_android() -> bool:
    return bool(os.environ.get('AC2_ANDROID')
                or os.environ.get('ANDROID_ARGUMENT')
                or 'android' in sys.platform.lower() and 'ANDROID' in os.environ)


def _copy_native(native_dir: str) -> str:
    dst_dir = os.path.join(DATA_DIR, 'bin')
    os.makedirs(dst_dir, exist_ok=True)
    for n in os.listdir(native_dir):
        if not (n == 'libffmpegbin.so' or n.startswith('libav') or n.startswith('libsw')):
            continue
        src = os.path.join(native_dir, n)
        out = os.path.join(dst_dir, 'ffmpeg' if n == 'libffmpegbin.so' else n)
        if not os.path.exists(out) or os.path.getsize(out) != os.path.getsize(src):
            try:
                shutil.copy2(src, out)
            except Exception:
                continue
    exe = os.path.join(dst_dir, 'ffmpeg')
    if os.path.exists(exe):
        try:
            os.chmod(exe, 0o755)
        except Exception:
            pass
    return exe


def prepare() -> str:
    """幂等：返回可执行的 ffmpeg 路径（同时设置 ENV）。"""
    global FFMPEG, ENV, _ready
    if _ready:
        return FFMPEG
    _ready = True
    if not is_android():
        return FFMPEG
    native = os.environ.get('AC2_NATIVE_LIB_DIR') or ''
    if not native or not os.path.isdir(native):
        return FFMPEG
    exe = _copy_native(native)
    if os.path.exists(exe):
        FFMPEG = exe
        ENV = dict(os.environ)
        ENV['LD_LIBRARY_PATH'] = os.path.dirname(exe)
    return FFMPEG


def env():
    return ENV
