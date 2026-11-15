# -*- coding: utf-8 -*-
"""命令行入口（Termux / PC / app 壳共用，参数优先于环境变量）。"""
import argparse
import os
import time

import uvicorn

from .app import app
from .config import COVER_CACHE_DIR, PRESETS_FILE, DATA_DIR
from . import ffbin
from .jobs import load_tasks
from . import native_bridge


def _log(msg):
    try:
        with open(os.path.join(DATA_DIR, "ac2.log"), "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + str(msg) + "\n")
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser(description="AC2 Web 服务")
    ap.add_argument("--host", default=os.environ.get("AC2_HOST", "127.0.0.1"),
                    help="监听地址，局域网共享用 0.0.0.0")
    ap.add_argument("--port", type=int, default=int(os.environ.get("AC2_PORT", "8000")))
    args = ap.parse_args()
    _log("cli: prepared args host=%s port=%s" % (args.host, args.port))
    ffbin.prepare()
    _log("cli: ffbin.FFMPEG=%s" % ffbin.FFMPEG)
    native_bridge.register()
    _log("cli: native_bridge available=%s" % native_bridge.available())
    load_tasks()
    _log("cli: tasks loaded")
    print(f"数据目录: {DATA_DIR}")
    print(f"ffmpeg: {ffbin.FFMPEG}")
    print(f"预设配置文件: {PRESETS_FILE}")
    print(f"封面缓存: {COVER_CACHE_DIR}")
    host_display = '127.0.0.1' if args.host == '0.0.0.0' else args.host
    print(f"打开浏览器访问: http://{host_display}:{args.port}")
    _log("cli: creating uvicorn.Config")
    config = uvicorn.Config(app, host=args.host, port=args.port, log_level="info")
    _log("cli: creating uvicorn.Server")
    server = uvicorn.Server(config)
    if os.environ.get("AC2_ANDROID"):
        # p4a 在非主线程执行 main.py；uvicorn 默认安装 signal handlers 会抛
        # "signal only works in main thread"，导致进程在启动阶段静默退出。
        server.install_signal_handlers = lambda: None
    _log("cli: server.run() enter")
    server.run()
    _log("cli: server.run() returned")
