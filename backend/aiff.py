# -*- coding: utf-8 -*-
"""AIFF / AIFF-C → WAV（纯 Python 重封装，不重编码、不依赖 FFmpeg）。

只用于播放：/api/stream 对本地 .aif/.aiff 返回缓存的 WAV。
支持的压缩类型：NONE（大端 PCM）、sowt（小端 PCM）、fl32/FL32（float32）；其余（ima4/GSM 等）报不支持。
"""
import array
import hashlib
import os
import struct

from .config import DATA_DIR

CACHE_DIR = os.path.join(DATA_DIR, 'cache', 'aiff')
try:
    os.makedirs(CACHE_DIR, exist_ok=True)
except Exception:
    pass


class AiffError(Exception):
    pass


def _extended_to_float(b: bytes) -> float:
    """COMM 里的 sampleRate 是 80-bit IEEE extended。"""
    if len(b) < 10:
        return 0.0
    exp = ((b[0] & 0x7F) << 8) | b[1]
    mant = int.from_bytes(b[2:10], 'big')
    sign = -1.0 if (b[0] & 0x80) else 1.0
    if exp == 0 and mant == 0:
        return 0.0
    if exp == 0x7FFF:
        return sign * float('inf')
    return sign * mant * 2.0 ** (exp - 16383 - 63)


def parse(path):
    """返回 {channels, frames, bits, rate, compression, raw}。"""
    try:
        size = os.path.getsize(path)
        if size < 12:
            raise AiffError('file too small')
        with open(path, 'rb') as f:
            head = f.read(12)
            if head[:4] != b'FORM' or head[8:12] not in (b'AIFF', b'AIFC'):
                raise AiffError('not an AIFF file')
            comm = ssnd = None
            while True:
                ch = f.read(8)
                if len(ch) < 8:
                    break
                cid = ch[:4]
                csz = struct.unpack('>I', ch[4:8])[0]
                body = f.read(csz)
                if csz & 1:
                    f.read(1)
                if cid == b'COMM':
                    comm = body
                elif cid == b'SSND':
                    ssnd = body
    except AiffError:
        raise
    except Exception as e:
        raise AiffError(str(e)[:200])
    if not comm or ssnd is None:
        raise AiffError('missing COMM/SSND chunk')
    if len(comm) < 18:
        raise AiffError('bad COMM chunk')
    channels = struct.unpack('>H', comm[0:2])[0]
    frames = struct.unpack('>I', comm[2:6])[0]
    bits = struct.unpack('>H', comm[6:8])[0]
    rate = _extended_to_float(comm[8:18])
    comp = comm[18:22] if len(comm) >= 22 else b'NONE'
    try:
        comp_s = comp.decode('ascii', 'ignore')
    except Exception:
        comp_s = ''
    if comp_s not in ('NONE', 'sowt', 'fl32', 'FL32', 'fl64'):
        raise AiffError('压缩类型 %s 不支持' % (comp_s or '?'))
    if len(ssnd) < 8:
        raise AiffError('bad SSND chunk')
    offset = struct.unpack('>I', ssnd[0:4])[0]
    raw = ssnd[8 + offset:]
    return {'channels': channels, 'frames': frames, 'bits': bits,
            'rate': rate or 44100.0, 'compression': comp_s, 'raw': raw}


def _to_little_endian(raw: bytes, bits: int, little: bool, is_float: bool) -> bytes:
    if bits == 8 and not is_float:
        # AIFF 8-bit 有符号 → WAV 8-bit 无符号
        return bytes((b + 128) & 0xFF for b in raw)
    if little:
        return raw
    if is_float and bits == 32:
        a = array.array('f')
        a.frombytes(raw[:len(raw) - (len(raw) % 4)])
        a.byteswap()
        return a.tobytes()
    if bits == 16:
        a = array.array('h')
        a.frombytes(raw[:len(raw) - (len(raw) % 2)])
        a.byteswap()
        return a.tobytes()
    if bits == 32:
        a = array.array('i')
        a.frombytes(raw[:len(raw) - (len(raw) % 4)])
        a.byteswap()
        return a.tobytes()
    if bits == 24:
        n = len(raw) - (len(raw) % 3)
        out = bytearray(n)
        for i in range(0, n, 3):
            out[i] = raw[i + 2]
            out[i + 1] = raw[i + 1]
            out[i + 2] = raw[i]
        return bytes(out)
    raise AiffError('不支持的位深: %d' % bits)


def _write_wav(dst: str, info: dict):
    bits = info['bits']
    is_float = info['compression'] in ('fl32', 'FL32')
    if is_float:
        fmt_tag, bits = 3, 32
    elif bits == 64:
        raise AiffError('64-bit float AIFF 不支持')
    else:
        fmt_tag = 1
    channels = max(1, info['channels'])
    rate = int(round(info['rate'])) or 44100
    payload = _to_little_endian(info['raw'], bits, info['compression'] == 'sowt', is_float)
    block_align = channels * (bits // 8)
    byte_rate = rate * block_align
    data_size = len(payload)
    with open(dst, 'wb') as f:
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + data_size))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<IHHIIHH', 16, fmt_tag, channels, rate, byte_rate, block_align, bits))
        f.write(b'data')
        f.write(struct.pack('<I', data_size))
        f.write(payload)


def to_wav(path: str) -> str:
    """把 AIFF 转成 WAV 缓存并返回路径；失败抛 AiffError。"""
    try:
        st = os.stat(path)
    except OSError as e:
        raise AiffError(str(e))
    key = hashlib.md5(('aiff|%s|%s|%s' % (path, st.st_mtime_ns, st.st_size)).encode('utf-8', 'ignore')).hexdigest()
    dst = os.path.join(CACHE_DIR, key + '.wav')
    if os.path.isfile(dst) and os.path.getsize(dst) > 44:
        return dst
    info = parse(path)
    tmp = dst + '.part'
    try:
        _write_wav(tmp, info)
        os.replace(tmp, dst)
    except Exception as e:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass
        if isinstance(e, AiffError):
            raise
        raise AiffError(str(e)[:200])
    return dst
