# -*- coding: utf-8 -*-
"""Android 原生桥注册（app 内使用；Termux 下全部 no-op）。

Java: com.github.olddriverdoge.audiocpm.AudioCpmBridge
  playback: play/pause/resume/seek/stop/state/spectrum
  open: 外部播放器 Intent + content://
"""
import json
import logging
import os
import time

logger = logging.getLogger('ac2.native')

_open_external = None
_has_all = None
_playback = None


def available() -> bool:
    return _open_external is not None


def playback_available() -> bool:
    return _playback is not None


def _bridge_class():
    """拿到原生桥 Class：Chaquopy 的 jclass 或 Termux/p4a 的 jnius autoclass。"""
    try:
        from java import jclass  # type: ignore  （Chaquopy）
        return jclass('com.github.olddriverdoge.audiocpm.AudioCpmBridge'), 'chaquopy'
    except Exception:
        pass
    try:
        from jnius import autoclass  # type: ignore  （python-for-android / Termux）
        return autoclass('com.github.olddriverdoge.audiocpm.AudioCpmBridge'), 'jnius'
    except Exception:
        return None, ''


def register() -> bool:
    if not (os.environ.get('AC2_ANDROID') or os.environ.get('ANDROID_ARGUMENT')):
        return False
    Bridge, _impl = _bridge_class()
    if Bridge is None:
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
            'queue': lambda paths, idx, ms: _call('setQueue', list(paths), int(idx or 0), int(ms or 0)),
            'queue_list': lambda: _call('queueList'),
            'queue_play': lambda idx: _call('queuePlay', int(idx or 0)),
            'spectrum_enabled': lambda b: Bridge.setSpectrumEnabled(bool(b)),
            'volume': lambda v: _call('setVolume', float(v)),
            'mode': lambda rep, sh: _call('setMode', int(rep), bool(sh)),
            'skip': lambda d: _call('skip', int(d)),
            'audio_fx': lambda op, a, b: _call('fx', str(op), int(a), int(b)),
            'audio_info_raw': lambda: Bridge.audioInfo(),
            'devices': lambda: _call('audioDevices'),
            'set_device': lambda id: _call('setAudioDevice', int(id or 0)),
            'meta': lambda p, t, a, c, al: _call('setNowPlayingMeta', str(p), str(t or ''), str(a or ''), str(c or ''), str(al or '')),
        }
    except Exception:
        _playback = None
    # 波形沿用旧 p4a 的 ffmpeg 子进程路径（waveform._peaks_ffmpeg）。
    # 不再注册 AudioCpmWave（MediaCodec）为 native_provider：它在 24bit FLAC 上实测 3.5~5.7s、
    # 且峰值质量差（“大量方块”）；而打包的静态 ffmpeg 解 4kHz 单声道只要零点几秒，
    # 这才是旧版“秒出波形”的真正实现。
    try:
        from . import waveform
        waveform.native_provider = None
    except Exception:
        pass
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


def playback_queue(paths, index=0, start_ms=0):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['queue'](paths, index, start_ms)
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def playback_control(action, value=None):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        if action == 'seek':
            return _playback['seek'](value or 0)
        if action == 'volume':
            return _playback['volume'](value or 0)
        if action == 'skip':
            return _playback['skip'](value or 1)
        if action == 'mode':
            return _playback['mode'](int((value or {}).get('repeat', 0)), bool((value or {}).get('shuffle', False)))
        return _playback[action]()
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def audio_fx(op, a=0, b=0):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['audio_fx'](op, a, b)
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


SOFTWARE_FX_FALLBACK = {
    'ok': True, 'mode': 'software', 'bands': 10,
    'minLevel': -1000, 'maxLevel': 1000, 'eqOn': False, 'preamp': 0,
    'freqs': [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
    'levels': [0] * 10, 'treble': True, 'bass': True, 'virt': True, 'session': -1,
}


def audio_devices():
    if not _playback:
        return []
    try:
        return _playback['devices']()
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def set_audio_device(device_id):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['set_device'](device_id)
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def playback_meta(path, title='', artist='', composer='', album=''):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['meta'](path, title, artist, composer, album)
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def audio_info():
    if not _playback:
        # 播放服务尚未起来时，软件 EQ/音效本身仍然存在；返回可用骨架，
        # 避免音频模块一打开就显示“不可用”。播放启动后重新打开会刷新真实信息。
        if available():
            logger.info('audio_info: playback bridge not ready, returning software EQ fallback')
            return {'ok': True, 'pending': True, 'playback_available': False,
                    'bridge_available': True, 'mode': 'software',
                    'player': False, 'playing': False, 'playbackState': -1,
                    'deviceSampleRate': 0, 'format': {}, 'sourceFormat': {},
                    'fx': dict(SOFTWARE_FX_FALLBACK)}
        logger.warning('audio_info: native playback bridge not registered')
        return {'ok': False, 'error': 'not_supported', 'playback_available': False,
                'bridge_available': available()}
    raw = None
    try:
        raw = _playback['audio_info_raw']()
        r = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(r, dict):
            r.setdefault('playback_available', True)
            return r
        return {'ok': False, 'error': 'bad native response', 'raw': str(r)[:300]}
    except Exception as e:
        logger.warning('audio_info parse failed: %s raw=%s', e, (raw or '')[:300])
        if available():
            fb = {'ok': True, 'pending': True, 'playback_available': True,
                  'bridge_available': True, 'mode': 'software',
                  'player': True, 'playing': False, 'playbackState': -1,
                  'deviceSampleRate': 0, 'format': {}, 'sourceFormat': {},
                  'fx': dict(SOFTWARE_FX_FALLBACK),
                  'warning': str(e)[:120],
                  'audioInfoRaw': (raw or '')[:600]}
            return fb
        return {'ok': False, 'error': str(e)[:300], 'playback_available': True}


def playback_state():
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['state']()
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


# 原生 FFT 是进程级开关：主页面切后台会 setEnabled(False)，会把浮窗里的声谱
# 一起关掉。浮窗每次取数带 lease=1 续约，租约期间忽略其它页面的关闭请求；
# 租约过期后自动关掉 FFT，避免浮窗关掉后还一直占用 CPU。
_spectrum_lease_until = 0.0
_spectrum_lease_on = False


def playback_queue_list():
    if not _playback or 'queue_list' not in _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['queue_list']()
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def playback_queue_play(index):
    if not _playback or 'queue_play' not in _playback:
        return {'ok': False, 'error': 'not_supported'}
    try:
        return _playback['queue_play'](index)
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}


def playback_spectrum(enabled=None, lease=False, release=False):
    if not _playback:
        return {'ok': False, 'error': 'not_supported'}
    global _spectrum_lease_until, _spectrum_lease_on
    try:
        now = time.time()
        if release:
            _spectrum_lease_until = 0.0
            _spectrum_lease_on = False
            _playback['spectrum_enabled'](False)
            return _playback['spectrum']()
        if lease:
            _spectrum_lease_until = now + 6.0
            if not _spectrum_lease_on:
                _playback['spectrum_enabled'](True)
                _spectrum_lease_on = True
            return _playback['spectrum']()
        if _spectrum_lease_on and now >= _spectrum_lease_until:
            _spectrum_lease_on = False
            _playback['spectrum_enabled'](False)
        if enabled is not None:
            # 浮窗还在取数时，不接受主页面“切后台就关 FFT”的请求。
            if enabled is False and now < _spectrum_lease_until:
                pass
            else:
                _playback['spectrum_enabled'](enabled)
        return _playback['spectrum']()
    except Exception as e:
        return {'ok': False, 'error': str(e)[:300]}
