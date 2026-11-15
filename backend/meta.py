# -*- coding: utf-8 -*-
"""元数据 / 封面：全部走 mutagen（纯 Python，app 内可用，无 ffprobe 依赖）。

支持两种输入：
  - 本地路径：probe_file_detail(path) / cover_bytes(path)
  - 类文件对象（WebDAV Range）：probe_fileobj(fileobj, name, size)
输出结构统一为 {"path","name","format":{...},"audio":{...},"has_cover":bool,"tags":{...}}
"""
import base64
import os
from typing import Optional, Tuple

from .config import MEDIA_EXTS

try:
    import mutagen
    from mutagen.flac import FLAC, Picture
    from mutagen.mp4 import MP4
    from mutagen.apev2 import APEv2
except Exception:  # pragma: no cover
    mutagen = None

_KEY_MAP = {
    'TIT2': 'title', 'TPE1': 'artist', 'TPE2': 'album_artist', 'TALB': 'album',
    'TCOM': 'composer', 'TRCK': 'track', 'TPOS': 'disc', 'TDRC': 'date',
    'TYER': 'date', 'TCON': 'genre', 'TSSE': 'encoder', 'TENC': 'encoder',
    '©nam': 'title', '©ART': 'artist', 'aART': 'album_artist', '©alb': 'album',
    '©wrt': 'composer', '©day': 'date', '©gen': 'genre', 'trkn': 'track',
    'disk': 'disc', 'albumartist': 'album_artist', 'discnumber': 'disc',
    'tracknumber': 'track', 'date': 'date', 'year': 'date', 'genre': 'genre',
}


def _norm_key(k):
    s = str(k).strip()
    low = s.lower()
    return _KEY_MAP.get(s) or _KEY_MAP.get(low) or low


def _norm_val(v):
    if isinstance(v, (list, tuple)):
        return ' / '.join(_norm_val(x) for x in v)
    if isinstance(v, bytes):
        try:
            return v.decode('utf-8', 'ignore')
        except Exception:
            return ''
    return str(v)


def _norm_tags(tags):
    out = {}
    if not tags:
        return out
    try:
        for k, v in tags.items():
            key = _norm_key(k)
            if key in ('comm',):
                key = 'comment'
            val = _norm_val(v)
            if val and key not in out:
                out[key] = val
    except Exception:
        pass
    return out


def _codec_name(f, ext):
    n = type(f).__name__.lower()
    if n == 'flac':
        return 'flac'
    if n == 'mp3':
        return 'mp3'
    if n == 'mp4':
        codec = str(getattr(getattr(f, 'info', None), 'codec', '') or '').lower()
        return 'alac' if 'alac' in codec else 'aac'
    if n == 'oggvorbis':
        return 'vorbis'
    if n == 'oggopus':
        return 'opus'
    if n == 'wave':
        return 'pcm_s16le'
    if n == 'aiff':
        return 'pcm_s16be'
    if ext in ('.dsf', '.dff'):
        return 'dsd'
    if ext == '.wv':
        return 'wavpack'
    return ext.lstrip('.') or 'unknown'


def _fmt_name(f, ext):
    n = type(f).__name__.lower()
    return {
        'flac': 'flac', 'mp3': 'mp3', 'mp4': 'mov,mp4,m4a,3gp,3g2,mj2',
        'oggvorbis': 'ogg', 'oggopus': 'ogg', 'wave': 'wav', 'aiff': 'aiff',
    }.get(n, ext.lstrip('.') or 'unknown')


def _sample_fmt(bits):
    if bits in (8, 16):
        return 's16'
    if bits in (24, 32):
        return 's32'
    return 's16'


def _audio_dict(f, ext):
    info = getattr(f, 'info', None)
    bits = int(getattr(info, 'bits_per_sample', 0) or 0)
    sr = int(getattr(info, 'sample_rate', 0) or 0)
    ch = int(getattr(info, 'channels', 0) or 0)
    br = int(getattr(info, 'bitrate', 0) or 0)
    dur = float(getattr(info, 'length', 0) or 0)
    return {
        'codec_name': _codec_name(f, ext),
        'codec_long_name': '',
        'sample_fmt': _sample_fmt(bits),
        'sample_rate': sr or None,
        'channels': ch or None,
        'channel_layout': ('stereo' if ch == 2 else ('mono' if ch == 1 else None)),
        'bits_per_sample': bits or None,
        'bits_per_raw_sample': None,
        'bit_rate': br or None,
        'duration': str(dur) if dur else None,
    }


