# -*- coding: utf-8 -*-
"""界面默认配置导出。

前端把当前浏览器 localStorage 里的场景/频谱/表头快照 POST 到本机服务，
后端保存为 DATA_DIR/ac2_ui_defaults_export.json，随后可用 GET 下载。这个
文件可以直接作为 frontend/defaults.json 打进生产包或测试包，让首次安装
得到人工调好的默认布局。

只接受本机同源请求；限制体积并校验最小结构，避免把任意大文件写进数据目录。
"""
import json
import os

from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from ..config import DATA_DIR

EXPORT_FILE = os.path.join(DATA_DIR, "ac2_ui_defaults_export.json")
MAX_BYTES = 512 * 1024
SCHEMA = "audio-cpm-ui-defaults"


def _error(message, status=400):
    return JSONResponse({"ok": False, "error": message}, status_code=status)


async def export_defaults(request):
    """POST：保存前端提交的界面默认配置快照。"""
    origin = request.headers.get("origin")
    if origin and not origin.startswith(("http://127.0.0.1:", "http://localhost:")):
        return _error("origin not allowed", 403)
    raw = await request.body()
    if len(raw) > MAX_BYTES:
        return _error("config too large", 413)
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return _error("invalid json")
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        return _error("invalid schema")
    if not isinstance(data.get("defaultScenes"), list):
        return _error("defaultScenes must be a list")
    if not isinstance(data.get("prefs"), dict):
        return _error("prefs must be an object")

    try:
        text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False)
        tmp = EXPORT_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        os.replace(tmp, EXPORT_FILE)
    except Exception as exc:
        return _error("save failed: %s" % str(exc)[:160], 500)

    return JSONResponse({
        "ok": True,
        "download": "/api/ui/defaults/export",
        "bytes": len(text.encode("utf-8")),
        "scenes": len(data["defaultScenes"]),
        "prefs": len(data["prefs"]),
    })


async def download_defaults(request):
    """GET：下载最近一次导出的 JSON；没有导出时返回 404。"""
    if not os.path.isfile(EXPORT_FILE):
        return _error("no export yet", 404)
    return FileResponse(
        EXPORT_FILE,
        media_type="application/json",
        filename="ac2-ui-defaults.json",
        headers={"Cache-Control": "no-store"},
    )


routes = [
    Route("/api/ui/defaults/export", export_defaults, methods=["POST"]),
    Route("/api/ui/defaults/export", download_defaults, methods=["GET"]),
]
