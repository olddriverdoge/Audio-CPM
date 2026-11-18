# Audio-CPM · App 打包交接清单（p4a + FFmpeg 转码）

> 面向：后续负责打包的 agent/人。
> 基线：2026-11-15 的 Termux 版（Starlette + mutagen + 本地/WebDAV 双源 + 纯 Python AIFF），功能已人工验收通过。
> 目标：把「文件管理 + 元数据 + 播放 + 波形 + 标签 + 移动/删除 + WebDAV + 转码」打包成离线 APK（p4a webview bootstrap）。

---

## 0. 一句话结论

- 业务代码的**平台差异已清零**：框架、元数据、存储、路径、AIFF、FFmpeg 定位都不再需要 app 分支。
- 剩余工作集中在 **打包壳 + 3 个原生桥 + 权限/打磨**，估 **9~15 人天**（转码执行模型已在 Termux 完成）。
- 最大风险已从「ffmpeg 能不能 exec」变成「MediaCodec 波形覆盖」与「p4a 的 Java 源/AndroidX 集成」。
- 业务侧已冻结：取消/并发/持久化、标签 mutagen、AIFF 纯 Python、ffbin 定位全部完成，打包只做壳与桥。

---

## 1. 当前基线（已完成，不要重写）

| 能力 | 状态 | 位置 |
|---|---|---|
| Starlette 服务（无 pydantic） | ✅ | `backend/app.py`、`backend/routers/*` |
| 配置/路径 env 化 | ✅ | `backend/config.py` |
| 元数据/封面（纯 mutagen，无 ffprobe） | ✅ | `backend/meta.py` |
| 标签写入（mutagen，copy→校验→replace） | ✅ | `backend/jobs_core.edit_tags_file` |
| 本地/WebDAV 存储抽象 + URI | ✅ | `backend/storage/`（`PathRef`、`DavClient`、`HttpRangeFile`） |
| 数据源接口 | ✅ | `/api/roots`、`/api/storage/*` |
| 波形 provider 钩子 | ✅ | `backend/waveform.py`（`native_provider`） |
| AIFF → WAV 纯 Python（播放） | ✅ | `backend/aiff.py`，`/api/stream` 自动切换 |
| FFmpeg 定位/环境 | ✅ | `backend/ffbin.py`（`prepare()`） |
| 转码进度（`-progress pipe:1`） | ✅ | `backend/ffmpeg.execute_ffmpeg_with_progress` |
| 转码取消 / 并发限制 / 任务持久化 | ✅ | `backend/jobs.py`、`/api/task/{id}/cancel`、`DATA_DIR/ac2_tasks.json` |
| 前端（数据源/caps/两页复用） | ✅ | `frontend/` |
| 原生桥接入点（no-op + Android 注册） | ✅ | `backend/native_bridge.py`（`cli.main` 调用 `register()`） |
| 打包工程骨架 | ✅ | `packaging/`（p4a/main.py、buildozer.spec、android/java 骨架、tests） |
| 路径白名单动态化（AC2_ROOT） | ✅ | `backend/config.py` 的 `PUBLIC_PREFIXES`；前端默认根走 `/api/roots` |

**回归脚本**：已迁入 `packaging/tests/`（16 个 jsdom 脚本 + `run.sh`，需服务在 8000；`npm i` 装 jsdom 或自动软链）；`sources_test.mjs` 需本地 wsgidav。

---

## 2. 打包选型与构建

- 壳：**python-for-android（p4a）+ webview bootstrap**（已定）。
- 完全离线（Python/前端/FFmpeg 都进 APK），无首次下载。
- 构建机：PC/WSL/CI（Termux 内不能 buildozer）。

### 2.1 关键 buildozer.spec 项

```ini
[app]
title = Audio-CPM
package.name = ac2
package.domain = com.example
source.dir = ../..
source.include_exts = py,js,css,html,json,md
source.exclude_dirs = .git,__pycache__,cache,ac2_ui_config.json,ac2_storage.json,ac2_presets.json,ac2_web.log,ac_web.pid
version = 0.1
requirements = python3,starlette,uvicorn,httpx,mutagen,ffmpeg
orientation = portrait
fullscreen = 1

[android]
api = 28                      # 侧载 + /sdcard 直读；targetSdk 28
minapi = 24
port = 8000                   # 必须与启动器 AC2_PORT 一致，否则 WebView 白屏
permissions = READ_EXTERNAL_STORAGE,WRITE_EXTERNAL_STORAGE,INTERNET
```

