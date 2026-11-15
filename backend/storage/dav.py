# -*- coding: utf-8 -*-
"""WebDAV 客户端：目录浏览、Range 读取、移动/删除/新建目录、权限探测。"""
import datetime
import io
import os
import xml.etree.ElementTree as ET
from urllib.parse import quote, unquote, urlsplit, urljoin

import httpx

from ..config import IMAGE_EXTS, MEDIA_EXTS

NS = '{DAV:}'
PROPFIND_BODY = (b'<?xml version="1.0" encoding="utf-8"?>'
                 b'<d:propfind xmlns:d="DAV:"><d:prop>'
                 b'<d:resourcetype/><d:getcontentlength/><d:getlastmodified/>'
                 b'<d:getcontenttype/><d:current-user-privilege-set/>'
                 b'</d:prop></d:propfind>')
PRIV_BODY = (b'<?xml version="1.0" encoding="utf-8"?>'
             b'<d:propfind xmlns:d="DAV:"><d:prop>'
             b'<d:current-user-privilege-set/></d:prop></d:propfind>')


class DavError(Exception):
    pass


def _parse_http_date(v):
    if not v:
        return 0
    for fmt in ('%a, %d %b %Y %H:%M:%S GMT', '%A, %d-%b-%y %H:%M:%S GMT',
                '%Y-%m-%dT%H:%M:%SZ'):
        try:
            return datetime.datetime.strptime(v, fmt).replace(
                tzinfo=datetime.timezone.utc).timestamp()
        except Exception:
            continue
    return 0


