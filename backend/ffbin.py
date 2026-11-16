# -*- coding: utf-8 -*-
"""FFmpeg 定位、执行方式与能力自检。

Android（Gradle/Chaquopy 新壳）下的三级策略：
  1. 直接 exec ``nativeLibraryDir/libffmpegbin.so``
     —— APK 以 ``extractNativeLibs=true`` 解压到 ``/data/app/<pkg>/lib/<abi>``（apk_data_file），
        Android 10+ 只禁 exec 可写数据目录，这里是允许的；
  2. 若文件没有 x 位，退化为 ``/system/bin/linker64 <bin>``（只需读权限）；
  3. 都失败则标记 ``ffmpeg=False``，功能降级（前端按 /api/capabilities 隐藏转换入口）。
Termux / PC 下仍使用 PATH 里的 ffmpeg（或 AC2_FFMPEG_BIN）。
"""
import os
import subprocess
import sys

from .config import DATA_DIR, FFMPEG_BIN

FFMPEG = FFMPEG_BIN
ENV = None            # None = 继承当前进程环境
LAUNCHER = []         # 需要前置解释器时（linker64）放这里，否则空

STATE = {
    'ready': False,
    'ffmpeg': False,      # 可执行且 -version 通过
    'path': FFMPEG_BIN,
    'mode': 'system',     # system | native | linker64 | unavailable
    'version': '',
    'error': '',
    'decoders': [],
    'encoders': [],
    'ffprobe': False,
}


def is_android() -> bool:
    return bool(os.environ.get('AC2_ANDROID')
                or os.environ.get('ANDROID_ARGUMENT')
                or ('android' in sys.platform.lower() and 'ANDROID' in os.environ))


def _log(msg: str) -> None:
    try:
        import time
        with open(os.path.join(DATA_DIR, 'ac2.log'), 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + 'ffbin: ' + str(msg) + '\n')
    except Exception:
        pass


def _run(argv, timeout=10, env=None):
    """返回 (ok, stdout+stderr, exception)；不抛异常。"""
    try:
        r = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout, env=env)
        out = (r.stdout or b'').decode('utf-8', 'ignore')
        return r.returncode == 0, out, None
    except Exception as e:      # PermissionError 也走这里
        return False, '', e


def _native_dir() -> str:
    d = os.environ.get('AC2_NATIVE_LIB_DIR') or ''
    if d and os.path.isdir(d):
        return d
    # 兜底：Android 上从 apk 路径推（仅当环境变量没注入时）
    return ''


def _parse_list(text: str, header: str):
    """解析 ffmpeg -decoders / -encoders 输出，返回名字集合。

    行格式形如 `` A....D aac  AAC (Advanced Audio Coding)``，标志位是 6~7 个 [A-Z.]
    """
    import re
    flag = re.compile(r'^[A-Z.]{5,7}$')
    names = set()
    seen = False
    for line in text.splitlines():
        if header in line:
            seen = True
            continue
        if not seen:
            continue
        parts = line.split()
        if len(parts) >= 2 and flag.match(parts[0]) and len(parts[1]) > 1:
            names.add(parts[1].rstrip('.').lower())
    return names


def _probe_capabilities() -> None:
    ok, out, err = _run(cmd('-version'))
    if not ok:
        STATE['error'] = str(err or out)[:300]
        return
    first = out.splitlines()[0] if out else ''
    STATE['version'] = first.strip()
    ok2, out2, _ = _run(cmd('-decoders'))
    if ok2:
        STATE['decoders'] = sorted(_parse_list(out2, 'Decoders:'))
    ok3, out3, _ = _run(cmd('-encoders'))
    if ok3:
        STATE['encoders'] = sorted(_parse_list(out3, 'Encoders:'))
    # ffprobe 若同目录存在则顺带标记（当前不打包）
    STATE['ffprobe'] = os.path.isfile(os.path.join(os.path.dirname(STATE['path']), 'libffprobe.so')) \
        if STATE['mode'] in ('native', 'linker64') else False


def prepare() -> str:
    """幂等：定位可执行文件、确定执行方式、跑一次能力自检。"""
    global FFMPEG, ENV, LAUNCHER
    if STATE['ready']:
        return FFMPEG
    STATE['ready'] = True

    if not is_android():
        STATE.update(ffmpeg=os.path.isfile(FFMPEG) or _which(FFMPEG) is not None,
                     path=FFMPEG, mode='system')
        if STATE['ffmpeg']:
            _probe_capabilities()
        _log('pc/termux mode=%s version=%s' % (STATE['mode'], STATE['version']))
        return FFMPEG

    native = _native_dir()
    legacy = os.path.join(DATA_DIR, 'bin', 'ffmpeg')
    candidates = []
    if native:
        candidates.append((os.path.join(native, 'libffmpegbin.so'), 'native'))
    if os.path.isfile(legacy):
        candidates.append((legacy, 'legacy'))

    for path, mode in candidates:
        if not os.path.isfile(path):
            continue
        err2 = None
        env = dict(os.environ)
        if native:
            env['LD_LIBRARY_PATH'] = native
        # 1) 直接执行
        ok, out, err = _run([path, '-version'], env=env)
        if ok:
            FFMPEG, ENV, LAUNCHER = path, env, []
            STATE.update(path=path, mode=mode, ffmpeg=True, error='')
            _probe_capabilities()
            _log('mode=%s path=%s version=%s' % (mode, path, STATE['version']))
            return FFMPEG
        # 2) linker64 兜底（应对文件无 x 位）
        if native:
            linker = '/system/bin/linker64'
            if os.path.isfile(linker):
                ok2, out2, err2 = _run([linker, path, '-version'], env=env)
                if ok2:
                    FFMPEG, ENV, LAUNCHER = path, env, [linker]
                    STATE.update(path=path, mode='linker64', ffmpeg=True, error='')
                    _probe_capabilities()
                    _log('mode=linker64 path=%s version=%s' % (path, STATE['version']))
                    return FFMPEG
        STATE['error'] = ('direct=%s linker=%s'
                          % (str(err)[:120], str(err2)[:120] if native else 'n/a'))
        _log('exec failed for %s: %s' % (path, STATE['error']))

    STATE.update(ffmpeg=False, mode='unavailable', error=STATE['error'] or 'ffmpeg not found')
    _log('ffmpeg unavailable: %s' % STATE['error'])
    return FFMPEG


def _which(name: str):
    from shutil import which
    return which(name)


def cmd(*args) -> list:
    """拼出完整命令行：launcher(可选) + 可执行 + 参数。"""
    return list(LAUNCHER) + [FFMPEG] + [str(a) for a in args]


def env():
    return ENV


def available() -> bool:
    if not STATE['ready']:
        prepare()
    return bool(STATE['ffmpeg'])


def has_encoder(name: str) -> bool:
    """编码器是否可用：未探测到列表时按乐观处理（由 ffmpeg 自己报错）。"""
    if not STATE['ready']:
        prepare()
    if not STATE['encoders']:
        return True
    return name.lower() in set(STATE['encoders'])


def capabilities() -> dict:
    if not STATE['ready']:
        prepare()
    return {
        'ffmpeg': bool(STATE['ffmpeg']),
        'mode': STATE['mode'],
        'version': STATE['version'],
        'encoders': list(STATE['encoders']),
        'ffprobe': bool(STATE['ffprobe']),
        'error': STATE['error'],
    }
