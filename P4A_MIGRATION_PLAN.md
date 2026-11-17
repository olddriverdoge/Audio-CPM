# p4a 迁移计划：现有项目要改什么

> 结论：**要改，但改动集中在 5 个后端文件 + 1 个前端文件 + 新增 `packaging/` 目录；业务算法本身不用重写。**
> 本文先修正三个关键事实，再给文件级改动清单、启动器/构建骨架、FFmpeg 集成方式和 PoC 顺序。
>
> 依据：python-for-android `develop` 分支源码（2026-11-15）。p4a 版本迭代快，构建前先锁 commit/版本。

---

## 0. 先修正三个事实（很重要）

### 0.1 FFmpeg recipe 确实存在，而且会产出 CLI 二进制

p4a 的 [ffmpeg recipe](https://github.com/kivy/python-for-android/blob/develop/pythonforandroid/recipes/ffmpeg/__init__.py)：

- 版本 **8.0.1**（不是 6.1.2；文档/第三方文章常滞后）；
- 构建 **共享库**：`libavcodec.so`、`libavformat.so`、`libavutil.so`、`libswresample.so` 等；
- **把 `ffmpeg` 可执行文件复制成 `lib/libffmpegbin.so`**，并列入 `built_libraries` → 会被打进 APK 的 `lib/<abi>/`（nativeLibraryDir）；
- 默认开 `--enable-jni --enable-mediacodec`（硬件解码），默认不 `--disable-everything`，所以 FFmpeg 的默认组件（FLAC/MP3/AAC/Opus/Vorbis 解码等）大概率在；
- 但它**不产出 `ffprobe`**：只复制了 `ffmpeg`，`ffprobe` 没有被列入 `built_libraries`。

这意味着：

| 需求 | p4a recipe 能否直接满足 | 说明 |
|---|---|---|
| ffmpeg CLI（转换/波形/标签） | **能**（`libffmpegbin.so`） | 但要解决 exec + 依赖库路径，见 §4 |
| ffprobe CLI（当前 `probe_file_detail`） | **不能** | 要么改 recipe 补 `libffprobe.so`，要么 **probe 改用 mutagen**（推荐） |
| 全量编码器（MP3/Opus/Vorbis） | 部分 | 默认可能只有 FLAC/AAC 编码；MP3 需 `ffpyplayer_codecs`（libshine）；Opus/Vorbis 编码需额外 recipe |

### 0.2 Python 版本是 3.14.2（develop），不是 3.11/3.12

[python3 recipe](https://github.com/kivy/python-for-android/blob/develop/pythonforandroid/recipes/python3/__init__.py) 的 `version = '3.14.2'`，`--enable-shared`，stdlib 打 zip、site-packages 复制。**与 Termux 3.14.6 基本同代**，你的代码不需要降级。但 p4a 的 release 版本可能落后于 develop，构建时以实际版本为准。

### 0.3 webview bootstrap 很薄：它只负责“等端口 + loadUrl”

[WebViewLoader.tmpl.java](https://github.com/kivy/python-for-android/blob/develop/pythonforandroid/bootstraps/webview/build/templates/WebViewLoader.tmpl.java) 的逻辑：

```java
while (true) {
    if (pingHost("localhost", {{ args.port }}, 100)) {
        loadUrl("http://127.0.0.1:{{ args.port }}/");
        break;
    }
    Thread.sleep(100);   // 没有超时、没有失败提示
}
```

- 端口来自 p4a 的 `--port`（buildozer.spec 的 `android.port`），**Python 侧必须监听同一个端口**，否则永远白屏；
- Python 启动慢/报错时没有任何提示，只有无限轮询——这是 p4a webview 最常见的“坑”；
- `AndroidManifest` 模板已带 `usesCleartextTraffic=true`、`extractNativeLibs=true`、`INTERNET` 权限、`targetSdkVersion={{ android_api }}`。

---

## 1. 现有项目改动清单（文件级）

### P0：不做就无法在 app 内启动

| # | 文件/位置 | 现状 | 改法 | 原因 |
|---|---|---|---|---|
| 1 | [backend/config.py](backend/config.py) 6-21 | `SCRIPT_DIR` 写配置/缓存 | 新增 `DATA_DIR = os.environ.get("AC2_DATA_DIR") or SCRIPT_DIR`；`PRESETS_FILE`/`UI_CONFIG_FILE`/`COVER_CACHE_DIR` 基于 `DATA_DIR` | p4a 的 app 目录可能只读；配置要写 `filesDir` |
| 2 | 同上 | `DEFAULT_ROOT="/sdcard/ADM"` | 改为 `os.environ.get("AC2_ROOT") or "/sdcard/ADM"`；不存在时回退 `~` | app 内路径/权限不同；WebDAV 后还要多根 |
| 3 | [backend/ffmpeg.py](backend/ffmpeg.py) 12-21、95-119、121-155、157-163 | 硬编码 `'ffmpeg'`/`'ffprobe'` | 定义 `FFMPEG = os.environ.get("AC2_FFMPEG_BIN", "ffmpeg")`、`FFPROBE = ...`；所有调用替换；`execute` 支持传入 `env`（给 `LD_LIBRARY_PATH`） | app 内二进制在 nativeLibraryDir/私有目录，不在 PATH |
| 4 | [backend/cli.py](backend/cli.py) 11-20 | argparse 读 `--host/--port` | 默认值改读 `AC2_HOST`/`AC2_PORT`；保留命令行参数 | app 启动器用 env 注入，不传 argv |
| 5 | [backend/app.py](backend/app.py) 10-26 | FastAPI + `StaticFiles` | **迁到 Starlette**（见 P0-8）；`StaticFiles(directory=FRONTEND_DIR)` 不变 | p4a 装不上 pydantic-core；FastAPI 不可用 |
| 6 | [backend/models.py](backend/models.py) | 9 个 pydantic 模型 | 改 `dataclass`/手写校验函数；路由里 `await request.json()` 后校验 | 同上 |
| 7 | [backend/routers/](backend/routers/) 6 个文件 | FastAPI `APIRouter`/`Query`/`Body`/`HTTPException` | 改 Starlette `Router`/`Route`、`request.query_params`、`JSONResponse`；SSE 用 `StreamingResponse` | 同上 |
| 8 | [frontend/js/app.js](frontend/js/app.js) 218/568/601/613 | 硬编码 `/sdcard/ADM`、`/sdcard` | 改为从 `/api/roots` 取默认根（或 `AC2_ROOT` 注入的接口）；至少加 fallback | app 内 `/sdcard/ADM` 可能不存在 |
| 9 | 新增 `packaging/p4a/main.py` | — | 设 env（`AC2_DATA_DIR`/`AC2_FFMPEG_BIN`/`AC2_PORT`）→ `from backend.cli import main` → `main()` | p4a 的入口约定 |
| 10 | 新增 `packaging/p4a/buildozer.spec` | — | `requirements = python3,starlette,uvicorn,httpx,mutagen,ffmpeg`；`android.api=28`；`android.port=8000`；`source.dir=../..`；`source.exclude_dirs=.git,__pycache__,...` | p4a 构建配置 |
| 11 | 新增 `requirements-app.txt` | — | 锁纯 Python 依赖（starlette/uvicorn/httpx/mutagen + 间接依赖） | 保证 Termux 与 app 一致 |

### P1：能做但会崩/体验差

| # | 位置 | 改法 |
|---|---|---|
| 12 | [backend/routers/fs_api.py](backend/routers/fs_api.py) 12-13、[media_api.py](backend/routers/media_api.py) 14 | `PUBLIC_PREFIXES`/`FORBIDDEN_ROOTS` 改读 `AC2_ROOT`；p4a + targetSdk 28 下可直接 `/sdcard` |
| 13 | [media_api.py](backend/routers/media_api.py) 52-85 | `/api/play`（am）在 app 内不可用；p4a 用 Intent/FileProvider 需要 Java 模板改造；首版可返回 `not_supported`，保留本地播放 |
| 14 | [backend/jobs.py](backend/jobs.py) / SSE | Starlette 的 `StreamingResponse` 写法与 FastAPI 一致；注意 `asyncio.get_event_loop()` 在 p4a 的主线程可能没有 loop → 用 `asyncio.get_running_loop()` 或线程队列轮询 |
| 15 | 权限 | `buildozer.spec` 声明 `READ_EXTERNAL_STORAGE,WRITE_EXTERNAL_STORAGE`；`main.py` 里 `android.permissions.request_permissions`（p4a 的 `android` 模块）；targetSdk 28 仍走旧存储权限模型 |
| 16 | 静态资源 | p4a 的 `--private` 目录会复制 `frontend/`；确认 `FRONTEND_DIR` 解析正确（`__file__` 所在目录） |
| 17 | 端口 | `buildozer.spec` 的 `android.port` 必须与 `main.py` 的 `AC2_PORT` 一致；否则白屏 |
| 18 | 日志 | `uvicorn` 的 logging 输出到 Android logcat（p4a 会重定向 stdout/stderr）；加文件日志到 `AC2_DATA_DIR` |

### P2：功能层，打包跑通后再做

- WebDAV（v2/v3 的 StorageProvider）；
- AIFF→WAV（纯 Python）；
- 波形/AIFF 的 MediaCodec 桥（**如果 ffmpeg CLI 跑通，就不需要 MediaCodec**）；
- 外部播放器 Intent（需要改 p4a 的 Java 模板或 pyjnius）；
- 锁屏/通知。

---

## 2. 启动器与构建骨架

### 2.1 `packaging/p4a/main.py`

```python
import os
from pathlib import Path

def main():
    base = Path(__file__).resolve().parent
    os.environ.setdefault("AC2_DATA_DIR", str(base / "data"))
    os.environ.setdefault("AC2_ROOT", "/sdcard")
    os.environ.setdefault("AC2_PORT", "8000")
    # ffmpeg 路径由 §4 的安装/复制逻辑决定
    os.environ.setdefault("AC2_FFMPEG_BIN", str(base / "bin" / "ffmpeg"))
    (base / "data").mkdir(parents=True, exist_ok=True)

    # 本地存储权限（targetSdk 28 + 旧权限模型）
    try:
        from android.permissions import request_permissions, Permission
        request_permissions([Permission.READ_EXTERNAL_STORAGE,
                             Permission.WRITE_EXTERNAL_STORAGE])
    except Exception:
        pass

    from backend.cli import main as run
    run()

if __name__ == "__main__":
    main()
```

- `base` 在 p4a 里是 app 私有目录（`--private` 解压处），可写；
- `AC2_DATA_DIR` 用 `base/data`，避免写只读的 app 目录；
- 端口与 buildozer.spec 保持一致（见 §2.2）。

### 2.2 `packaging/p4a/buildozer.spec`（关键项）

```ini
[app]
title = Audio-CPM
package.name = ac2
package.domain = com.example
source.dir = ../..
source.include_exts = py,js,css,html,json,md
source.exclude_dirs = .git,__pycache__,ac2_ui_config.json,ac2_presets.json,ac_web.log,ac_web.pid
version = 0.1
requirements = python3,starlette,uvicorn,httpx,mutagen,ffmpeg
orientation = portrait
fullscreen = 1

[android]
api = 28                 # targetSdk，必须 28（exec 豁免）
minapi = 24
port = 8000              # 必须与 main.py 的 AC2_PORT 一致
permissions = READ_EXTERNAL_STORAGE,WRITE_EXTERNAL_STORAGE
```

> `requirements` 里的 `ffmpeg` 是 **recipe 名**（不是 PyPI 包），p4a 会构建 FFmpeg + 产出 `libffmpegbin.so`。它会连带构建 SDL2/SDL3（recipe 的 `depends`），首次构建时间会更长。

### 2.3 构建命令

```bash
# PC / WSL / CI，不在 Termux
pip install buildozer cython
cd packaging/p4a
buildozer android debug          # 首次 30~60 分钟；requirements 不变时增量 5~15 分钟
```

---

## 3. FFmpeg 集成：`libffmpegbin.so` 怎么跑起来

### 3.1 原理

p4a 会把 recipe 的 `built_libraries` 放进 APK 的 `lib/arm64-v8a/`：

```
libffmpegbin.so     ← ffmpeg CLI（ELF 可执行文件，只是名字像库）
libavcodec.so
libavformat.so
libavutil.so
libswresample.so
...
```

- `extractNativeLibs=true`（p4a 模板默认）→ 安装时解压到 `nativeLibraryDir`；
- `libffmpegbin.so` 依赖 `libav*.so`，直接 exec 会找不到库 → 必须设 `LD_LIBRARY_PATH=<nativeLibraryDir>`；
- exec 位置：
  - **targetSdk 28**：可把 `libffmpegbin.so` + `libav*.so` 复制到 `AC2_DATA_DIR/bin`，`chmod 755`，`subprocess` 直接跑（最稳）；
  - 或直接从 `nativeLibraryDir` exec（需验证 SELinux/权限）。

### 3.2 获取 nativeLibraryDir（Python/pyjnius）

```python
from jnius import autoclass
PythonActivity = autoclass("org.kivy.android.PythonActivity")
native_dir = PythonActivity.mActivity.getApplicationInfo().nativeLibraryDir
```

### 3.3 安装函数（首启执行一次）

```python
import os, shutil, stat, subprocess

def install_ffmpeg(native_dir: str, dst_dir: str) -> str:
    os.makedirs(dst_dir, exist_ok=True)
    names = [n for n in os.listdir(native_dir)
             if n == "libffmpegbin.so" or n.startswith("libav")
             or n.startswith("libsw")]
    for n in names:
        dst = os.path.join(dst_dir, n.replace("libffmpegbin.so", "ffmpeg"))
        if not os.path.exists(dst):
            shutil.copy2(os.path.join(native_dir, n), dst)
    exe = os.path.join(dst_dir, "ffmpeg")
    os.chmod(exe, 0o755)
    env = dict(os.environ, LD_LIBRARY_PATH=dst_dir)
    out = subprocess.run([exe, "-version"], capture_output=True, text=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(out.stderr[-500:])
    return exe
```

- 这段代码放在 `main.py` 启动时（或 `ffmpeg.py` 的 `ensure_ffmpeg()`），只跑一次；
- 之后 `AC2_FFMPEG_BIN` 指向 `dst_dir/ffmpeg`，`subprocess` 的 `env` 带 `LD_LIBRARY_PATH`。

### 3.4 `ffprobe` 缺失怎么办

p4a recipe 不产出 ffprobe。三个选项：

| 方案 | 工作量 | 说明 |
|---|---|---|
| **probe 改用 mutagen**（推荐） | 1 天 | 纯 Python，读头/尾；与 v3 的 T4 一致；WebDAV 也能用 |
| 改 recipe 补 `libffprobe.so` | 0.5 天 | 复制 `ffprobe` 到 `lib/libffprobe.so`，本地 overlay recipe；要维护 p4a 补丁 |
| 解析 `ffmpeg -i` 的 stderr | 1~2 天 | 信息不全（tags/streams 解析脆弱），不推荐 |

> 建议：**probe 用 mutagen，ffmpeg 只做转换/波形/标签重写**。这样即使 ffmpeg 集成出问题，元数据/播放/文件管理仍可用。

### 3.5 默认 codecs 验证（构建后必做）

```bash
libffmpegbin.so -hide_banner -codecs | grep -E 'flac|mp3|opus|vorbis|alac|ape|dsd'
```

- 解码大概率齐全（FFmpeg 默认组件）；
- 编码：FLAC/AAC/WAV 内置；MP3 需 `ffpyplayer_codecs`（libshine）；Opus/Vorbis 编码可能缺失；
- 若只需要“转 FLAC”，默认 recipe 够用。

---

## 4. Starlette 迁移范围（打包前必做）

p4a 不能装 pydantic-core（Rust 扩展，无 recipe），FastAPI 依赖 pydantic 2 → **必须迁 Starlette**（或 pydantic 1.x + 旧 FastAPI，但 Python 3.14 不兼容，不选）。

| 现有 | Starlette 对应 |
|---|---|
| `FastAPI()` | `Starlette(routes=[...])` / `Router` |
| `@router.get("/api/x")` | `Route("/api/x", endpoint, methods=["GET"])` |
| `Query(...)` | `request.query_params.get(...)` |
| `Body(...)` / `BaseModel` | `await request.json()` + 手写校验（`backend/validate.py`） |
| `HTTPException(400, "...")` | `HTTPException(status_code=400, detail="...")`（Starlette 自带） |
| `FileResponse` / `StreamingResponse` / `StaticFiles` | 相同（本来就是 Starlette 的） |
| SSE `StreamingResponse` | 相同；注意 `request.is_disconnected()` |
| `app.mount("/", StaticFiles(...))` | 相同 |

工作量：约 20 个端点 + 9 个模型，**1~1.5 天**（含回归）。建议先加 pytest 冒烟（browse/probe/waveform/stream/start），迁移时逐接口对照。

**替代方案**：保留 FastAPI 用于 Termux，app 版用 Starlette 适配层 —— 会分叉两份路由，不推荐。

---

## 5. 权限、存储、端口、静态路径

| 项 | 做法 |
|---|---|
| 存储权限 | `buildozer.spec` 声明 `READ/WRITE_EXTERNAL_STORAGE`；`main.py` 调 `android.permissions.request_permissions`；targetSdk 28 走旧权限模型，Android 13+ 大概率仍可读 `/sdcard`（需真机验证） |
| 可选全盘 | `MANAGE_EXTERNAL_STORAGE` 需要跳设置页，p4a 无现成 UI；targetSdk 28 下通常不需要 |
| 数据目录 | `AC2_DATA_DIR` 指向 `--private` 解压目录下的 `data/`（可写） |
| 静态前端 | `frontend/` 随 `--private` 打包；`FRONTEND_DIR` 基于 `__file__` 解析；不要用绝对 `/sdcard` |
| 端口 | `android.port` 与 `AC2_PORT` 一致；Python 先启动服务，WebViewLoader 轮询 |
| 明文 HTTP | p4a 模板已 `usesCleartextTraffic=true`，本地端口可用 |
| 日志 | stdout/stderr 进 logcat；再加 `AC2_DATA_DIR/ac2.log` 滚动文件 |
| 后台 | p4a 的 PythonActivity 在前台；切后台可能被系统回收；首版不做前台服务（后续可加） |

---

## 6. PoC 顺序（先验证闸门，再迁移代码）

| 步骤 | 内容 | 时间 | 通过标准 |
|---|---|---|---|
| P1 | p4a webview 空壳 + `main.py` 起一个最小 HTTP server | 1 天（含环境） | WebView 显示 “ok”，端口一致 |
| P2 | `requirements=ffmpeg` 构建，检查 APK 里的 `libffmpegbin.so`/`libav*.so` | 0.5 天 | `unzip -l` 能看到 |
| P3 | Python 里 pyjnius 取 nativeLibraryDir → 复制 → chmod → exec `-version` | 0.5 天 | 输出版本号 |
| P4 | exec `-codecs`，确认 FLAC/MP3 等 | 0.5 天 | 目标格式在 |
| P5 | 用 `libffmpegbin.so` 转一首 FLAC + 生成波形 | 0.5 天 | 输出正确 |
| P6 | 权限请求 + 浏览 `/sdcard/Music` | 0.5 天 | 列表/封面正常 |

**P1~P3 是唯一高风险区**（exec + 依赖库 + 权限）。通过后再做 Starlette 迁移和功能层。

---

## 7. 排期（估算）

| 阶段 | 内容 | 天数 |
|---|---|---|
| W1 | P1~P3 PoC（环境 + 空壳 + ffmpeg exec） | 3~4 |
| W1 | env 注入（config/ffmpeg/cli）+ 默认根 | 0.5 |
| W2 | Starlette 迁移 + pytest 冒烟 + 回归 | 1.5~2 |
| W2 | P4~P6（codecs/转换/波形/权限） | 1.5 |
| W3 | 打包脚本/CI/版本/签名/首启安装 | 1~2 |
| W3 | 前端默认根 + roots 接口 + 错误提示 | 0.5 |
| 合计 | | **8~10 天**（不含 WebDAV/AIFF/外部播放器） |

---

## 8. 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| `libffmpegbin.so` 从 nativeLibraryDir/私有目录 exec 失败 | **高** | targetSdk 28 + 复制到私有目录 + chmod；PoC 先验证 |
| 依赖库（libav*.so）找不到 | 高 | `LD_LIBRARY_PATH` 指向复制目录；或用 `patchelf --set-rpath` |
| p4a recipe 的 ffmpeg 默认 codec 不够 | 中 | 加 `ffpyplayer_codecs`（libshine/MP3）；或自定义 recipe |
| ffprobe 缺失 | 中 | probe 改 mutagen（推荐） |
| webview bootstrap 白屏（端口/启动失败） | 中 | 端口两端一致；`main.py` 里 try/except 写日志；先起服务再让 WebView 轮询 |
| Starlette 迁移回归 | 中 | 契约快照 + 现有 jsdom 回归 + pytest |
| 首次构建慢/CI 缓存 | 中 | 固定 p4a 版本 + 缓存 `.buildozer`/SDK/NDK |
| targetSdk 28 的长期兼容性 | 低 | 侧载可用；Android 16 可安装；不追 Play |
| 权限（Android 13+ 旧模型） | 中 | 真机验证；必要时加 MANAGE_EXTERNAL_STORAGE 引导 |

---

## 9. 结论

- **要改**：`config.py`、`ffmpeg.py`、`cli.py`、`app.py`、`models.py`、6 个 router、`frontend/js/app.js`，外加 `packaging/`。
- **不用改**：`jobs_core.py` 的算法、`waveform.py` 的归一化、前端渲染逻辑、WebDAV（后置）。
- **最大不确定性**：`libffmpegbin.so` 的 exec + 依赖库路径；先用 3 天 PoC 验证，再投入 Starlette 迁移。
- **最稳顺序**：env 注入（0.5 天）→ p4a PoC（3 天）→ Starlette（2 天）→ 打包/权限（2 天）→ 功能层。
- **关键前提**：`android.api=28` + `extractNativeLibs=true` + `LD_LIBRARY_PATH` + 复制到可写目录。

---

## 附录：p4a 源码依据（2026-11-15 develop）

- FFmpeg recipe（8.0.1、libffmpegbin.so）：<https://github.com/kivy/python-for-android/blob/develop/pythonforandroid/recipes/ffmpeg/__init__.py>
- Python3 recipe（3.14.2）：<https://github.com/kivy/python-for-android/blob/develop/pythonforandroid/recipes/python3/__init__.py>
- WebView bootstrap（薄壳 + 端口轮询）：<https://github.com/kivy/python-for-android/tree/develop/pythonforandroid/bootstraps/webview>
- WebViewLoader 模板：<https://github.com/kivy/python-for-android/blob/develop/pythonforandroid/bootstraps/webview/build/templates/WebViewLoader.tmpl.java>
- AndroidManifest 模板（targetSdk/权限/cleartext/extractNativeLibs）：<https://github.com/kivy/python-for-android/blob/develop/pythonforandroid/bootstraps/webview/build/templates/AndroidManifest.tmpl.xml>
- ffpyplayer_codecs（libx264/libshine/libvpx）：<https://github.com/kivy/python-for-android/blob/develop/pythonforandroid/recipes/ffpyplayer_codecs/__init__.py>
