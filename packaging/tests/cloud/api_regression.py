"""Cloud-side API regression suite for Audio-CPM.

Run through run_cloud_suite.py; it starts the real Starlette backend with an
isolated AC2_ROOT/AC2_DATA_DIR.  The suite only deals with fixture files
below that temporary root.

Coverage is intentionally broad, but these are contract/smoke tests: they
exercise every API route family and the main task pipeline, not every
combinatorial UI state.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx


class CheckFailure(AssertionError):
    pass


class ApiRegression:
    def __init__(self, base_url: str, fixture: Dict[str, str], timeout: float = 30.0):
        self.base = base_url.rstrip("/")
        self.fx = fixture
        self.client = httpx.Client(base_url=self.base, timeout=timeout)
        self.results = []
        self.task_ids = []

    # ---------- reporting ----------
    def ok(self, name: str, detail: str = ""):
        self.results.append({"name": name, "ok": True, "detail": detail})

    def fail(self, name: str, detail: str):
        self.results.append({"name": name, "ok": False, "detail": detail})

    def check(self, name: str, fn):
        try:
            detail = fn() or ""
            if isinstance(detail, dict):
                detail = json.dumps(detail, ensure_ascii=False)[:300]
            self.ok(name, str(detail))
        except Exception as exc:
            self.fail(name, f"{type(exc).__name__}: {exc}")

    def require(self, cond: bool, msg: str):
        if not cond:
            raise CheckFailure(msg)

    # ---------- request helpers ----------
    def get(self, url: str, **kw):
        return self.client.get(url, **kw)

    def post(self, url: str, payload: Any = None):
        return self.client.post(url, json=payload if payload is not None else {})

    def jget(self, url: str, **kw):
        r = self.get(url, **kw)
        self.require(r.status_code == 200, f"GET {url} -> {r.status_code}: {r.text[:160]}")
        try:
            return r.json()
        except Exception as exc:
            raise CheckFailure(f"GET {url} is not JSON: {exc}; {r.text[:160]}")

    def jpost(self, url: str, payload: Any = None):
        r = self.post(url, payload)
        self.require(r.status_code == 200, f"POST {url} -> {r.status_code}: {r.text[:160]}")
        try:
            return r.json()
        except Exception as exc:
            raise CheckFailure(f"POST {url} is not JSON: {exc}; {r.text[:160]}")

    @staticmethod
    def local_path(ref: str) -> str:
        return ref[6:] if ref.startswith("local:") else ref

    def wait_task(self, task_id: str, timeout: float = 90.0) -> Dict[str, Any]:
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            last = self.jget(f"/api/task/{task_id}/status")
            if last.get("status") in ("done", "error", "cancelled", "interrupted"):
                return last
            time.sleep(0.15)
        raise CheckFailure(f"task {task_id} did not finish in {timeout}s: {last}")

    def start_task(self, payload: Dict[str, Any]) -> str:
        out = self.jpost("/api/start", payload)
        tid = out.get("task_id")
        self.require(bool(tid), f"/api/start did not return task_id: {out}")
        self.task_ids.append(tid)
        return tid

    # ---------- static / capabilities / roots ----------
    def test_static_and_capabilities(self):
        def static():
            r = self.get("/")
            self.require(r.status_code == 200, f"/ -> {r.status_code}")
            self.require("Audio-CPM" in r.text and "<html" in r.text.lower(), "index.html not served")
            return f"{len(r.text)} bytes"
        self.check("static frontend is served", static)

        def caps():
            d = self.jget("/api/capabilities")
            self.require(d.get("ffmpeg") is True, f"ffmpeg unavailable: {d}")
            self.require(d.get("android") is False, "cloud host unexpectedly reports android")
            self.require(isinstance(d.get("formats"), list) and d["formats"], "no output formats")
            return {"formats": d["formats"], "mode": d.get("mode")}
        self.check("capabilities + ffmpeg formats", caps)

        def roots():
            d = self.jget("/api/roots")
            roots = d.get("roots") or []
            local = next((x for x in roots if x.get("id") == "local"), None)
            self.require(local is not None, f"no local root: {roots}")
            self.require(local.get("root") == self.fx["root"], f"root mismatch: {local}")
            self.require("browse" in (local.get("caps") or []), f"caps: {local}")
            return f"{len(roots)} root(s)"
        self.check("local root and capability metadata", roots)

        def sources():
            d = self.jget("/api/storage/sources")
            srcs = d.get("sources") or []
            self.require(any(s.get("id") == "local" for s in srcs), f"sources: {srcs}")
            return f"{len(srcs)} source(s)"
        self.check("storage sources list", sources)

    # ---------- browse / tree / metadata ----------
    def test_browse_and_metadata(self):
        def browse_root():
            d = self.jget("/api/browse", params={"path": self.fx["root"]})
            names = [x["name"] for x in (d.get("dirs") or [])]
            self.require("api" in names and "ui" in names, f"root dirs: {names}")
            return names
        self.check("browse root directory listing", browse_root)

        def browse_album():
            d = self.jget("/api/browse", params={"path": self.fx["album_a"]})
            files = d.get("files") or []
            names = {x["name"]: x for x in files}
            self.require("Track One.flac" in names and "Track Two.wav" in names, f"files: {list(names)}")
            self.require(names["Track One.flac"]["type"] == "media", "flac type")
            self.require("cover.jpg" in names and names["cover.jpg"]["type"] == "image", "jpg type")
            self.require(d.get("cover", "").startswith("/api/image?path="), f"cover: {d.get('cover')}")
            self.require(all(x.get("size", 0) > 0 for x in files), "zero-size fixture")
            return list(names)
        self.check("browse audio/image metadata", browse_album)

        def browse_missing_falls_back():
            # The backend deliberately falls back to DEFAULT_ROOT for a missing
            # directory; it must not return a half-empty response.
            d = self.jget("/api/browse", params={"path": "local:/definitely/not/here"})
            self.require(d.get("path") == f"local:{self.fx['root']}", f"fallback path: {d.get('path')}")
            return d.get("path")
        self.check("browse missing path falls back to root", browse_missing_falls_back)

        def tree():
            d = self.jget("/api/tree", params={"path": self.fx["root"]})
            children = {x["name"]: x for x in (d.get("children") or [])}
            self.require("api" in children and "ui" in children, f"tree: {children}")
            self.require(children["api"].get("path", "").startswith("local:"), "tree path prefix")
            return list(children)
        self.check("tree root and child paths", tree)

        def tree_missing():
            r = self.get("/api/tree", params={"path": "local:/definitely/not/here"})
            self.require(r.status_code == 400, f"missing tree -> {r.status_code}")
        self.check("tree missing directory gives 400", tree_missing)

        def probe():
            d = self.jget("/api/probe_file", params={"path": self.fx["track1"]})
            self.require(d.get("format", {}).get("format_name") == "flac", f"probe: {d.get('format')}")
            self.require(abs(float(d["format"]["duration"]) - 2.0) < 0.2, f"duration: {d['format'].get('duration')}")
            self.require(d.get("tags", {}).get("title") == "Track One", f"tags: {d.get('tags')}")
            return d.get("format", {}).get("format_name")
        self.check("probe FLAC tags and duration", probe)

        def probe_cover():
            d = self.jget("/api/probe_file", params={"path": self.fx["covered"]})
            self.require(d.get("has_cover") is True, f"has_cover: {d.get('has_cover')}")
            return d.get("has_cover")
        self.check("probe embedded cover", probe_cover)

        def probe_missing():
            r = self.get("/api/probe_file", params={"path": "local:/definitely/not/here.flac"})
            self.require(r.status_code == 404, f"missing probe -> {r.status_code}")
        self.check("probe missing file gives 404", probe_missing)

        def edit_tags():
            src = Path(self.local_path(self.fx["tasks"])) / "Track One.flac"
            dst = Path(self.local_path(self.fx["work"])) / "Edit Me.flac"
            dst.write_bytes(src.read_bytes())
            out = self.jpost("/api/edit_tags", {
                "path": f"local:{dst}", "tags": {"title": "Edited Title", "genre": "Test"},
            })
            self.require(out.get("ok") is True, f"edit_tags: {out}")
            probe = self.jget("/api/probe_file", params={"path": f"local:{dst}"})
            self.require(probe.get("tags", {}).get("title") == "Edited Title", f"tags after edit: {probe.get('tags')}")
            return "title/genre written"
        self.check("edit tags writes and reads back", edit_tags)

    # ---------- media ----------
    def test_media(self):
        def image():
            r = self.get("/api/image", params={"path": self.fx["cover_jpg"]})
            self.require(r.status_code == 200, f"image -> {r.status_code}")
            self.require(r.headers.get("content-type", "").startswith("image/"), f"content-type: {r.headers.get('content-type')}")
            self.require(len(r.content) > 100, "empty image")
            return r.headers.get("content-type")
        self.check("serve local image", image)

        def image_reject():
            p = Path(self.local_path(self.fx["album_b"])) / "readme.txt"
            r = self.get("/api/image", params={"path": f"local:{p}"})
            self.require(r.status_code == 400, f"non-image -> {r.status_code}")
        self.check("image rejects non-image", image_reject)

        def thumb_cover():
            r = self.get("/api/thumb", params={"path": self.fx["covered"], "size": "96"})
            self.require(r.status_code == 200, f"thumb -> {r.status_code}")
            self.require(len(r.content) > 100, "empty thumb")
            return f"{len(r.content)} bytes"
        self.check("embedded cover thumbnail", thumb_cover)

        def cover_no_cover():
            r = self.get("/api/cover", params={"path": self.fx["track1"]})
            self.require(r.status_code == 404, f"no cover -> {r.status_code}")
        self.check("cover endpoint 404 without cover", cover_no_cover)

        def waveform():
            d = self.jget("/api/waveform", params={"path": self.fx["track1"], "buckets": "32"})
            self.require(d.get("buckets") == 32 and len(d.get("peaks") or []) == 32, f"waveform: {d.get('buckets')}")
            self.require(int(d.get("durationMs") or 0) > 1000, f"durationMs: {d.get('durationMs')}")
            return f"{len(d['peaks'])} peaks, {d['ms']} ms"
        self.check("waveform peaks and duration", waveform)

        def stream_full():
            r = self.get("/api/stream", params={"path": self.fx["track1"]})
            self.require(r.status_code == 200, f"stream -> {r.status_code}")
            self.require(len(r.content) > 1000, "stream too small")
            self.require("audio/" in r.headers.get("content-type", ""), f"content-type: {r.headers.get('content-type')}")
            return f"{len(r.content)} bytes, {r.headers.get('content-type')}"
        self.check("stream full audio", stream_full)

        def stream_range():
            r = self.get("/api/stream", params={"path": self.fx["track1"]}, headers={"Range": "bytes=0-99"})
            self.require(r.status_code == 206, f"range -> {r.status_code}")
            self.require(len(r.content) == 100, f"range length: {len(r.content)}")
            self.require(r.headers.get("content-range", "").startswith("bytes 0-99/"), f"content-range: {r.headers.get('content-range')}")
            return r.headers.get("content-range")
        self.check("stream HTTP Range", stream_range)

        def play_missing():
            d = self.jpost("/api/play", {"path": "local:/definitely/not/here.flac"})
            self.require(d.get("status") == "error", f"play missing: {d}")
        self.check("external play missing file is handled", play_missing)

        def play_outside():
            d = self.jpost("/api/play", {"path": "local:/etc/passwd"})
            self.require(d.get("status") == "blocked", f"play outside: {d}")
        self.check("external play blocks non-public path", play_outside)

    # ---------- filesystem ----------
    def test_filesystem(self):
        work = self.local_path(self.fx["work"])

        def mkdir():
            d = self.jpost("/api/mkdir", {"parent": self.fx["work"], "name": "newdir"})
            self.require(d.get("ok") is True, f"mkdir: {d}")
            self.require(Path(work, "newdir").is_dir(), "mkdir not on disk")
            dup = self.jpost("/api/mkdir", {"parent": self.fx["work"], "name": "newdir"})
            self.require(dup.get("ok") is False and "exists" in dup.get("error", ""), f"mkdir duplicate: {dup}")
            bad = self.jpost("/api/mkdir", {"parent": self.fx["work"], "name": "../x"})
            self.require(bad.get("ok") is False, f"mkdir invalid: {bad}")
            return "created + duplicate rejected"
        self.check("mkdir validation and duplicate", mkdir)

        def rmdir():
            d = self.jpost("/api/rmdir", {"path": f"local:{Path(work, 'newdir')}"})
            self.require(d.get("ok") is True, f"rmdir: {d}")
            self.require(not Path(work, "newdir").exists(), "rmdir left directory")
        self.check("rmdir empty directory", rmdir)

        def rename_dir():
            parent = Path(work, "rename_parent")
            parent.mkdir()
            d = self.jpost("/api/rename_dir", {"path": f"local:{parent}", "new_name": "renamed"})
            self.require(d.get("ok") is True, f"rename: {d}")
            self.require(d.get("path") == f"local:{Path(work, 'renamed')}", f"rename path: {d.get('path')}")
            self.require(Path(work, "renamed").is_dir(), "renamed directory absent")
            return d.get("path")
        self.check("rename directory", rename_dir)

        def copy_skip_rename():
            copy_src = Path(self.local_path(self.fx["ops"])) / "Copy Me.flac"
            out = Path(self.local_path(self.fx["out"]))
            first = self.jpost("/api/copy", {
                "sources": [f"local:{copy_src}"], "target": self.fx["out"], "conflict": "skip",
            })
            self.require(first.get("moved") == 1, f"copy: {first}")
            self.require((out / "Copy Me.flac").exists(), "copied file absent")
            second = self.jpost("/api/copy", {
                "sources": [f"local:{copy_src}"], "target": self.fx["out"], "conflict": "skip",
            })
            self.require(second.get("skipped") == 1 and second.get("failed") == 0, f"skip: {second}")
            third = self.jpost("/api/copy", {
                "sources": [f"local:{copy_src}"], "target": self.fx["out"], "conflict": "rename",
            })
            self.require(third.get("moved") == 1, f"rename: {third}")
            self.require((out / "Copy Me_1.flac").exists(), "renamed copy absent")
            return "copy + skip + rename"
        self.check("copy conflict policies", copy_skip_rename)

        def move_file():
            src = Path(self.local_path(self.fx["ops"])) / "Move Me.flac"
            target = Path(work, "move_target")
            target.mkdir(exist_ok=True)
            d = self.jpost("/api/move", {
                "sources": [f"local:{src}"], "target": f"local:{target}", "conflict": "skip",
            })
            self.require(d.get("moved") == 1, f"move: {d}")
            self.require(not src.exists() and (target / "Move Me.flac").exists(), "move did not move")
            return "source removed, target exists"
        self.check("move file", move_file)

        def move_into_self():
            Path(work, "move_target", "nested").mkdir(exist_ok=True)
            d = self.jpost("/api/move", {
                "sources": [self.fx["work"]], "target": f"local:{Path(work, 'move_target', 'nested')}",
                "conflict": "skip",
            })
            results = d.get("results") or []
            self.require(results and results[0].get("status") == "error" and results[0].get("reason") == "into_self",
                        f"into_self: {d}")
        self.check("move directory into itself is rejected", move_into_self)

        def delete():
            p = Path(self.local_path(self.fx["ops"])) / "Delete Me.flac"
            missing = Path(work) / "not-here.flac"
            d = self.jpost("/api/delete", {"paths": [f"local:{p}", f"local:{missing}"]})
            self.require(d.get("deleted") == 1 and d.get("failed") == 1, f"delete: {d}")
            self.require(not p.exists(), "delete left file")
            not_found = (d.get("results") or [])[1]
            self.require(not_found.get("reason") == "not_found", f"missing delete: {not_found}")
            return d
        self.check("delete existing + missing", delete)

        def rmdir_nonempty():
            d = self.jpost("/api/rmdir", {"path": f"local:{Path(work, 'move_target')}"})
            self.require(d.get("ok") is False and d.get("error") == "目录非空", f"rmdir nonempty: {d}")
        self.check("rmdir non-empty directory rejected", rmdir_nonempty)

    # ---------- storage sources ----------
    def test_storage_sources(self):
        def save_local():
            d = self.jpost("/api/storage/sources", {
                "id": "testlocal", "kind": "local", "name": "Test Local", "root": self.local_path(self.fx["work"]),
            })
            self.require(d.get("ok") is True, f"save source: {d}")
            roots = d.get("roots") or []
            self.require(any(r.get("id") == "testlocal" for r in roots), f"roots: {roots}")
            invalid = self.post("/api/storage/sources", {
                "id": "../bad", "kind": "local", "name": "Bad", "root": "/tmp",
            })
            self.require(invalid.status_code == 400, f"invalid source accepted: {invalid.status_code}: {invalid.text[:120]}")
            return "testlocal added"
        self.check("save local source and validate id", save_local)

        def test_bad_dav():
            d = self.jpost("/api/storage/test", {"url": "http://127.0.0.1:1/no-such-dav", "verify": False})
            self.require(d.get("ok") is False and d.get("error"), f"bad dav: {d}")
            return d.get("error", "")[:120]
        self.check("WebDAV connection failure is reported", test_bad_dav)

        def delete_source():
            d = self.jpost("/api/storage/sources/delete", {"id": "testlocal"})
            self.require(d.get("ok") is True, f"delete source: {d}")
            protected = self.post("/api/storage/sources/delete", {"id": "local"})
            self.require(protected.status_code == 400, f"local source deletion not blocked: {protected.status_code}")
            return "custom deleted; local protected"
        self.check("delete source and protect local", delete_source)

    # ---------- tasks ----------
    def test_tasks(self):
        def preview():
            d = self.jpost("/api/tasks/rename-preview", {
                "path": self.fx["tasks"], "name_pattern": "{artist} - {title}", "limit": 10,
            })
            self.require(d.get("total", 0) >= 2, f"preview total: {d.get('total')}")
            self.require(all("new" in x for x in (d.get("items") or [])), f"preview items: {d.get('items')}")
            return d.get("items", [])[:3]
        self.check("rename preview", preview)

        def convert():
            src = Path(self.local_path(self.fx["tasks"])) / "Track One.flac"
            tid = self.start_task({
                "task": "convert", "path": self.fx["tasks"], "format": "FLAC-16-44",
                "output_dir": self.fx["out"], "delete_source": False,
                "only_files": [f"local:{src}"],
            })
            done = self.wait_task(tid)
            self.require(done.get("status") == "done", f"convert status: {done}")
            result = done.get("result") or {}
            self.require(result.get("success") == 1 and result.get("failed") == 0, f"convert result: {result}")
            output = Path(result["files"][0].get("output") or "")
            self.require(output.is_file(), f"converted output missing: {output}")
            return f"{tid}: {output.name}"
        self.check("convert task completes", convert)

        def tags():
            src = Path(self.local_path(self.fx["tasks"])) / "Track Two.flac"
            tid = self.start_task({
                "task": "tags", "path": self.fx["tasks"], "name_pattern": "{artist} - {title}",
                "only_files": [f"local:{src}"],
            })
            done = self.wait_task(tid)
            self.require(done.get("status") == "done", f"tags status: {done}")
            result = done.get("result") or {}
            self.require(result.get("success") == 1 and result.get("failed") == 0, f"tags result: {result}")
            output = Path(result["files"][0].get("output") or "")
            self.require(output.is_file(), f"renamed file missing: {output}")
            # The legacy rename pipeline promotes composer into the artist field.
            self.require(output.name == "Test Composer - Track Two.flac", f"unexpected rename: {output.name}")
            return output.name
        self.check("tags/rename task with composer", tags)

        def tags_no_composer():
            src = Path(self.local_path(self.fx["tasks"])) / "No Composer.flac"
            tid = self.start_task({
                "task": "tags", "path": self.fx["tasks"], "name_pattern": "{artist} - {title}",
                "only_files": [f"local:{src}"],
            })
            done = self.wait_task(tid)
            result = done.get("result") or {}
            self.require(done.get("status") == "done" and result.get("success") == 1,
                        f"no-composer rename failed: {result}")
            output = result.get("files", [{}])[0].get("output") or ""
            self.require(Path(self.local_path(output)).is_file(), f"renamed file missing: {output}")
            self.require(" - " in Path(output).name, f"name pattern not applied: {output}")
            return Path(output).name
        self.check("tags/rename tolerates missing composer", tags_no_composer)

        def check_task():
            src = Path(self.local_path(self.fx["tasks"])) / "Track With Cover.flac"
            tid = self.start_task({
                "task": "check", "path": self.fx["tasks"], "format": "flac",
                "only_files": [f"local:{src}"],
            })
            done = self.wait_task(tid)
            self.require(done.get("status") == "done", f"check status: {done}")
            result = done.get("result") or {}
            self.require(result.get("total") == 1 and result.get("files"), f"check result: {result}")
            self.require(result["files"][0].get("has_cover") is True, "check did not see cover")
            return f"{result.get('total')} file checked"
        self.check("check tags task", check_task)

        def cover_task():
            src = Path(self.local_path(self.fx["tasks"])) / "Track One.flac"
            tid = self.start_task({
                "task": "cover", "path": self.fx["tasks"], "format": "flac",
                "cover_path": self.fx["cover_jpg"], "only_files": [f"local:{src}"],
            })
            done = self.wait_task(tid)
            self.require(done.get("status") == "done", f"cover status: {done}")
            result = done.get("result") or {}
            self.require(result.get("success") == 1 and result.get("failed") == 0, f"cover result: {result}")
            probe = self.jget("/api/probe_file", params={"path": f"local:{src}"})
            self.require(probe.get("has_cover") is True, "cover not embedded")
            image = self.get("/api/cover", params={"path": f"local:{src}"})
            self.require(image.status_code == 200, f"cover endpoint: {image.status_code}")
            return "cover embedded and served"
        self.check("replace cover task", cover_task)

        def task_presets():
            initial = self.jget("/api/task-presets")
            self.require(isinstance(initial.get("presets"), dict), f"presets: {initial}")
            payload = {"presets": dict(initial["presets"], **{
                "Cloud Regression": {
                    "task": "convert", "format": "FLAC-16-44",
                    "output_dir": "", "delete_source": False,
                }
            })}
            saved = self.jpost("/api/task-presets", payload)
            self.require(saved.get("ok") is True, f"save presets: {saved}")
            after = self.jget("/api/task-presets")
            self.require("Cloud Regression" in (after.get("presets") or {}), f"preset missing: {after}")
            return "save + reload"
        self.check("task presets persist", task_presets)

        def invalid_start():
            r = self.post("/api/start", {"task": "nope", "path": self.fx["tasks"]})
            self.require(r.status_code == 400, f"unknown task -> {r.status_code}")
            r = self.post("/api/start", {"task": "convert", "path": "local:/definitely/not/here"})
            self.require(r.status_code == 400, f"missing path -> {r.status_code}")
        self.check("start task validation", invalid_start)

        def task_list_and_status():
            d = self.jget("/api/tasks")
            self.require(isinstance(d.get("tasks"), list) and d["tasks"], f"tasks: {d}")
            missing = self.get("/api/task/not-a-real-id/status")
            self.require(missing.status_code == 404, f"missing task status -> {missing.status_code}")
            cancel = self.post("/api/task/not-a-real-id/cancel", {})
            self.require(cancel.status_code == 404, f"missing task cancel -> {cancel.status_code}")
            return f"{len(d['tasks'])} tasks persisted/listed"
        self.check("task list and missing status", task_list_and_status)

        def task_stream():
            if not self.task_ids:
                raise CheckFailure("no task id available")
            tid = self.task_ids[0]
            with self.client.stream("GET", f"/api/task/{tid}/stream") as r:
                self.require(r.status_code == 200, f"stream -> {r.status_code}")
                text = "".join(r.iter_text())
            self.require("data:" in text or ": ping" in text, f"SSE body: {text[:200]!r}")
            return f"{len(text)} bytes"
        self.check("task SSE stream", task_stream)

    # ---------- Android bridge fallbacks ----------
    def test_native_fallbacks(self):
        def audio():
            info = self.jget("/api/audio/info")
            self.require(info.get("ok") is False and info.get("error") == "not_supported", f"audio info: {info}")
            devices = self.jget("/api/audio/devices")
            self.require(devices == [], f"audio devices: {devices}")
            state = self.jget("/api/playback/state")
            self.require(state.get("ok") is False, f"playback state: {state}")
            return "not_supported/[]"
        self.check("native audio falls back cleanly on cloud", audio)

        def fx():
            d = self.jpost("/api/audio/fx", {"op": "bass", "a": 5, "b": 0})
            self.require(d.get("ok") is False, f"audio fx: {d}")
            dev = self.jpost("/api/audio/device", {"id": 1})
            self.require(dev.get("ok") is False, f"audio device: {dev}")
            return "fx + device"
        self.check("native audio FX/device fall back cleanly", fx)

        def playback_routes():
            posts = [
                ("/api/playback/open", {"path": self.fx["track1"]}),
                ("/api/playback/pause", {}),
                ("/api/playback/resume", {}),
                ("/api/playback/stop", {}),
                ("/api/playback/seek", {"positionMs": 1000}),
                ("/api/playback/meta", {"path": self.fx["track1"]}),
                ("/api/playback/queue", {"paths": [self.fx["track1"]], "index": 0}),
                ("/api/playback/volume", {"volume": 0.5}),
                ("/api/playback/mode", {"repeat": 1, "shuffle": False}),
                ("/api/playback/skip", {"dir": 1}),
            ]
            for url, payload in posts:
                d = self.jpost(url, payload)
                self.require(d.get("ok") is False, f"{url} cloud fallback: {d}")
            spectrum = self.jget("/api/playback/spectrum")
            self.require(spectrum.get("ok") is False, f"spectrum: {spectrum}")
            diag = self.jget("/api/playback/diag")
            self.require(diag.get("ok") is True and diag.get("bridge") is False, f"diag: {diag}")
            return f"{len(posts)} control routes + spectrum/diag"
        self.check("all native playback routes have cloud fallbacks", playback_routes)

    def run(self):
        self.test_static_and_capabilities()
        self.test_browse_and_metadata()
        self.test_media()
        self.test_filesystem()
        self.test_storage_sources()
        self.test_tasks()
        self.test_native_fallbacks()
        self.client.close()
        return self.results


def run_api(base_url: str, fixture: Dict[str, str]) -> Dict[str, Any]:
    suite = ApiRegression(base_url, fixture)
    results = suite.run()
    passed = sum(1 for r in results if r["ok"])
    return {
        "results": results,
        "passed": passed,
        "failed": len(results) - passed,
    }
