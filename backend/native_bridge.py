# -*- coding: utf-8 -*-
"""Android 原生桥注册（app 内使用；Termux 下全部 no-op，不影响现有行为）。

打包时由 packaging/android 的 com.example.ac2.Ac2Bridge 提供：
  peaks(path, buckets) -> JSON {"ok":true,"peaks":[...]}（MediaCodec 解码）
  open(path, pkg, act) -> JSON {"status":"ok"|"error"|"blocked","message":...}（Intent + FileProvider）
  hasAllFiles() / openAllFilesSettings()（存储权限引导）
"""
import json
import os

_open_external = None
_has_all = None


def available() -> bool:
    return _open_external is not None


def register() -> bool:
    """在 Android 上绑定 Java 桥；非 Android 或失败时静默跳过。"""
    if not (os.environ.get('AC2_ANDROID') or os.environ.get('ANDROID_ARGUMENT')):
        return False
    try:
        from jnius import autoclass  # type: ignore
        Bridge = autoclass('com.github.olddriverdoge.audiocpm.Ac2Bridge')
    except Exception:
        return False

    # 波形：注册到 waveform.native_provider（返回 0~1 未归一化峰值）
    try:
        from . import waveform

        def _peaks(path, buckets):
            d = json.loads(Bridge.peaks(path, int(buckets)))
            if not d.get('ok'):
                raise RuntimeError(d.get('error') or 'decode failed')
            return d.get('peaks') or []

        waveform.native_provider = _peaks
    except Exception:
        pass

    global _open_external, _has_all
    try:
        _open_external = lambda path, pkg, act: json.loads(Bridge.open(path, pkg or '', act or ''))
    except Exception:
        _open_external = None
    try:
        _has_all = lambda: bool(Bridge.hasAllFiles())
    except Exception:
        _has_all = None
    return available()


def open_external(path: str, pkg: str = '', act: str = ''):
    """返回原生桥的结果 dict；None 表示调用方应走 Termux 的 am 实现。"""
    if _open_external is None:
        return None
    try:
        return _open_external(path, pkg, act)
    except Exception as e:
        return {'status': 'error', 'message': str(e)[:200]}


def has_all_files():
    if _has_all is None:
        return None
    try:
        return _has_all()
    except Exception:
        return None