- `requirements` 里的 `ffmpeg` 是 **recipe 名**，产出 `libffmpegbin.so` + `libav*.so`（无 ffprobe，本项目已不需要）。
- 若需要自定义 Java 源：`android.add_src = packaging/android/java`（buildozer 写法；p4a CLI 对应 `--add-java-src`，以实际版本为准）。
- Java 源用 **Java**（不用 Kotlin），避免 p4a 的 Kotlin 编译链；一个 `AudioCpmBridge` 类承载所有桥方法即可。

### 2.2 启动器 `packaging/p4a/main.py`（骨架）

```python
import os
from pathlib import Path

def main():
    base = Path(__file__).resolve().parent
    os.environ.setdefault("AC2_DATA_DIR", str(base / "data"))
    os.environ.setdefault("AC2_ROOT", "/sdcard")
    os.environ.setdefault("AC2_HOST", "127.0.0.1")
    os.environ.setdefault("AC2_PORT", "8000")
    os.environ.setdefault("AC2_ANDROID", "1")
    (base / "data").mkdir(parents=True, exist_ok=True)

    # nativeLibraryDir（FFmpeg 复制源）
    try:
        from jnius import autoclass
        Activity = autoclass("org.kivy.android.PythonActivity")
        native = Activity.mActivity.getApplicationInfo().nativeLibraryDir
        os.environ.setdefault("AC2_NATIVE_LIB_DIR", native)
    except Exception:
        pass

    # 权限（targetSdk 28 旧模型）
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

- `backend.cli.main()` 内部会调用 `ffbin.prepare()`：把 `libffmpegbin.so` 复制成 `DATA_DIR/bin/ffmpeg`、chmod，并设 `LD_LIBRARY_PATH`。
- 端口必须与 `buildozer.spec` 的 `android.port` 一致；Python 启动失败时 WebView 只轮询不提示 → 加文件日志 `DATA_DIR/ac2.log`。

---

## 3. 环境变量契约（业务代码只认这些）

| 变量 | 用途 | Termux 默认 | app 建议 |
|---|---|---|---|
| `AC2_DATA_DIR` | 可写数据目录（配置/缓存/任务） | 项目根 | `filesDir` 或 `--private/data` |
| `AC2_ROOT` | 默认本地根 | `/sdcard/ADM` | `/sdcard` |
| `AC2_HOST` / `AC2_PORT` | 监听地址/端口 | `127.0.0.1` / `8000` | 同 left，端口与 spec 一致 |
| `AC2_FFMPEG_BIN` | ffmpeg 路径 | `ffmpeg`（PATH） | 一般不用设，`ffbin.prepare()` 会覆盖 |
| `AC2_NATIVE_LIB_DIR` | nativeLibraryDir | 无 | 由启动器注入 |
| `AC2_ANDROID` | 标记 Android | 无 | `1` |

数据文件：`ac2_ui_config.json`、`ac2_storage.json`、`ac2_presets.json`、`cache/{covers,wave,aiff}`。

---

## 4. 待办工作项（按优先级）

| ID | 项 | 说明 | 验收 | 人天 | 风险 |
|---|---|---|---|---|---|
| P0-1 | 打包空壳 | 骨架已建（`packaging/`），剩：首次构建/端口验证/启动错误页 | WebView 打开首页、无白屏 | 2~4 | 中 |
| P0-2 | 权限与存储 | targetSdk 28 + 存储权限 + `/sdcard` 浏览 | 能浏览/播放 `/sdcard` | 1~2 | 中 |
| P0-3 | MediaCodec 波形桥 | `AudioCpmBridge.peaks(path,buckets)` → JSON；Python 注册 `waveform.native_provider` | FLAC/MP3/AAC/OGG/OPUS 波形与 Termux ±5% | 2~4 | **高** |
| P0-4 | 标签写入验证 | 已改 mutagen，app 内直接可用 | 写 FLAC/MP3 后其他播放器可见 | 0.5 | 低 |
| P1-1 | 外部播放器 | Java `AudioCpmBridge.open(path,pkg,act)` + FileProvider | 系统播放器能打开 FLAC | 1~2 | 中 |
| P1-2 | AIFF 播放 | 纯 Python 已实现，app 内确认缓存目录可写 | AIFF 16/24 播放 | 0.5 | 低 |
| ~~P1-3~~ | ~~转码执行模型~~ | **已完成**（Termux 侧）：取消/并发/持久化/`.part` 清理 | 见 §5 | 0 | — |
| ~~P1-4~~ | ~~转码 UI~~ | **已完成**：取消按钮 + `cancelled` 事件 + 未完成提示 | 能取消、能看到进度 | 0 | — |
| P2-1 | 通知栏/锁屏 | 原生 MediaSession + 通知（WebView 内不显示） | 锁屏可控 | 2~3 | 中 |
| P2-2 | 后台保活 | FOREGROUND_SERVICE + 通知 | 切后台转码不中断 | 1~2 | 中 |

**最小可用（P0 全 + P1-1/2/3/4）≈ 9~15 人天；完整 ≈ 11~18 人天。**

---

## 5. 转码任务执行模型（已在 Termux 完成，打包侧只需确认）

现状（v4.6）：已实现取消、并发信号量、任务持久化；打包侧只需在真机上复验「取消后进程退出 / `.part` 清理 / 切后台存活」。

1. **取消（已实现）**：`cancel` 事件 + `execute_ffmpeg_with_progress` 轮询 → terminate→kill；`.ac2tmp` 清理；SSE `cancelled`；状态 `cancelled`。
2. **并发限制（已实现）**：`AC2_TASK_CONCURRENCY`（默认 1），超出排队。
3. **持久化（已实现）**：`DATA_DIR/ac2_tasks.json`；启动 `load_tasks()` 把 running/queued 标 `interrupted`。
4. **输出与清理（部分已实现）**：输出 `.ac2tmp` → `os.replace`、失败清理；默认输出目录仍沿用「源目录或用户指定」，如需独立 `transcode/` 目录可在打包阶段调整。
5. **错误码**：`415 unsupported_codec`、`507 storage_full`、`499 cancelled`。
6. **后台（未做，首版可接受）**：转码时保持前台；切后台可能被系统杀，若要保活再加 P2-2 前台服务。

**进度**：`-progress pipe:1 -nostats`，解析 `out_time_ms`/`out_time_us`，不要解析 stderr 的 `time=`。

---

## 6. 原生桥规范（Java，p4a）

包名建议 `com.example.ac2`，一个类 `AudioCpmBridge`：

```java
public class AudioCpmBridge {
    // 波形：返回 {"ok":true,"peaks":[...]} 或 {"ok":false,"error":"..."}
    public static String peaks(String path, int buckets) { ... }

