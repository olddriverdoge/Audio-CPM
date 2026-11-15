# -*- coding: utf-8 -*-
"""界面配置持久化（ac2_ui_config.json）：自动保存 + 命名预设 + 导入导出。Starlette 版。"""
import json
import os

from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.routing import Route

from ..config import UI_CONFIG_FILE
from ..simple import J, body

routes = []

MAX_CFG_BYTES = 512 * 1024


def _empty():
    return {"config": {}, "presets": {}, "active": ""}


def _load():
    if not os.path.exists(UI_CONFIG_FILE):
        return _empty()
    try:
        with open(UI_CONFIG_FILE, 'r', encoding='utf-8') as f:
            d = json.load(f)
    except Exception:
        return _empty()
    if not isinstance(d, dict):
        return _empty()
    cfg = d.get('config')
    prs = d.get('presets')
    return {
        "config": cfg if isinstance(cfg, dict) else {},
        "presets": prs if isinstance(prs, dict) else {},
        "active": d.get('active') if isinstance(d.get('active'), str) else '',
    }


def _save(d):
    tmp = UI_CONFIG_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, UI_CONFIG_FILE)


def _check_cfg(cfg):
    if not isinstance(cfg, dict):
        raise HTTPException(400, "config 必须是对象")
    try:
        raw = json.dumps(cfg, ensure_ascii=False)
    except Exception:
        raise HTTPException(400, "config 无法序列化")
    if len(raw.encode('utf-8')) > MAX_CFG_BYTES:
        raise HTTPException(413, "配置过大（>512KB）")


def _preset_name(payload):
    name = str(payload.get('name') or '').strip()
    if not name:
        raise HTTPException(400, "预设名不能为空")
    return name[:60]


def api_ui_config(request: Request):
    d = _load()
    d['file'] = UI_CONFIG_FILE
    return J(d)


async def api_ui_config_save(request: Request):
    payload = await body(request)
    cfg = payload.get('config')
    _check_cfg(cfg)
    d = _load()
    if d['config'] == cfg:
        return J({"ok": True, "saved": False, "file": UI_CONFIG_FILE})
    d['config'] = cfg
    _save(d)
    return J({"ok": True, "saved": True, "file": UI_CONFIG_FILE})


async def api_ui_preset_save(request: Request):
    payload = await body(request)
    name = _preset_name(payload)
    cfg = payload.get('config')
    _check_cfg(cfg)
    d = _load()
    d['presets'][name] = cfg
    d['active'] = name
    d['config'] = cfg
    _save(d)
    return J({"ok": True, "presets": d['presets'], "active": name, "file": UI_CONFIG_FILE})


async def api_ui_preset_load(request: Request):
    payload = await body(request)
    name = _preset_name(payload)
    d = _load()
    if name not in d['presets']:
        raise HTTPException(404, "预设不存在: " + name)
    d['config'] = d['presets'][name]
    d['active'] = name
    _save(d)
    return J({"ok": True, "config": d['config'], "active": name})


async def api_ui_preset_delete(request: Request):
    payload = await body(request)
    name = _preset_name(payload)
    d = _load()
    if name in d['presets']:
        del d['presets'][name]
        if d.get('active') == name:
            d['active'] = ''
        _save(d)
    return J({"ok": True, "presets": d['presets'], "active": d.get('active', '')})


routes.append(Route('/api/ui_config', api_ui_config))
routes.append(Route('/api/ui_config', api_ui_config_save, methods=['POST']))
routes.append(Route('/api/ui_config/preset', api_ui_preset_save, methods=['POST']))
routes.append(Route('/api/ui_config/preset/load', api_ui_preset_load, methods=['POST']))
routes.append(Route('/api/ui_config/preset/delete', api_ui_preset_delete, methods=['POST']))