class DavClient:
    def __init__(self, cfg):
        self.cfg = cfg
        base = (cfg.get('url') or '').strip()
        if not base:
            raise DavError('缺少 WebDAV 地址')
        self.base = base.rstrip('/') + '/'
        auth = None
        if cfg.get('username'):
            auth = (cfg['username'], cfg.get('password') or '')
        self.client = httpx.Client(
            auth=auth,
            timeout=httpx.Timeout(20.0, connect=8.0, read=20.0),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
            follow_redirects=True,
            verify=bool(cfg.get('verify', True)),
            headers={'User-Agent': 'AC2-WebDAV/1.0'},
        )
        self._base_path = urlsplit(self.base).path.rstrip('/')

    # ---------- 基础 ----------
    def _url(self, path):
        p = (path or '/').lstrip('/')
        return self.base + quote(p, safe='/')

    def _rel(self, href):
        full = urljoin(self.base, href)
        p = unquote(urlsplit(full).path)
        if self._base_path and p.startswith(self._base_path):
            p = p[len(self._base_path):]
        return p or '/'

    def _props(self, path, depth='0'):
        try:
            r = self.client.request('PROPFIND', self._url(path),
                                    headers={'Depth': depth,
                                             'Content-Type': 'application/xml; charset=utf-8'},
                                    content=PROPFIND_BODY)
        except Exception as e:
            raise DavError(str(e)[:300])
        if r.status_code not in (200, 207):
            raise DavError('PROPFIND %s' % r.status_code)
        return r.content

    def _parse(self, xml_bytes):
        root = ET.fromstring(xml_bytes)
        items = []
        for resp in root.findall('.//' + NS + 'response'):
            href = resp.findtext(NS + 'href') or ''
            prop = resp.find(NS + 'propstat/' + NS + 'prop')
            if prop is None:
                continue
            is_dir = prop.find(NS + 'resourcetype/' + NS + 'collection') is not None
            size = prop.findtext(NS + 'getcontentlength')
            mtime = prop.findtext(NS + 'getlastmodified')
            privs = {p.tag.split('}')[-1] for p in prop.iter(NS + 'privilege')}
            items.append({
                'rel': self._rel(href), 'is_dir': is_dir,
                'size': int(size) if size and size.isdigit() else 0,
                'mtime': _parse_http_date(mtime),
                'privs': privs,
            })
        return items

    # ---------- 对外 ----------
    def test(self):
        items = self._parse(self._props('/', '0'))
        if not items:
            raise DavError('服务端没有返回 PROPFIND 结果')
        try:
            r = self.client.request('PROPFIND', self._url('/'), headers={
                'Depth': '0', 'Content-Type': 'application/xml'}, content=PRIV_BODY)
            root = ET.fromstring(r.content)
            privs = {p.tag.split('}')[-1] for p in root.iter(NS + 'privilege')}
        except Exception:
            privs = set()
        return {'ok': True, 'writable': bool(privs & {'write', 'write-content', 'write-properties'}),
                'dav_root': items[0]['rel']}

    def list(self, path):
        items = self._parse(self._props(path, '1'))
        want = (path or '/').rstrip('/') or '/'
        dirs, files, cover = [], [], None
        for it in items:
            rel = it['rel'].rstrip('/') or '/'
            if rel == want:
                continue
            name = rel.rstrip('/').split('/')[-1]
            if not name:
                continue
            if it['is_dir']:
                dirs.append({'name': name, 'path': rel, 'type': 'dir', 'mtime': it['mtime']})
            else:
                ext = os.path.splitext(name)[1].lower()
                if ext in MEDIA_EXTS:
                    files.append({'name': name, 'path': rel, 'type': 'media',
                                  'size': it['size'], 'mtime': it['mtime']})
                elif ext in IMAGE_EXTS:
                    files.append({'name': name, 'path': rel, 'type': 'image',
                                  'size': it['size'], 'mtime': it['mtime']})
                    if cover is None:
                        cover = 'image:' + rel
        dirs.sort(key=lambda x: x['name'].lower())
        files.sort(key=lambda x: x['name'].lower())
        parent = os.path.dirname(want) or '/'
        return {'dirs': dirs, 'files': files, 'cover': cover, 'parent': parent}

    def stat(self, path):
        items = self._parse(self._props(path, '0'))
        if not items:
            raise DavError('not found')
        return items[0]

    def open_range(self, path, range_header=None):
        headers = {}
        if range_header:
            headers['Range'] = range_header
        req = self.client.build_request('GET', self._url(path), headers=headers)
        try:
            resp = self.client.send(req, stream=True)
        except Exception as e:
            raise DavError(str(e)[:300])
        return resp

    def read_range(self, path, start, end):
        r = self.client.get(self._url(path),
                            headers={'Range': 'bytes=%d-%d' % (start, end)})
        if r.status_code not in (200, 206):
            raise DavError('GET %s' % r.status_code)
        return r.content

    def move(self, src, dst):
        r = self.client.request('MOVE', self._url(src), headers={
            'Destination': self._url(dst).replace('%2F', '/'),
            'Overwrite': 'T'})
        if r.status_code not in (200, 201, 204):
            raise DavError('MOVE %s' % r.status_code)

    def delete(self, path):
        r = self.client.delete(self._url(path))
        if r.status_code not in (200, 204):
            raise DavError('DELETE %s' % r.status_code)

    def mkdir(self, path):
        r = self.client.request('MKCOL', self._url(path))
        if r.status_code not in (200, 201):
            raise DavError('MKCOL %s' % r.status_code)


class HttpRangeFile(io.RawIOBase):
    """给 mutagen 用的只读 seekable 文件（按 64KB Range 拉取）。"""

    def __init__(self, client, path, size=None):
        self.client = client
        self.path = path
        self.pos = 0
        self._size = size

    @property
    def size(self):
        if self._size is None:
            try:
                self._size = self.client.stat(self.path)['size']
            except Exception:
                self._size = 0
        return self._size

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        elif whence == io.SEEK_END:
            self.pos = max(0, self.size + offset)
        return self.pos

    def readinto(self, b):
        data = self.read(len(b))
        n = len(data)
        b[:n] = data
        return n

    def read(self, n=-1):
        if n is None or n < 0:
            n = max(0, self.size - self.pos)
        if n <= 0 or self.pos >= self.size:
            return b''
        end = min(self.size, self.pos + n) - 1
        try:
            data = self.client.read_range(self.path, self.pos, end)
        except Exception:
            return b''
        self.pos += len(data)
        return data
