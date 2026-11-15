#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AC2 Web 启动入口。

后端实现按职责拆在 backend/（配置 / ffmpeg / 任务 / 路由 / 波形），
前端在 frontend/（index.html + css/ + js/），本文件只负责启动。
用法: python3 ac_web.py [--host 127.0.0.1] [--port 8000]
"""
from backend.cli import main

if __name__ == "__main__":
    main()
