#!/usr/bin/env python3
"""Run the cloud-side Audio-CPM regression suite.

Examples:
    python3 packaging/tests/cloud/run_cloud_suite.py
    python3 packaging/tests/cloud/run_cloud_suite.py --no-ui --keep
    python3 packaging/tests/cloud/run_cloud_suite.py --port 8773

The backend is started with AC2_ROOT and AC2_DATA_DIR pointing at a temporary
directory.  API tests and UI tests use separate sub-trees, so a task created
in one test cannot consume another test's fixture.
"""
from __future__ import annotations

import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))

from fixtures import build_fixture  # noqa: E402
from api_regression import run_api  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def start_update_feed():
    """本地假 GitHub feed，保证更新检查测试不依赖公网/限流。"""
    release = {
        "tag_name": "v0.5.3",
        "name": "Audio-CPM 0.5.3",
        "body": "Release fixture",
        "html_url": "https://github.com/olddriverdoge/Audio-CPM/releases/tag/v0.5.3",
        "published_at": "2026-11-20T10:00:00Z",
        "prerelease": False,
        "assets": [{
            "name": "Audio-CPM-0.5.3.apk",
            "browser_download_url": "https://github.com/olddriverdoge/Audio-CPM/releases/download/v0.5.3/Audio-CPM-0.5.3.apk",
            "size": 1000,
            "updated_at": "2026-11-20T10:00:00Z",
        }],
    }
    test = {
        "tag_name": "debug-latest",
        "name": "Audio-CPM debug 0.5.4",
        "body": "Debug fixture",
        "html_url": "https://github.com/olddriverdoge/Audio-CPM/releases/tag/debug-latest",
        "published_at": "2026-11-20T10:00:00Z",
        "prerelease": True,
        "assets": [{
            "name": "Audio-CPM-0.5.4-84-debug.apk",
            "browser_download_url": "https://github.com/olddriverdoge/Audio-CPM/releases/download/debug-latest/Audio-CPM-0.5.4-84-debug.apk",
            "size": 1000,
            "updated_at": "2026-11-20T10:00:00Z",
        }],
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            data = release if self.path.startswith("/release.json") else test
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    port = free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    return srv, f"http://127.0.0.1:{port}"


def wait_backend(base: str, proc: subprocess.Popen, timeout: float = 30.0):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"backend exited early with code {proc.returncode}")
        try:
            r = httpx.get(base + "/api/capabilities", timeout=1.0)
            if r.status_code == 200:
                return r.json()
        except Exception as exc:
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"backend did not become ready: {last_error}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0, help="0 picks a free port")
    ap.add_argument("--no-api", action="store_true")
    ap.add_argument("--no-ui", action="store_true")
    ap.add_argument("--keep", action="store_true", help="keep the temporary fixture tree")
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--report", default="", help="write the full JSON report to this path")
    args = ap.parse_args()

    started = time.time()
    port = args.port or free_port()
    base = f"http://127.0.0.1:{port}"
    temp = Path(tempfile.mkdtemp(prefix="ac2_cloud_suite_"))
    root = temp / "root"
    data = temp / "data"
    shots = temp / "screenshots"
    server_log = temp / "server.log"
    server = None
    report: dict = {}
    exit_code = 0

    ffmpeg = os.environ.get("AC2_FFMPEG_BIN") or shutil.which("ffmpeg") or "ffmpeg"
    print(f"fixture: {temp}")
    try:
        fixture = build_fixture(root, ffmpeg=ffmpeg)
    except Exception as exc:
        print(f"FIXTURE FAILED: {type(exc).__name__}: {exc}")
        traceback.print_exc()
        return 2

    feed_server, feed_base = start_update_feed()

    env = os.environ.copy()
    env.update({
        "AC2_ROOT": str(root),
        "AC2_DATA_DIR": str(data),
        "AC2_FFMPEG_BIN": ffmpeg,
        "AC2_PORT": str(port),
        "AC2_HOST": "127.0.0.1",
        "PYTHONUNBUFFERED": "1",
        # 更新检查固定到本地假 feed，避免公网 GitHub 限流影响回归结果。
        "AC2_APP_VERSION": "0.5.3",
        "AC2_APP_VERSION_CODE": "83",
        "AC2_UPDATE_CHANNEL": "release",
        "AC2_UPDATE_RELEASE_FEED": feed_base + "/release.json",
        "AC2_UPDATE_TEST_FEED": feed_base + "/test.json",
        "AC2_UPDATE_CACHE_TTL": "600",
    })
    log_handle = open(server_log, "w", encoding="utf-8")
    try:
        server = subprocess.Popen(
            [sys.executable, "ac_web.py", "--host", "127.0.0.1", "--port", str(port)],
            cwd=str(REPO), env=env, stdout=log_handle, stderr=subprocess.STDOUT,
        )
        caps = wait_backend(base, server, timeout=30)
        print(f"backend: {base}  ffmpeg={caps.get('ffmpeg')} formats={caps.get('formats')}")

        if not args.no_api:
            api = run_api(base, fixture)
            report["api"] = api
            print(f"API: {api['passed']} passed, {api['failed']} failed")
            for item in api["results"]:
                if not item["ok"]:
                    print(f"  FAIL {item['name']}: {item['detail']}")
            if api["failed"]:
                exit_code = 1

        if not args.no_ui:
            try:
                from ui_regression import run_ui
                ui = run_ui(base, fixture, shots)
            except Exception as exc:
                traceback.print_exc()
                ui = {"results": [], "passed": 0, "failed": 1, "error": f"{type(exc).__name__}: {exc}"}
                print(f"UI FAILED: {ui['error']}")
                exit_code = 1
            report["ui"] = ui
            if ui.get("results"):
                print(f"UI: {ui['passed']} passed, {ui['failed']} failed")
                for item in ui["results"]:
                    if not item["ok"]:
                        print(f"  FAIL {item['name']}: {item['detail']}")
                if ui["failed"]:
                    exit_code = 1
                if ui.get("page_errors"):
                    print(f"  page errors: {ui['page_errors'][:3]}")
                    exit_code = 1
                if ui.get("console_errors"):
                    print(f"  console errors: {ui['console_errors'][:3]}")
                    exit_code = 1
    except Exception as exc:
        print(f"SUITE ERROR: {type(exc).__name__}: {exc}")
        traceback.print_exc()
        exit_code = 2
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=8)
            except Exception:
                server.kill()
        log_handle.close()
        try:
            feed_server.shutdown()
            feed_server.server_close()
        except Exception:
            pass
        if not args.keep:
            shutil.rmtree(temp, ignore_errors=True)

    report["base"] = base
    report["fixture"] = str(temp)
    report["screenshots"] = str(shots)
    report["duration_sec"] = round(time.time() - started, 2)
    report["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    report["pass"] = exit_code == 0
    report_file = Path(args.report) if args.report else (temp / "report.json" if args.keep else None)
    if report_file is not None:
        report_file.parent.mkdir(parents=True, exist_ok=True)
        report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("REPORT FILE:", report_file)
    print("RESULT:", "PASS" if exit_code == 0 else "FAIL")
    print("REPORT:", json.dumps(report, ensure_ascii=False, indent=2)[:12000])
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
