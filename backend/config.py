# -*- coding: utf-8 -*-
"""全局配置：根目录、扩展名、缓存目录。

路径全部走环境变量，Termux 用默认值，app 侧注入：
  AC2_DATA_DIR   可写数据目录（配置/预设/缓存），默认项目根
  AC2_ROOT       默认本地根，默认 /sdcard/ADM（不存在则 ~）
  AC2_FFMPEG_BIN ffmpeg 可执行文件，默认 PATH 里的 ffmpeg
"""
import os
import tempfile

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(ROOT_DIR, 'frontend')
SCRIPT_DIR = ROOT_DIR

# 可写数据目录（app 内不能写安装目录，用 AC2_DATA_DIR 指向 filesDir）
DATA_DIR = os.environ.get('AC2_DATA_DIR') or SCRIPT_DIR
try:
    os.makedirs(DATA_DIR, exist_ok=True)
except Exception:
    pass

PRESETS_FILE = os.path.join(DATA_DIR, "ac2_presets.json")
UI_CONFIG_FILE = os.path.join(DATA_DIR, "ac2_ui_config.json")
STORAGE_FILE = os.path.join(DATA_DIR, "ac2_storage.json")
TASKS_FILE = os.path.join(DATA_DIR, "ac2_tasks.json")

FFMPEG_BIN = os.environ.get('AC2_FFMPEG_BIN') or 'ffmpeg'

DEFAULT_ROOT = os.environ.get('AC2_ROOT') or ("/sdcard/ADM" if os.path.isdir("/sdcard/ADM") else os.path.expanduser("~"))

# 公共存储白名单：标准前缀 + 配置的根（app 内根可能是 /storage/emulated/0 或 /sdcard）
PUBLIC_PREFIXES = ('/sdcard', '/storage/emulated/0')
if os.environ.get('AC2_ROOT'):
    PUBLIC_PREFIXES = tuple(dict.fromkeys(PUBLIC_PREFIXES + (os.environ['AC2_ROOT'],)))
# 永远不允许删除/覆盖这些根
FORBIDDEN_ROOTS = ('/', '/sdcard', '/storage/emulated/0')

MEDIA_EXTS = {'.flac','.wav','.aif','.aiff','.mp3','.m4a','.aac','.ogg','.opus','.ape','.wv','.dsf','.dff'}
IMAGE_EXTS = {'.jpg','.jpeg','.png','.bmp','.webp'}
LOSSLESS_CODECS = {'flac','wav','aif','aiff','alac','ape','wv','dsf','dff'}

# 缓存统一放在 DATA_DIR/cache（app 内 TMPDIR 不可靠）
CACHE_DIR = os.path.join(DATA_DIR, "cache")
COVER_CACHE_DIR = os.path.join(CACHE_DIR, "covers")
WAVE_CACHE_DIR = os.path.join(CACHE_DIR, "wave")
for _d in (CACHE_DIR, COVER_CACHE_DIR, WAVE_CACHE_DIR):
    try:
        os.makedirs(_d, exist_ok=True)
    except Exception:
        pass
