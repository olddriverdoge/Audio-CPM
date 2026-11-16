# -*- coding: utf-8 -*-
"""音频波形包络：解码 + 分桶峰值 + 磁盘/内存缓存。

解码走可替换的 provider：
  - 默认：ffmpeg（Termux/PC 通用）
  - WAV：纯 Python（不依赖 ffmpeg，app 内也可用）
  - app 阶段：可注入 MediaCodec 桥（backend/native_bridge.py）
"""
import array
import hashlib
import json
import os
import threading
import time
from typing import Dict, List, Optional

from .config import DATA_DIR, WAVE_CACHE_DIR
from . import ffbin

_wave_mem: Dict[str, list] = {}
_wave_mem_lock = threading.Lock()


def _log(msg: str) -> None:
    """把耗时/回退路径写进 ac2.log，便于真机排查。"""
    try:
        with open(os.path.join(DATA_DIR, 'ac2.log'), 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')
    except Exception:
        pass
WAVE_MEM_MAX = 60

# 可选的原生解码钩子：app 内由 Kotlin 桥注册，返回 0~1 未归一化峰值或 None
native_provider = None


def _norm(peaks: List[float]) -> List[float]:
    """与旧实现一致：20% 分位做对比度拉伸。"""
    ordered = sorted(peaks)
    floor = ordered[max(0, int(len(ordered) * 0.2) - 1)]
    top = ordered[-1] or 1.0
    span = max(0.02, top - floor)
    return [round(0.06 + 0.94 * min(1.0, max(0.0, (p - floor) / span)) ** 0.9, 4) for p in peaks]


def _bucket_from_floats(vals: List[float], buckets: int) -> List[float]:
    if not vals:
        return []
    step = max(1, len(vals) // buckets)
    out = []
    for i in range(buckets):
        chunk = vals[i * step:(i + 1) * step]
        out.append(max(abs(v) for v in chunk) if chunk else 0.0)
    return out


def _peaks_wave_pcm(path: str, buckets: int) -> Optional[List[float]]:
    """WAV 纯 Python 读取（16/24/32-bit PCM），失败返回 None。"""
    try:
        import wave as wave_mod
        with wave_mod.open(path, 'rb') as w:
            nch, sw, total = w.getnchannels(), w.getsampwidth(), w.getnframes()
            if nch < 1 or sw not in (1, 2, 3, 4) or total <= 0:
                return None
            step = max(1, total // (buckets * 64))
            peaks = [0.0] * buckets
            idx = 0
            frame_bytes = nch * sw
            for _ in range(0, total, step):
                raw = w.readframes(step)
                if not raw:
                    break
                acc = 0.0
                for off in range(0, len(raw) - frame_bytes + 1, frame_bytes):
                    for ch in range(nch):
                        b = raw[off + ch * sw: off + (ch + 1) * sw]
                        if sw == 1:
                            v = (b[0] - 128) / 128.0
                        elif sw == 2:
                            v = int.from_bytes(b, 'little', signed=True) / 32768.0
                        elif sw == 3:
                            v = int.from_bytes(b, 'little', signed=True) / 8388608.0
                        else:
                            v = int.from_bytes(b, 'little', signed=True) / 2147483648.0
                        acc = max(acc, abs(v))
                bucket = min(buckets - 1, int(idx * buckets / total))
                peaks[bucket] = max(peaks[bucket], acc)
                idx += step
        return peaks
    except Exception:
        return None


def _peaks_ffmpeg(path: str, buckets: int) -> List[float]:
    import subprocess
    cmd = ffbin.cmd('-v', 'error', '-nostdin', '-i', path, '-vn',
           '-ac', '1', '-ar', '4000', '-f', 's16le', '-')
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=120, env=ffbin.ENV)
        raw = proc.stdout or b''
    except Exception:
        return []
    if len(raw) < 2:
        return []
    samples = array.array('h')
    try:
        samples.frombytes(raw[:len(raw) - (len(raw) % 2)])
    except Exception:
        return []
    if not samples:
        return []
    step = max(1, len(samples) // buckets)
    peaks = []
    for i in range(buckets):
        chunk = samples[i * step:(i + 1) * step]
        if not chunk:
            peaks.append(0.0)
            continue
        peaks.append(max(abs(min(chunk)), abs(max(chunk))) / 32768.0)
    return peaks


def _peaks_native(path: str, buckets: int) -> Optional[List[float]]:
    """app 内走 Java Ac2Wave（MediaExtractor + MediaCodec），无需 ffmpeg。

    Chaquopy 把 Java 结果写成临时 JSON 再读回，避免数组类型转换差异。
    """
    if not os.environ.get('AC2_ANDROID'):
        return None
    try:
        from java import jclass  # type: ignore  # Chaquopy 提供
        Cls = jclass('com.github.olddriverdoge.audiocpm.Ac2Wave')
    except Exception:
        return None
    tmp = None
    try:
        import tempfile
        fd, tmp = tempfile.mkstemp(suffix='.json', dir=WAVE_CACHE_DIR)
        os.close(fd)
        os.unlink(tmp)
        if not bool(Cls.peaks(str(path), int(buckets), tmp)):
            return None
        with open(tmp, 'r', encoding='utf-8') as f:
            d = json.load(f)
        peaks = d.get('peaks')
        if not isinstance(peaks, list) or not peaks:
            return None
        return [float(x) for x in peaks]
    except Exception:
        return None
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except Exception:
                pass


def compute_wave_peaks(path: str, buckets: int = 160) -> list:
    buckets = max(32, min(400, int(buckets or 160)))
    try:
        st = os.stat(path)
        stamp = f"v3|{path}|{st.st_mtime_ns}|{st.st_size}|{buckets}"
    except OSError:
        return []
    key = hashlib.md5(stamp.encode('utf-8', 'ignore')).hexdigest()
    t0 = time.perf_counter()
    with _wave_mem_lock:
        hit = _wave_mem.get(key)
    if hit is not None:
        return hit
    cache = os.path.join(WAVE_CACHE_DIR, key + '.json')
    if os.path.isfile(cache):
        try:
            with open(cache, 'r', encoding='utf-8') as f:
                peaks = json.load(f)
            if isinstance(peaks, list) and peaks:
                with _wave_mem_lock:
                    _wave_mem[key] = peaks
                return peaks
        except Exception:
            pass

    ext = os.path.splitext(path)[1].lower()
    peaks = None
    # ffmpeg 主路径：一次解码到 4kHz 单声道，几十 MB 的文件也在百毫秒级；
    # 之前把 Java MediaCodec 桥排在前面，导致每首歌都要全量解码 + 跨语言传数组，慢一个量级。
    if ffbin.available():
        got = _peaks_ffmpeg(path, buckets)
        if got:
            peaks = got
    if peaks is None and ext == '.wav':
        # 纯 Python 只适合短 WAV（ffmpeg 不可用时兜底）
        peaks = _peaks_wave_pcm(path, buckets)
    if peaks is None:
        peaks = _peaks_native(path, buckets)
    if peaks is None:
        peaks = _peaks_ffmpeg(path, buckets)
    if not peaks:
        return []
    _log('waveform %s buckets=%d %.0fms' % (os.path.basename(path), buckets, (time.perf_counter() - t0) * 1000))
    peaks = _norm(peaks)
    with _wave_mem_lock:
        if len(_wave_mem) >= WAVE_MEM_MAX:
            _wave_mem.pop(next(iter(_wave_mem)), None)
        _wave_mem[key] = peaks
    try:
        os.makedirs(WAVE_CACHE_DIR, exist_ok=True)
        tmp = cache + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(peaks, f)
        os.replace(tmp, cache)
    except Exception:
        pass
    return peaks
