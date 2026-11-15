# -*- coding: utf-8 -*-
"""p4a 启动器副本（仅供本地阅读/参考）。

**构建入口是仓库根 main.py**：buildozer 的 `source.dir=../..` 会把仓库根复制到
`--private` 目录，p4a 只认根目录下的 main.py。修改启动逻辑请改根 main.py，
再把本文件同步成同一份内容（或直接删掉本文件）。
"""

import os
import sys
import time
import traceback
from pathlib import Path


def _pick_data_dir(base: Path) -> Path:
    """优先用 private 目录下的 data/；不可写时退回 ANDROID_PRIVATE。"""
    candidates = [base / "data"]
    alt = os.environ.get("ANDROID_PRIVATE")
    if alt:
        candidates.append(Path(alt) / "data")
    for d in candidates:
        try:
            d.mkdir(parents=True, exist_ok=True)
            probe = d / ".write_test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
            return d
        except Exception:
            continue
    return base


def _log(data: Path, msg: str) -> None:
    try:
        with open(str(data / "ac2.log"), "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + str(msg) + "\n")
    except Exception:
        pass


def main():
    base = Path(__file__).resolve().parent
    data = _pick_data_dir(base)

    os.environ.setdefault("AC2_DATA_DIR", str(data))
    os.environ.setdefault("AC2_ROOT", "/sdcard")
    os.environ.setdefault("AC2_HOST", "127.0.0.1")
    os.environ.setdefault("AC2_PORT", "8000")
    os.environ.setdefault("AC2_ANDROID", "1")

    _log(data, "boot: base=%s data=%s" % (base, data))

    # nativeLibraryDir：ffbin.prepare() 会从这里复制 libffmpegbin.so/libav*
    try:
        from jnius import autoclass
        Activity = autoclass("org.kivy.android.PythonActivity")
        native = Activity.mActivity.getApplicationInfo().nativeLibraryDir
        os.environ.setdefault("AC2_NATIVE_LIB_DIR", native)
        _log(data, "nativeLibraryDir=%s" % native)
    except Exception:
        _log(data, "nativeLibraryDir failed:\n" + traceback.format_exc())

    # 存储权限（targetSdk 28 旧模型；34+ 需要 MANAGE_EXTERNAL_STORAGE 引导）
    try:
        from android.permissions import request_permissions, Permission
        request_permissions([Permission.READ_EXTERNAL_STORAGE,
                             Permission.WRITE_EXTERNAL_STORAGE])
        _log(data, "storage permissions requested")
    except Exception:
        _log(data, "permissions failed:\n" + traceback.format_exc())

    try:
        _log(data, "import backend.cli")
        from backend.cli import main as run
        _log(data, "starting uvicorn on %s:%s" % (
            os.environ.get("AC2_HOST"), os.environ.get("AC2_PORT")))
        run()
    except Exception:
        tb = traceback.format_exc()
        _log(data, "FATAL:\n" + tb)
        print(tb, file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