def _cover_from(f) -> Optional[Tuple[bytes, str]]:
    try:
        if isinstance(f, FLAC):
            if f.pictures:
                p = f.pictures[0]
                return p.data, (p.mime or 'image/jpeg')
        if isinstance(f, MP4):
            covr = f.tags.get('covr') if f.tags else None
            if covr:
                data = bytes(covr[0])
                fmt = str(getattr(covr[0], 'imageformat', '')).lower()
                return data, ('image/png' if 'png' in fmt else 'image/jpeg')
        tags = getattr(f, 'tags', None)
        if tags:
            for k in list(tags.keys()):
                if str(k).upper().startswith('APIC'):
                    apic = tags[k]
                    return apic.data, (getattr(apic, 'mime', '') or 'image/jpeg')
        if isinstance(tags, APEv2) or (tags is not None and 'Cover Art (Front)' in tags):
            for key in ('Cover Art (Front)', 'Cover Art (Back)'):
                if key in tags:
                    data = tags[key].value
                    if b'\x00' in data:
                        data = data.split(b'\x00', 1)[1]
                    return data, 'image/jpeg'
        if tags is not None and tags.get('metadata_block_picture'):
            raw = tags.get('metadata_block_picture')
            data = base64.b64decode(raw[0] if isinstance(raw, list) else raw)
            pic = Picture(data)
            return pic.data, (pic.mime or 'image/jpeg')
    except Exception:
        pass
    return None


def _probe_object(f, ext, size=None):
    if f is None:
        raise ValueError('unrecognized audio')
    if getattr(f, 'info', None) is None:
        raise ValueError('no audio info')
    has_cover = _cover_from(f) is not None
    info = f.info
    dur = float(getattr(info, 'length', 0) or 0)
    br = int(getattr(info, 'bitrate', 0) or 0)
    return {
        'format': {
            'format_name': _fmt_name(f, ext),
            'duration': str(dur) if dur else None,
            'size': str(size) if size is not None else None,
            'bit_rate': str(br) if br else None,
            'nb_streams': 1 + (1 if has_cover else 0),
        },
        'audio': _audio_dict(f, ext),
        'has_cover': has_cover,
        'tags': _norm_tags(getattr(f, 'tags', None)),
    }


def probe_file_detail(path: str) -> dict:
    """只走 mutagen（无 ffprobe 回退）：读取失败返回 error 结构。"""
    if os.path.splitext(path)[1].lower() not in MEDIA_EXTS:
        return {'path': path, 'name': os.path.basename(path),
                'error': '不是音频文件，无法读取音频元数据', 'has_cover': False, 'tags': {}}
    if mutagen is None:
        return {'path': path, 'name': os.path.basename(path),
                'error': 'mutagen not installed', 'has_cover': False, 'tags': {}}
    try:
        f = mutagen.File(path)
        d = _probe_object(f, os.path.splitext(path)[1].lower(),
                          size=os.path.getsize(path))
        d.update({'path': path, 'name': os.path.basename(path)})
        return d
    except Exception as e:
        return {'path': path, 'name': os.path.basename(path), 'error': str(e)[:300],
                'has_cover': False, 'tags': {}}


def probe_fileobj(fileobj, name: str = '', size: int = 0) -> dict:
    """WebDAV 等只读流：mutagen 直接读 fileobj。"""
    if os.path.splitext(name or '')[1].lower() not in MEDIA_EXTS:
        raise ValueError('不是音频文件，无法读取音频元数据')
    if mutagen is None:
        raise RuntimeError('mutagen not installed')
    f = mutagen.File(fileobj)
    ext = os.path.splitext(name or '')[1].lower()
    d = _probe_object(f, ext, size=size or None)
    d.update({'path': '', 'name': name})
    return d


def cover_bytes(path: str) -> Optional[Tuple[bytes, str]]:
    if mutagen is None:
        return None
    try:
        f = mutagen.File(path)
    except Exception:
        return None
    return _cover_from(f)


def cover_from_fileobj(fileobj) -> Optional[Tuple[bytes, str]]:
    if mutagen is None:
        return None
    try:
        f = mutagen.File(fileobj)
    except Exception:
        return None
    return _cover_from(f)
