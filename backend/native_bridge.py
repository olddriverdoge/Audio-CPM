# -*- coding: utf-8 -*-
"""Android 原生桥注册（app 内使用；Termux 下全部 no-op）。

Java: com.github.olddriverdoge.audiocpm.Ac2Bridge
  playback: play/pause/resume/seek/stop/state/spectrum
  open: 外部播放器 Intent + content://
"""
import json
import os

_open_external = None
_has_all = None
_playback = None


def available() -> bool:
    return _open_external is not None


def playback_available() -> bool:
    return _playback is not None


def register() -> bool:
    if not (os.environ.get('AC2_ANDROID') or os.environ.get('ANDROID_ARGUMENT')):
        return False
    try:
        from jnius import autoclass  # type: ignore
        Bridge = autoclass('com.github.olddriverdoge.audiocpm.Ac2Bridge')
    except Exception:
        return False

    global _open_external, _has_all, _playback
    try:
        _open_external = lambda path, pkg, act: json.loads(Bridge.open(path, pkg or '', act or ''))
    except Exception:
        _open_external = None
    try:
        _has_all = lambda: bool(Bridge.hasAllFiles())
    except Exception:
        _has_all = None
    try:
        def _call(method, *args):
            return json.loads(getattr(Bridge, method)(*args))
        _playback = {
            'play': lambda p, s, sr, bd, ch: _call('play', str(p), int(s or 0), int(sr or 0), int(bd or 0), int(ch or 0)),
            'pause': lambda: _call('pause'),
            'resume': lambda: _call('resume'),
            'seek': lambda ms: _call('seek', int(ms or 0)),
            'stop': lambda: _call('stop'),
            'state': lambda: _call('state'),
            'spectrum': lambda: _call('spectrum'),
            'spectrum_enabled': lambda b: Bridge.setSpectrumEnabled(bool(b)),
        }
    except Exception:
        _playback = None
    return available()


def open_external(path: str, pkg: str = '', act: str = ''):
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


def playback_open(path, start_ms=0, sample_rate=0, bit_depth=0, channels=0):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['play'](path, start_ms, sample_rate, bit_depth, channels)
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def playback_control(action, value=None):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        if action == 'seek':
            return _playback['seek'](value or 0)
        return _playback[action]()
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def playback_state():
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['state']()
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def playback_spectrum(enabled=None):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        if enabled is not None:
            _playback['spectrum_enabled'](enabled)
        return _playback['spectrum']()
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}
