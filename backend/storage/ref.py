# -*- coding: utf-8 -*-
"""路径引用（URI）：local:/sdcard/x、dav:<source>/<relpath>，兼容旧的裸本地路径。"""
from dataclasses import dataclass


@dataclass
class Ref:
    kind: str      # 'local' | 'dav'
    source: str    # local 恒为 'local'；dav 为配置里的源 id
    path: str      # local: 绝对路径；dav: '/Music/x.flac'

    @property
    def uri(self) -> str:
        return to_uri(self)


def parse_ref(uri: str) -> Ref:
    s = (uri or '').strip()
    if s.startswith('dav:'):
        body = s[4:]
        if '/' in body:
            source, rest = body.split('/', 1)
            path = '/' + rest
        else:
            source, path = body, '/'
        return Ref('dav', source or '', path or '/')
    if s.startswith('local:'):
        return Ref('local', 'local', s[6:] or '/')
    return Ref('local', 'local', s or '/')


def to_uri(ref) -> str:
    if isinstance(ref, Ref):
        kind, source, path = ref.kind, ref.source, ref.path
    else:
        kind, source, path = 'local', 'local', str(ref or '/')
    if kind == 'dav':
        return 'dav:' + (source or '') + (path or '/')
    return 'local:' + (path or '/')


def local_uri(path: str) -> str:
    return to_uri(Ref('local', 'local', path))


def dav_uri(source: str, path: str) -> str:
    return to_uri(Ref('dav', source, path))
