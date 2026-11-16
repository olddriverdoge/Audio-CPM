# -*- coding: utf-8 -*-
"""存储抽象：本地 / WebDAV 两种源，URI 形如 local:/sdcard/x、dav:nas/Music/x。"""
import json
import os
import threading

from ..config import DEFAULT_ROOT, STORAGE_FILE
from .ref import Ref, parse_ref, to_uri, local_uri, dav_uri

_lock = threading.Lock()
_sources_cache = None
_dav_clients = {}

DEFAULT_SOURCES = {
    "local": {"kind": "local", "name": "本机", "roots": [DEFAULT_ROOT]},
}


def load_sources() -> dict:
    global _sources_cache
    with _lock:
        if _sources_cache is not None:
            return _sources_cache
        data = {}
        try:
            with open(STORAGE_FILE, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            if isinstance(raw, dict) and isinstance(raw.get('sources'), dict):
                data = raw['sources']
        except Exception:
            data = {}
        if 'local' not in data:
            data['local'] = dict(DEFAULT_SOURCES['local'])
        _sources_cache = data
        return data


def save_sources(sources: dict):
    global _sources_cache
    with _lock:
        _sources_cache = sources
        _dav_clients.clear()
    try:
        os.makedirs(os.path.dirname(STORAGE_FILE), exist_ok=True)
        tmp = STORAGE_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({"sources": sources}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, STORAGE_FILE)
    except Exception:
        pass


def get_source(sid: str):
    return load_sources().get(sid)


def roots() -> list:
    """前端数据源列表（含能力 caps）。"""
    out = []
    srcs = load_sources()
    for sid, s in srcs.items():
        kind = s.get('kind', 'local')
        if kind == 'local':
            root = (s.get('roots') or [DEFAULT_ROOT])[0]
            caps = ["browse", "meta", "play", "waveform", "tags_write",
                    "external_player", "move", "delete", "mkdir", "convert"]
            if os.environ.get('AC2_ANDROID'):
                caps.append('android')
            out.append({
                "id": sid, "kind": "local", "name": s.get('name') or '本机',
                "path": local_uri(root), "root": root,
                "caps": caps,
                "readonly": False,
            })
        elif kind == 'dav':
            out.append({
                "id": sid, "kind": "dav", "name": s.get('name') or sid,
                "path": dav_uri(sid, s.get('start_path') or '/'),
                "caps": ["browse", "meta", "play", "move", "delete", "mkdir"],
                "readonly": bool(s.get('readonly', True)),
            })
    return out


def get_dav_client(source_id: str):
    from .dav import DavClient
    src = get_source(source_id)
    if not src or src.get('kind') != 'dav':
        raise ValueError('unknown dav source: ' + str(source_id))
    key = (source_id, json.dumps(src, sort_keys=True, ensure_ascii=False))
    with _lock:
        cli = _dav_clients.get(key)
    if cli is None:
        cli = DavClient(src)
        with _lock:
            _dav_clients[key] = cli
    return cli
