# -*- coding: utf-8 -*-
"""本地曲库索引：用户勾选目录、增量扫描、按标签搜索、专辑聚合。

设计边界（0.5.19 原型）：
- 只索引本地目录，不扫描全盘；首次由前端引导选择目录。
- 唯一键是 (目录, 文件名, 大小)，路径变化或文件大小变化会重建对应记录。
- 扫描在后台线程执行，不阻塞播放/浏览；同一时间只允许一个扫描任务。
- 曲库是独立数据，不影响现有文件浏览和播放目录。
"""
import json
import os
import re
import sqlite3
import threading
import time
from typing import Dict, List, Optional

from .config import DATA_DIR, MEDIA_EXTS
from .meta import probe_file_detail
from .storage import local_uri, parse_ref

DB_FILE = os.path.join(DATA_DIR, "ac2_library.db")
SEARCH_FIELDS = ("title", "artist", "album", "genre", "year", "composer", "folder")
DEFAULT_SEARCH_FIELDS = ("title", "artist", "album", "folder")
MAX_SEARCH_LIMIT = 500

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dir TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    mtime REAL NOT NULL DEFAULT 0,
    title TEXT DEFAULT '',
    artist TEXT DEFAULT '',
    album TEXT DEFAULT '',
    album_artist TEXT DEFAULT '',
    genre TEXT DEFAULT '',
    year TEXT DEFAULT '',
    composer TEXT DEFAULT '',
    track TEXT DEFAULT '',
    disc TEXT DEFAULT '',
    duration REAL DEFAULT 0,
    format TEXT DEFAULT '',
    bitrate INTEGER DEFAULT 0,
    sample_rate INTEGER DEFAULT 0,
    channels INTEGER DEFAULT 0,
    folder TEXT DEFAULT '',
    has_cover INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    indexed_at REAL DEFAULT 0,
    UNIQUE(dir, name, size)
);
CREATE INDEX IF NOT EXISTS idx_tracks_dir ON tracks(dir);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album, album_artist);
CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_FILE, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    return c


def _init_db():
    try:
        os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
        with _conn() as c:
            c.executescript(_SCHEMA)
    except Exception:
        pass


def _meta_get(key: str, default=None):
    try:
        with _conn() as c:
            row = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            if row:
                return json.loads(row["value"])
    except Exception:
        pass
    return default


