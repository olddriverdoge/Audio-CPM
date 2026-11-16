# -*- coding: utf-8 -*-
"""p4a 启动器：注入环境变量 → 日志 → 权限 → 原生桥 → 启动 backend.cli.main。"""
import os
import sys
import threading
import time
import traceback
from pathlib import Path


def _pick_data_dir(base: Path) -> Path:
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
    os.environ.setdefault("AC2_PORT", "8765")
    os.environ.setdefault("AC2_ANDROID", "1")

    _log(data, "boot: base=%s data=%s" % (base, data))

    try:
        from jnius import autoclass
        Activity = autoclass("org.kivy.android.PythonActivity")
        native = Activity.mActivity.getApplicationInfo().nativeLibraryDir
        os.environ.setdefault("AC2_NATIVE_LIB_DIR", native)
        _log(data, "nativeLibraryDir=%s" % native)
    except BaseException:
        _log(data, "nativeLibraryDir failed:\n" + traceback.format_exc())

    # 先等权限结果再启动服务：授权后页面加载时已有权限，无需重启 app。
    started = {"done": False}

    def _start():
        if started["done"]:
            return
        started["done"] = True
        try:
            _log(data, "before import backend.cli")
            from backend.cli import main as run
            _log(data, "imported backend.cli; calling run()")
            run()
            _log(data, "run() returned")
        except BaseException:
            tb = traceback.format_exc()
            _log(data, "FATAL:\n" + tb)
            print(tb, file=sys.stderr)
            raise

    if os.environ.get("AC2_REQUEST_PERMISSIONS", "1") == "1":
        try:
            from android.permissions import request_permissions, Permission
            ev = threading.Event()

            def _cb(permissions=None, grants=None):
                _log(data, "permissions result: %s" % (grants,))
                ev.set()

            request_permissions([Permission.READ_EXTERNAL_STORAGE,
                                 Permission.WRITE_EXTERNAL_STORAGE], callback=_cb)
            _log(data, "waiting for storage permissions")
            ev.wait()
        except TypeError:
            _log(data, "permissions callback unsupported; start now")
        except BaseException:
            _log(data, "permissions failed:\n" + traceback.format_exc())
    _start()


if __name__ == "__main__":
    main()
