# -*- coding: utf-8 -*-
"""能力下发：前端据此显隐转换、频谱、HiFi 等依赖原生能力的功能。"""
import logging

from starlette.requests import Request
from starlette.routing import Route

from ..simple import J
from .. import ffbin
from .. import native_bridge
from ..update import app_meta

routes = []
logger = logging.getLogger("ac2.caps")

# 输出格式 → 需要的编码器（前端只展示 capabilities.formats 里的项）
FORMAT_ENCODER = {
    'flac': 'flac',
    'm4a': 'aac',
    'wav': 'pcm_s16le',
    'aif': 'pcm_s16be',
}


def _formats():
    if not ffbin.available():
        return []
    out = []
    for fmt, enc in FORMAT_ENCODER.items():
        if ffbin.has_encoder(enc):
            out.append(fmt)
    return out


async def api_capabilities(request: Request):
    caps = ffbin.capabilities()
    encoders = caps.pop('encoders', [])
    caps['formats'] = _formats()
    caps['encoders'] = encoders
    caps['hifi'] = native_bridge.playback_available()
    caps['notification'] = native_bridge.playback_available()
    caps['android'] = ffbin.is_android()
    caps.update(app_meta())
    return J(caps)


routes.append(Route('/api/capabilities', api_capabilities, methods=['GET']))