def _meta_set(key: str, value):
    try:
        with _conn() as c:
            c.execute("INSERT INTO meta(key,value) VALUES(?,?) "
                      "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (key, json.dumps(value, ensure_ascii=False)))
    except Exception:
        pass


def _norm_dir(value) -> str:
    """接受 local:/path 或裸路径，返回规范化绝对路径；WebDAV 返回空串。"""
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        ref = parse_ref(raw)
        if ref.kind == "dav":
            return ""
        p = ref.path
    except Exception:
        p = raw[6:] if raw.startswith("local:") else raw
    p = os.path.abspath(os.path.expanduser(p)).rstrip(os.sep) or os.sep
    return p


def _is_under(path: str, root: str) -> bool:
    if not path or not root:
        return False
    try:
        p = os.path.abspath(path)
        r = os.path.abspath(root).rstrip(os.sep)
        return p == r or p.startswith(r + os.sep)
    except Exception:
        return False


def _int(v) -> int:
    try:
        return int(float(v or 0))
    except Exception:
        return 0


def _float(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _first(tags: Dict, *keys) -> str:
    for k in keys:
        v = tags.get(k)
        if v not in (None, ""):
            return str(v).strip()
    return ""


def _year(tags: Dict) -> str:
    raw = _first(tags, "date", "year")
    m = re.search(r"(19|20)\d{2}", raw)
    return m.group(0) if m else raw[:4]


def _probe(path: str) -> Dict:
    d = probe_file_detail(path)
    tags = d.get("tags") or {}
    audio = d.get("audio") or {}
    fmt = d.get("format") or {}
    title = _first(tags, "title") or os.path.splitext(os.path.basename(path))[0]
    return {
        "title": title,
        "artist": _first(tags, "artist"),
        "album": _first(tags, "album"),
        "album_artist": _first(tags, "album_artist", "albumartist") or _first(tags, "artist"),
        "genre": _first(tags, "genre"),
        "year": _year(tags),
        "composer": _first(tags, "composer"),
        "track": _first(tags, "track", "tracknumber"),
        "disc": _first(tags, "disc", "discnumber"),
        "duration": _float(audio.get("duration") or fmt.get("duration")),
        "format": str(fmt.get("format_name") or audio.get("codec_name") or ""),
        "bitrate": _int(audio.get("bit_rate") or fmt.get("bit_rate")),
        "sample_rate": _int(audio.get("sample_rate")),
        "channels": _int(audio.get("channels")),
        "has_cover": 1 if d.get("has_cover") else 0,
        "error": str(d.get("error") or ""),
    }


def _album_key(row: sqlite3.Row):
    album = (row["album"] or "").strip()
    # 专辑页按曲库的 album + artist 组合定位，不再用 album_artist 兜底：
    # 同一 directory 里的不同专辑/不同艺人不能被合并进来。
    artist = (row["artist"] or row["album_artist"] or "").strip()
    return album, artist


def _track_dict(row: sqlite3.Row) -> Dict:
    keys = row.keys()
    return {
        "path": local_uri(row["path"]),
        "dir": local_uri(row["dir"]),
        "name": row["name"],
        "title": row["title"] or os.path.splitext(row["name"])[0],
        "artist": row["artist"] or "",
        "album": row["album"] or "",
        "albumArtist": row["album_artist"] or "",
        "genre": row["genre"] or "",
        "year": row["year"] or "",
        "composer": row["composer"] or "",
        "track": row["track"] or "",
        "disc": row["disc"] or "",
        "duration": _float(row["duration"]) if "duration" in keys else 0,
        "format": row["format"] if "format" in keys else "",
        "bitrate": _int(row["bitrate"]) if "bitrate" in keys else 0,
        "sampleRate": _int(row["sample_rate"]) if "sample_rate" in keys else 0,
        "channels": _int(row["channels"]) if "channels" in keys else 0,
        "folder": row["folder"] or "",
        "hasCover": bool(row["has_cover"]) if "has_cover" in keys else False,
        "indexed": True,
    }


def _natural_key(s: str):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", str(s or ""))]


def _sort_album_tracks(tracks: List[Dict]) -> List[Dict]:
    def key(t):
        disc = _int(str(t.get("disc") or "").split("/")[0])
        track = _int(str(t.get("track") or "").split("/")[0])
        return (disc if disc > 0 else 999, track if track > 0 else 999, _natural_key(t.get("name") or ""))
    return sorted(tracks, key=key)


class LibraryStore:
    def __init__(self):
        self._lock = threading.RLock()
        self._scan_thread: Optional[threading.Thread] = None
        self._cancel = threading.Event()
        self._state = {
            "scanning": False,
            "cancelRequested": False,
            "done": 0,
            "total": 0,
            "added": 0,
            "updated": 0,
            "removed": 0,
            "errors": 0,
            "current": "",
            "startedAt": 0,
            "finishedAt": 0,
            "lastError": "",
        }
        _init_db()

    # ---------- config ----------
    def dirs(self) -> List[str]:
        value = _meta_get("dirs", [])
        return [x for x in value if isinstance(x, str) and x] if isinstance(value, list) else []

    def set_dirs(self, raw_dirs) -> Dict:
        if not isinstance(raw_dirs, list):
            return {"ok": False, "error": "目录列表格式错误"}
        dirs = []
        invalid = []
        for item in raw_dirs:
            p = _norm_dir(item)
            if not p:
                invalid.append(str(item))
                continue
            if not os.path.isdir(p):
                invalid.append(str(item))
                continue
            if p not in dirs:
                dirs.append(p)
        if invalid:
            return {"ok": False, "error": "目录不存在或不是本地目录", "invalid": invalid}
        _meta_set("dirs", dirs)
        self._purge_outside(dirs)
        return {"ok": True, "dirs": dirs}

    def _purge_outside(self, dirs: List[str]):
        if not dirs:
            try:
                with _conn() as c:
                    c.execute("DELETE FROM tracks")
            except Exception:
                pass
            return
        try:
            with _conn() as c:
                for row in c.execute("SELECT DISTINCT dir FROM tracks").fetchall():
                    d = row["dir"]
                    if not any(_is_under(d, root) for root in dirs):
                        c.execute("DELETE FROM tracks WHERE dir=?", (d,))
        except Exception:
            pass

    def count(self) -> int:
        try:
            with _conn() as c:
                return int(c.execute("SELECT COUNT(*) FROM tracks").fetchone()[0])
        except Exception:
            return 0

    def state(self) -> Dict:
        dirs = self.dirs()
        last = _meta_get("last_scan", 0) or 0
        with self._lock:
            st = dict(self._state)
        try:
            size = os.path.getsize(DB_FILE) if os.path.isfile(DB_FILE) else 0
        except Exception:
            size = 0
        return {
            "ok": True,
            "dirs": dirs,
            "configured": bool(dirs) and all(os.path.isdir(d) for d in dirs),
            "count": self.count(),
            "lastScan": last,
            "dbBytes": size,
            "scanning": st["scanning"],
            "progress": {
                "done": st["done"], "total": st["total"], "added": st["added"],
                "updated": st["updated"], "removed": st["removed"], "errors": st["errors"],
                "current": st["current"], "startedAt": st["startedAt"],
                "finishedAt": st["finishedAt"], "cancelRequested": st["cancelRequested"],
                "lastError": st["lastError"],
            }
        }

    # ---------- scanning ----------
    def start_scan(self, force: bool = False) -> Dict:
        with self._lock:
            if self._state["scanning"]:
                return {"ok": True, "alreadyRunning": True, "state": self.state()}
            dirs = self.dirs()
            if not dirs:
                return {"ok": False, "error": "请先选择要索引的目录"}
            self._cancel.clear()
            self._state.update({
                "scanning": True, "cancelRequested": False, "done": 0, "total": 0,
                "added": 0, "updated": 0, "removed": 0, "errors": 0, "current": "",
                "startedAt": time.time(), "finishedAt": 0, "lastError": ""
            })
            th = threading.Thread(target=self._scan_worker, args=(dirs, bool(force)), daemon=True)
            self._scan_thread = th
            th.start()
        return {"ok": True, "started": True, "state": self.state()}

    def cancel_scan(self) -> Dict:
        with self._lock:
            if not self._state["scanning"]:
                return {"ok": True, "cancelled": False}
            self._cancel.set()
            self._state["cancelRequested"] = True
        return {"ok": True, "cancelled": True}

    def _scan_worker(self, roots: List[str], force: bool):
        started = time.time()
        seen_paths = set()
        seen_dirs = set()
        walked_dirs = set()
        try:
            with _conn() as c:
                old_rows = c.execute(
                    "SELECT id,dir,name,size,path,mtime FROM tracks"
                ).fetchall()
            old_by_key = {(r["dir"], r["name"], r["size"]): r for r in old_rows}
            old_by_path = {r["path"]: r for r in old_rows}

            # 先统计文件总数，给前端一个可用的进度分母；目录很大时也只是一次轻量遍历。
            files = []
            for root in roots:
                if not os.path.isdir(root):
                    continue
                for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
                    walked_dirs.add(os.path.abspath(dirpath))
                    if self._cancel.is_set():
                        break
                    dirnames[:] = [d for d in dirnames if not d.startswith(".")]
                    for name in filenames:
                        if os.path.splitext(name)[1].lower() in MEDIA_EXTS:
                            files.append((dirpath, name))
                if self._cancel.is_set():
                    break
            with self._lock:
                self._state["total"] = len(files)

            for dirpath, name in files:
                if self._cancel.is_set():
                    break
                full = os.path.join(dirpath, name)
                if full in seen_paths:
                    continue
                try:
                    st = os.stat(full)
                    size = int(st.st_size)
                    mtime = float(st.st_mtime)
                except Exception:
                    with self._lock:
                        self._state["errors"] += 1
                    continue
                seen_paths.add(full)
                seen_dirs.add(dirpath)
                key = (os.path.abspath(dirpath), name, size)
                old = old_by_key.get(key)
                if old and not force and abs(float(old["mtime"] or 0) - mtime) < 0.001:
                    with self._lock:
                        self._state["done"] += 1
                        self._state["current"] = full
                    continue
                meta = _probe(full)
                rel = os.path.relpath(dirpath, self._root_for(full, roots))
                folder = "" if rel in (".", "") else rel
                row = {
                    "dir": os.path.abspath(dirpath), "name": name, "size": size,
                    "path": full, "mtime": mtime, "indexed_at": time.time(),
                    "folder": folder.replace(os.sep, "/"),
                    **meta
                }
                try:
                    with _conn() as c:
                        if old is None:
                            # 同目录同名但大小变化：旧记录失效，按唯一键重建。
                            c.execute("DELETE FROM tracks WHERE dir=? AND name=? AND size<>?",
                                      (row["dir"], row["name"], row["size"]))
                        c.execute(
                            "INSERT INTO tracks(dir,name,size,path,mtime,title,artist,album,album_artist,"
                            "genre,year,composer,track,disc,duration,format,bitrate,sample_rate,channels,"
                            "folder,has_cover,error,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                            "ON CONFLICT(dir,name,size) DO UPDATE SET path=excluded.path,mtime=excluded.mtime,"
                            "title=excluded.title,artist=excluded.artist,album=excluded.album,"
                            "album_artist=excluded.album_artist,genre=excluded.genre,year=excluded.year,"
                            "composer=excluded.composer,track=excluded.track,disc=excluded.disc,"
                            "duration=excluded.duration,format=excluded.format,bitrate=excluded.bitrate,"
                            "sample_rate=excluded.sample_rate,channels=excluded.channels,folder=excluded.folder,"
                            "has_cover=excluded.has_cover,error=excluded.error,indexed_at=excluded.indexed_at",
                            (row["dir"], row["name"], row["size"], row["path"], row["mtime"],
                             row["title"], row["artist"], row["album"], row["album_artist"],
                             row["genre"], row["year"], row["composer"], row["track"], row["disc"],
                             row["duration"], row["format"], row["bitrate"], row["sample_rate"],
                             row["channels"], row["folder"], row["has_cover"], row["error"],
                             row["indexed_at"])
                        )
                    with self._lock:
                        if old is None:
                            self._state["added"] += 1
                        else:
                            self._state["updated"] += 1
                except Exception as exc:
                    with self._lock:
                        self._state["errors"] += 1
                        self._state["lastError"] = str(exc)[:220]
                with self._lock:
                    self._state["done"] += 1
                    self._state["current"] = full

            if not self._cancel.is_set():
                # 清理：删除本次成功遍历到的目录下已经不存在的文件。
                # 只在目录实际可读时清理，避免权限失败把整个曲库误删。
                try:
                    with _conn() as c:
                        for row in c.execute("SELECT id,dir,path FROM tracks").fetchall():
                            if not any(_is_under(row["dir"], root) for root in roots):
                                continue
                            if row["dir"] not in walked_dirs:
                                continue
                            if row["path"] in seen_paths:
                                continue
                            c.execute("DELETE FROM tracks WHERE id=?", (row["id"],))
                            with self._lock:
                                self._state["removed"] += 1
                except Exception as exc:
                    with self._lock:
                        self._state["lastError"] = str(exc)[:220]

            if self._cancel.is_set():
                with self._lock:
                    self._state["lastError"] = "扫描已取消"
            else:
                _meta_set("last_scan", time.time())
        except Exception as exc:
            with self._lock:
                self._state["lastError"] = str(exc)[:300]
        finally:
            with self._lock:
                self._state["scanning"] = False
                self._state["cancelRequested"] = False
                self._state["finishedAt"] = time.time()
                self._state["current"] = ""
        # started 保持原值，便于前端展示耗时
        _ = started

    @staticmethod
    def _root_for(full: str, roots: List[str]) -> str:
        for root in roots:
            if _is_under(full, root):
                return root
        return os.path.dirname(full)

    # ---------- search ----------
    def search(self, query: str = "", fields=None, limit: int = 120, offset: int = 0) -> Dict:
        limit = max(1, min(MAX_SEARCH_LIMIT, _int(limit) or 120))
        offset = max(0, _int(offset))
        selected = [f for f in (fields or DEFAULT_SEARCH_FIELDS) if f in SEARCH_FIELDS]
        if not selected:
            selected = list(DEFAULT_SEARCH_FIELDS)
        where = []
        params = []
        tokens = [t for t in re.split(r"\s+", str(query or "").strip()) if t]
        for token in tokens:
            pat = "%" + token.lower() + "%"
            parts = []
            for f in selected:
                if f == "title":
                    parts.append("LOWER(COALESCE(title,'')) LIKE ? OR LOWER(COALESCE(name,'')) LIKE ?")
                    params.extend([pat, pat])
                elif f == "artist":
                    parts.append("LOWER(COALESCE(artist,'')) LIKE ? OR LOWER(COALESCE(album_artist,'')) LIKE ?")
                    params.extend([pat, pat])
                elif f == "folder":
                    parts.append("LOWER(COALESCE(folder,'')) LIKE ? OR LOWER(COALESCE(dir,'')) LIKE ?")
                    params.extend([pat, pat])
                else:
                    parts.append("LOWER(COALESCE(%s,'')) LIKE ?" % f)
                    params.append(pat)
            if parts:
                where.append("(" + " OR ".join(parts) + ")")
        sql = "SELECT * FROM tracks"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY indexed_at DESC, id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        try:
            with _conn() as c:
                rows = c.execute(sql, params).fetchall()
                count_sql = "SELECT COUNT(*) FROM tracks" + (" WHERE " + " AND ".join(where) if where else "")
                total = int(c.execute(count_sql, params[:-2]).fetchone()[0])
            return {
                "ok": True, "tracks": [_track_dict(r) for r in rows],
                "total": total, "offset": offset, "limit": limit,
                "query": str(query or ""), "fields": selected, "mode": "incremental",
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:240], "tracks": [], "total": 0}

    # ---------- browse ----------
    def browse(self, path: str = "") -> Dict:
        """播放管理的目录页：只返回曲库勾选目录内的文件夹与已索引音频。

        path 为空时返回曲库根目录列表；单个根目录可由前端直接进入。
        """
        roots = self.dirs()
        if not roots:
            return {"ok": False, "error": "曲库尚未配置目录", "path": "", "parent": "",
                    "roots": [], "dirs": [], "tracks": []}
        try:
            with _conn() as c:
                rows = c.execute("SELECT * FROM tracks").fetchall()
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:240], "path": "", "parent": "",
                    "roots": [], "dirs": [], "tracks": []}

        root_counts = []
        for root in roots:
            count = sum(1 for r in rows if _is_under(r["dir"], root))
            root_counts.append({
                "path": local_uri(root), "name": os.path.basename(root) or root,
                "count": count, "root": True,
            })
        roots_uri = [x["path"] for x in root_counts]
        if not str(path or "").strip():
            return {"ok": True, "path": "", "parent": "", "roots": roots_uri,
                    "dirs": sorted(root_counts, key=lambda x: _natural_key(x["name"])),
                    "tracks": []}

        p = _norm_dir(path)
        if not p or not any(_is_under(p, root) for root in roots):
            return {"ok": False, "error": "目录不在曲库范围内", "path": "",
                    "parent": "", "roots": roots_uri, "dirs": [], "tracks": []}

        child_counts = {}
        for row in rows:
            d = os.path.abspath(row["dir"])
            if d == p or not _is_under(d, p):
                continue
            rel = os.path.relpath(d, p)
            child = os.path.join(p, rel.split(os.sep)[0])
            child_counts[child] = child_counts.get(child, 0) + 1
        dirs = [{
            "path": local_uri(child), "name": os.path.basename(child) or child,
            "count": count, "root": child in roots,
        } for child, count in child_counts.items()]
        dirs.sort(key=lambda x: _natural_key(x["name"]))

        tracks = [_track_dict(r) for r in rows if os.path.abspath(r["dir"]) == p]
        tracks = _sort_album_tracks(tracks)
        parent = "" if p in roots else os.path.dirname(p)
        return {
            "ok": True, "path": local_uri(p),
            "parent": local_uri(parent) if parent else "",
            "roots": roots_uri, "dirs": dirs, "tracks": tracks,
        }

    # ---------- album ----------
    def album(self, path: str) -> Dict:
        raw = str(path or "")
        try:
            ref = parse_ref(raw)
            if ref.kind == "dav":
                return {"ok": False, "error": "曲库暂只支持本地目录"}
            p = os.path.abspath(ref.path)
        except Exception:
            p = os.path.abspath(raw[6:] if raw.startswith("local:") else raw)
        row = None
        try:
            with _conn() as c:
                row = c.execute("SELECT * FROM tracks WHERE path=?", (p,)).fetchone()
                if row is None:
                    # 兼容扫描路径与播放路径只差大小写/斜杠的 Android 存储。
                    row = c.execute("SELECT * FROM tracks WHERE path=? COLLATE NOCASE", (p,)).fetchone()
        except Exception:
            row = None
        if row is None:
            # 专辑页只读曲库索引。未索引曲目无法确定 album+artist，
            # 退回到“同目录所有音频”会把不同专辑混在一起，直接软失败。
            return {"ok": False, "error": "当前曲目不在曲库中", "tracks": []}
        album, artist = _album_key(row)
        tracks = []
        try:
            with _conn() as c:
                if album and artist:
                    rows = c.execute(
                        "SELECT * FROM tracks WHERE album=? AND artist=? ORDER BY id LIMIT 500",
                        (album, artist)).fetchall()
                elif album:
                    rows = c.execute(
                        "SELECT * FROM tracks WHERE album=? AND (artist='' OR artist IS NULL) "
                        "ORDER BY id LIMIT 500", (album,)).fetchall()
                else:
                    rows = []
            tracks = _sort_album_tracks([_track_dict(r) for r in rows])
            if not tracks:
                tracks = [_track_dict(row)]
        except Exception:
            tracks = [_track_dict(row)]
        cover = next((t["path"] for t in tracks if t.get("hasCover")), tracks[0]["path"] if tracks else "")
        return {
            "ok": True, "indexed": True, "album": album or os.path.basename(row["dir"]),
            "artist": artist, "year": row["year"] or "", "genre": row["genre"] or "",
            "dir": local_uri(row["dir"]), "coverPath": cover,
            "current": _track_dict(row), "tracks": tracks,
        }



library = LibraryStore()