    // 外部播放器：返回 {"ok":true} / {"ok":false,"error":"..."}
    public static String open(String path, String pkg, String activity) { ... }

    // 权限：是否有"所有文件访问"（targetSdk 34+ 才需要）
    public static boolean hasAllFiles() { ... }
    public static void openAllFilesSettings() { ... }
}
```

- 波形实现：`MediaExtractor` + `MediaCodec` 同步循环；按 `presentationTimeUs / durationUs * buckets` 归桶，取绝对峰值（0~1，未归一化）；处理 `KEY_PCM_ENCODING`（16bit/float/24bit packed）。
- Python 注册（启动器或 `cli.main` 里，仅 Android）：
  ```python
  from jnius import autoclass
  from backend import waveform
  _B = autoclass('com.example.ac2.AudioCpmBridge')
  waveform.native_provider = lambda path, buckets: json.loads(_B.peaks(path, buckets))['peaks']
  ```
- 外部播放器需要 FileProvider：AndroidX 依赖可 `android.gradle_dependencies = androidx.core:core:1.12.0`；若加依赖困难，可用自定义 `ContentProvider`（约 40 行）替代 AndroidX。
- 桥方法内部必须捕获全部异常并返回 JSON，别让 JNI 抛到 Python。

---

## 7. PoC 六步（功能开发前，真机）

| 步骤 | 验证 | 失败意味着 |
|---|---|---|
| 1 | `ffmpeg -version` 在 app 内 exec 成功 | P3 高风险点，回退 FFmpegKit AAR |
| 2 | `ffmpeg -encoders \| grep -E 'mp3\|flac\|aac\|opus\|vorbis'` 含目标编码器 | 补 recipe 或砍目标格式 |
| 3 | `ffmpeg -i in.flac -c:a libmp3lame out.mp3` 成功 | 编码器链接问题 |
| 4 | `-progress pipe:1` 能读到进度 | 任务模型要改 |
| 5 | 取消后进程退出、`.part` 清理 | 取消逻辑要补 |
| 6 | 切后台 30 秒任务是否存活 | 决定是否首版做前台服务 |

> 参考：桌面/当前环境的 `ffmpeg -encoders` 已确认含 `aac/flac/libmp3lame/opus/libopus/vorbis/libvorbis`。真机仍需复验 p4a 构建产物。首版转码目标建议 **WAV/FLAC/MP3/AAC**。

---

## 8. 验收清单（app 首版）

1. 首启授权 → 浏览 `/sdcard`，列表/网格/列配置正常
2. 元数据面板（标题/艺术家/采样率/位深/时长/封面）正确
3. 播放 FLAC/WAV/MP3/M4A/OGG/OPUS，拖动进度正常
4. AIFF 16/24 播放（转 WAV）
5. 波形：本地 FLAC/MP3/WAV 与 Termux 版 ±5%；WebDAV 无波形（501）
6. 标签编辑 FLAC/MP3 成功，其他播放器可见
7. 移动/重命名/删除/新建目录（本地-本地、远端-远端）；跨源拒绝
8. WebDAV：浏览/播放/元数据/封面；远端内部 MOVE/DELETE/MKCOL
9. 转码：FLAC→WAV/MP3/AAC 可跑、进度可见、可取消、`.part` 清理
10. 切后台/回前台播放不崩；频谱浮窗正常
11. 重启 app：配置/源/目标标签/播放位置保留

---

## 9. 风险与回退

| 风险 | 等级 | 回退 |
|---|---|---|
| MediaCodec 波形对 FLAC 24bit/OGG/OPUS 覆盖不足 | 高 | 真机先验证；失败提示"该格式波形不可用"；必要时 ffmpeg-kit-audio 仅波形（+30MB） |
| p4a Java 源/AndroidX 集成 | 中 | 自定义 ContentProvider 替代 FileProvider |
| WebView 内 `<audio>` 后台/锁屏行为 | 中 | 首版接受限制；P2 原生 MediaSession |
| targetSdk 28 长期兼容 | 低 | 侧载可用；不追 Play |
| 存储权限（Android 13+） | 中 | 真机验证；必要时 MANAGE_EXTERNAL_STORAGE 引导 |
| LGPL（libmp3lame/libopus/libvorbis） | 低（个人侧载） | 分发时提供合规说明；不引入 GPL 组件（x264 等） |

---

## 10. 约定与坑（给打包 agent）

1. **Starlette 同步 IO 必须线程池**：httpx/subprocess/大文件不得在 `async` 端点直接跑，否则卡死整个服务（已踩过）。
2. 不要重新引入 ffprobe；元数据/封面/标签全部走 mutagen。
3. 标签写入只保留 mutagen 一条路径，不要加 ffmpeg 分支。
4. 播放**不依赖 FFmpeg**：AIFF 用 `backend/aiff.py` 转 WAV；FFmpeg 只负责转码/波形/（可选）缩略图缩放。
5. WebDAV 的 Range 头必须标准（`Content-Range`/`Content-Length`/`Accept-Ranges`）；httpx 客户端已有连接池与超时。
6. 端口两端一致（spec 的 `android.port` ↔ `AC2_PORT`），否则 WebView 白屏。
7. 静态前端 `FRONTEND_DIR` 基于 `__file__` 解析，随 `--private` 打包。
8. 日志：stdout/stderr 进 logcat；再加 `DATA_DIR/ac2.log`。
9. 首启初始化：`ac2_storage.json` 默认 `{"sources":{"local":{...}}}`（`backend/storage.load_sources` 会自动补）。
10. 回归脚本跑在 app 内服务上（同端口），断言不改。

---

## 11. 相关文档

- [OFFLINE_APP_PLAN_V3.md](OFFLINE_APP_PLAN_V3.md)：业务层方案（波形/AIFF/元数据/WebDAV）
- [P4A_MIGRATION_PLAN.md](P4A_MIGRATION_PLAN.md)：p4a 事实核查与 FFmpeg 集成
- [PACKAGING_OPTIONS_WEBTOAPP_P4A.md](PACKAGING_OPTIONS_WEBTOAPP_P4A.md)：壳选型对比
- [HANDOVER.md](HANDOVER.md)：当前代码结构与接口契约
