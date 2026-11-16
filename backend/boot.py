# -*- coding: utf-8 -*-
"""Android/Chaquopy 入口：读壳层配置 JSON → 设 env → 启动服务。"""
import json
import os


def run(config_path: str) -> None:
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        for k, v in cfg.items():
            os.environ[str(k)] = str(v)
    except Exception:
        pass
    from .cli import main
    main()
