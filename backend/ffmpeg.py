# -*- coding: utf-8 -*-
"""FFmpeg 封装：执行（含 env 透传）、进度解析、递归收集。probe 已全部走 mutagen（backend/meta.py）。"""
import os, sys, re, json, time, uuid, queue, threading, subprocess, asyncio, errno
import multiprocessing, traceback, tempfile, hashlib, mimetypes, shutil
from typing import List, Tuple, Optional, Dict, Any, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from .config import MEDIA_EXTS, LOSSLESS_CODECS
from . import ffbin
from . import cancel

# ============================================================
# 基础工具
# ============================================================
def execute(command, timeout=None, env=None):
    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, env=env if env is not None else ffbin.ENV)
        out = (result.stdout or b'').decode('utf-8', 'ignore')
        err = (result.stderr or b'').decode('utf-8', 'ignore')
        return result.returncode == 0, (out + err)
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except Exception as e:
        return False, str(e)

def _isna(x):
    if x is None: return True
    try: return x != x
    except Exception: return False

def clean_text(text):
    if _isna(text) or text == '':
        return ''
    text = str(text)
    KEYWORDS = {'publish', '.net', '.com'}
    SEP = re.compile(r'(\s*[;%|-]\s*)')
    LEAD = re.compile(r'^\s*[%;|,-]\s*')
    TAIL = re.compile(r'\s*[%;|,-]\s*$')
    parts = SEP.split(text)
    cleaned, i = [], 0
    while i < len(parts):
        part = parts[i]
        if SEP.fullmatch(part):
            nxt = parts[i+1] if i+1 < len(parts) else ''
            if any(k in nxt.lower() for k in KEYWORDS):
                i += 2; continue
            cleaned.extend([part, nxt]); i += 2
        else:
            cleaned.append(part); i += 1
    out = ''.join(cleaned)
    out = LEAD.sub('', out); out = TAIL.sub('', out)
    return out.strip()

def check_hwaccel_support():
    try:
        r = subprocess.run(ffbin.cmd('-hwaccels'), capture_output=True, text=True,
                           timeout=5, env=ffbin.ENV)
        return 'mediacodec' in r.stdout.lower()
    except Exception:
        return False

def get_max_workers():
    try: return min(4, max(2, multiprocessing.cpu_count()))
    except Exception: return 2

def parse_format_spec(spec: str) -> dict:
    spec = (spec or '').strip() or 'FLAC'
    parts = spec.upper().split('-')
    codec = parts[0].lower()
    lossless = codec in LOSSLESS_CODECS
    bits = sr = bitrate = None
    rest = parts[1:]
    if lossless:
        if len(rest) >= 1 and rest[0]:
            try: bits = int(rest[0])
            except: pass
        if len(rest) >= 2 and rest[1]:
            try: sr = int(rest[1]) * 1000
            except: pass
    else:
        if len(rest) >= 1 and rest[0]:
            try: bitrate = int(rest[0])
            except: pass
    return {"codec": codec, "lossless": lossless, "bits": bits,
            "sr": sr, "bitrate": bitrate, "spec": spec}

AUDIO_CODEC_MAP = {
    'flac': 'flac', 'mp3': 'libmp3lame', 'm4a': 'aac', 'aac': 'aac',
    'ogg': 'libvorbis', 'opus': 'libopus', 'alac': 'alac',
}

def pick_audio_codec(codec: str, bits: Optional[int]) -> str:
    if codec == 'wav':
        b = bits or 16; return f'pcm_s{min(b,32)}le'
    if codec in ('aif','aiff'):
        b = bits or 16; return f'pcm_s{min(b,32)}be'
    return AUDIO_CODEC_MAP.get(codec, codec)

def _terminate(proc):
    try:
        proc.terminate()
    except Exception:
        pass
    try:
        proc.wait(timeout=2)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def execute_ffmpeg_with_progress(cmd: List[str], total_sec: float,
                                 on_progress: Optional[Callable[[int], None]] = None,
                                 cancel_check: Optional[Callable[[], bool]] = None) -> Tuple[bool, str]:
    """执行 ffmpeg 并解析 -progress 输出；支持中途取消（terminate→kill）。"""
    cmd = list(cmd)
    if '-progress' not in cmd:
        cmd = cmd[:-1] + ['-progress', 'pipe:1', '-nostats', cmd[-1]]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, bufsize=1, env=ffbin.ENV)
    except Exception as e:
        return False, str(e)
    err_buf = []

    def _rd_err():
        try:
            for line in proc.stderr:
                err_buf.append(line)
        except Exception:
            pass
    threading.Thread(target=_rd_err, daemon=True).start()

    out_q = queue.Queue()

    def _rd_out():
        try:
            for line in proc.stdout:
                out_q.put(line)
        except Exception:
            pass
        finally:
            out_q.put(None)
    threading.Thread(target=_rd_out, daemon=True).start()

    last = -1
    cancelled = False
    while True:
        if cancel_check and cancel_check():
            cancelled = True
            _terminate(proc)
            break
        try:
            line = out_q.get(timeout=0.2)
        except queue.Empty:
            if proc.poll() is not None:
                try:
                    line = out_q.get(timeout=0.5)
                except queue.Empty:
                    break
                if line is None:
                    break
            continue
        if line is None:
            break
        line = line.strip()
        if not on_progress:
            continue
        if line.startswith('out_time_ms='):
            try:
                micro = int(line.split('=', 1)[1])
                sec = micro / 1_000_000.0
                if total_sec and total_sec > 0:
                    pct = max(0, min(99, int(sec / total_sec * 100)))
                    if pct != last:
                        last = pct
                        on_progress(pct)
            except Exception:
                pass
    try:
        proc.wait(timeout=3)
    except Exception:
        pass
    if cancelled:
        return False, 'cancelled'
    if on_progress and proc.returncode == 0:
        on_progress(100)
    return proc.returncode == 0, ''.join(err_buf)


def collect_media_recursive(folder: str, exts: set) -> List[str]:
    out = []
    for root, _, files in os.walk(folder):
        for f in files:
            if os.path.splitext(f)[1].lower() in exts:
                out.append(os.path.join(root, f))
    return out
