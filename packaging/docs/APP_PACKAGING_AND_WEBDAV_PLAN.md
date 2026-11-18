# Audio-CPM：封装 App 与 WebDAV 演进方案

> **状态说明（2026-11-15 修订）**：本文的“独立 APK”方案假设“FFmpeg 必须进 app”。按最新决策（离线独立 + 砍掉转换 + 本地/WebDAV 双栈），已改为“app 首版不带 FFmpeg”，最新方案见 [OFFLINE_APP_PLAN_V2.md](OFFLINE_APP_PLAN_V2.md)。本文保留：技术架构体检、Android exec/ABI 限制、ffmpeg-kit 桥接、CI 打包流程，作为“以后要恢复转换功能”的备选参考。

> 本文是一次完整的架构体检 + 落地方案，回答三个问题：
> 1. 当前技术架构是什么、有哪些隐含假设；
> 2. 怎么封装成 app，FFmpeg 这个难点怎么破，后续怎么快速迭代打包；
> 3. 接入 WebDAV 会不会引入新的技术难点。
>
> 结论先行：**FFmpeg 的难点不在“调用”，在 Android 的可执行文件限制；WebDAV 的难点不在“协议”，在网络存储的缓存与一致性。** 两者都有成熟解法，且 WebDAV 会顺带消掉 Android 打包里最烦的存储权限问题。
>
> 文档日期：2026-11-15；基于项目当前 v3.22 代码与本机实测环境（附录 A）。

---

## 0. 一分钟结论

| 问题 | 结论 |
|---|---|
| 现在能直接打成独立 APK 吗 | 不能。代码是“本地路径 + 系统 ffmpeg 可执行文件”的假设，Android app（targetSdk 29+）不允许执行可写目录里的二进制，ffmpeg 必须换形态 |
| FFmpeg 在 app 里怎么跑 | 用 `ffmpeg-kit` 的社区维护分支（`dev.ffmpegkit-maintained:ffmpeg-kit-audio:8.1.7`，JNI 库，不是可执行文件），Kotlin 桥接后从 Python 调用；算法层 `jobs_core.py` 基本不改 |
| Python 怎么进 APK | Chaquopy（把 CPython 解释器打进 APK，已完全免费开源）。但 FastAPI + pydantic 2 在 Chaquopy 里装不上（pydantic-core 没有 Android wheel），app 版需要把路由层迁到 Starlette |
| 怎么快速打包 | 业务代码不复制进 Android 工程，Gradle 直接引用仓库目录；日常在 Termux 跑，发版 `git tag` 触发 GitHub Actions 出 APK；一次配置，之后每次 3~6 分钟 |
| WebDAV 会不会很难 | 协议本身不难（HTTP + PROPFIND/GET Range/PUT/MOVE/DELETE，`httpx` 纯 Python 可搞定）。真难点是：首屏性能（N+1 下载）、写回一致性（ETag/If-Match）、播放 Range 代理、系统播放器降级 |
| 建议路线 | 先 **PWA + Termux**（半天，立刻有 app 体验）→ 做 **Storage 抽象**（本地行为不变）→ **WebDAV**（只读→写回）→ 有明确离线/独立需求再上 **Chaquopy APK**。如果后端以后放 NAS/PC，手机端只做壳，FFmpeg 打包问题直接消失 |

---

## 1. 现状：技术架构与运行链路

### 1.1 形态

```
浏览器 / WebView
   │  HTTP + SSE（同源，默认 127.0.0.1:8000）
   ▼
uvicorn ── FastAPI app（单进程，单用户，无鉴权）
   ├─ routers/*        浏览 / 媒体 / 文件操作 / 任务 / 配置，约 20 个端点 + SSE
   ├─ jobs.py          进程内 tasks 字典 + Queue + 后台线程
   ├─ jobs_core.py     ffmpeg 命令行算法：转换 / 整理标签 / 替换封面 / 检查 / 编辑标签
   ├─ ffmpeg.py        subprocess 调系统 ffmpeg / ffprobe、进度解析、递归收集
   ├─ waveform.py      ffmpeg 解码 4kHz PCM → 峰值包络（磁盘+内存缓存）
   └─ StaticFiles      frontend/（零构建：index.html + 6 CSS + 19 JS）
```

- 入口 [ac_web.py](../../ac_web.py)（12 行）→ [backend/cli.py](../../backend/cli.py) → uvicorn。
- 前端经典脚本按序加载、IIFE 命名空间、无打包器；所有请求走相对路径 `/api/*`（[frontend/js/api.js](../../frontend/js/api.js)），同源部署。
- 配置持久化：`ac2_presets.json`、`ac2_ui_config.json` 写在项目根；封面/缩略图/波形缓存在 `$TMPDIR`（[backend/config.py](../../backend/config.py)、[backend/waveform.py](../../backend/waveform.py)）。
- 部署：`run.sh` 用 setsid + nohup 常驻，PID/日志在项目根。

### 1.2 四条主要链路

| 链路 | 路径 | 关键实现 |
|---|---|---|
| 浏览 | 前端 `browse()` → `GET /api/browse?path=` → `os.listdir` + 逐项 `stat` | 目录/媒体/图片分类，目录封面取第一个图片 |
| 元数据/缩略图 | `/api/probe_file`、`/api/cover`、`/api/thumb`、`/api/waveform` | 全部以本地文件路径调 ffprobe/ffmpeg；按 `path+mtime(+size)` 做缓存 key |
| 播放 | `<audio src="/api/stream?path=...">` | `FileResponse` 原生支持 Range（206）；另有一条 `am start file://` 拉起系统播放器 |
| 任务 | `POST /api/start` → 线程 → `GET /api/task/{id}/stream`（SSE） | 每文件 ffmpeg 到临时文件 → `os.replace` 原子替换 → `delete_source` |

### 1.3 代码地图（规模 6198 行）

| 层 | 文件 | 行数 | 角色 |
|---|---|---|---|
| 入口 | [ac_web.py](../../ac_web.py)、[backend/cli.py](../../backend/cli.py)、[backend/app.py](../../backend/app.py) | 61 | 启动/装配/静态挂载 |
| 配置 | [backend/config.py](../../backend/config.py) | 21 | 根目录、扩展名、缓存目录 |
| FFmpeg | [backend/ffmpeg.py](../../backend/ffmpeg.py) | 163 | `execute`、`probe_file_detail`、进度解析、递归收集 |
| 任务 | [backend/jobs_core.py](../../backend/jobs_core.py) | 283 | 4 类批量任务 + 单文件标签编辑 |
| 调度 | [backend/jobs.py](../../backend/jobs.py) | 40 | tasks 字典 + 线程 + Queue |
| 波形 | [backend/waveform.py](../../backend/waveform.py) | 88 | 解码 + 分桶 + 双缓存 |
| 路由 | [backend/routers/](../../backend/routers/) 6 个文件 | 626 | browse / fs / media / tags / tasks / ui |
| 前端 | [frontend/](../../frontend/)（index.html 382 + JS 约 3.4k + CSS 约 0.5k） | 4300 | 两页单页应用，19 个 IIFE 模块 |

### 1.4 当前架构的 8 个隐含假设（后续改造的根因）

| # | 假设 | 代码位置 | Android 打包时 | WebDAV 时 |
|---|---|---|---|---|
| 1 | `path` 是本地绝对路径，直接 `os.*`/ffmpeg | 全后端 + 前端 localStorage | 除 `/sdcard` 外可用 | **失效**，需 URI/后端标识 |
| 2 | 文件系统低延迟，可随时 `stat`/`rename`/`remove` | browse / fs / jobs_core | 可用 | 需远端 API + 本地物化 |
| 3 | 系统 PATH 里有 `ffmpeg`/`ffprobe` 可执行文件 | [backend/ffmpeg.py](../../backend/ffmpeg.py) | **不可 exec**（见 §2.2） | 可用（本地缓存文件） |
| 4 | 只操作 `/sdcard`、`/storage/emulated/0` 白名单 | [fs_api.py](../../backend/routers/fs_api.py)、[media_api.py](../../backend/routers/media_api.py) | 需运行时权限/SAF | 改为“远端根内”约束 |
| 5 | 系统播放器 = `am start -d file://...` | [media_api.py](../../backend/routers/media_api.py) | **无 am 命令**，且 file:// 被禁 | **无本地文件** |
| 6 | 项目根目录可写（预设/UI 配置） | [config.py](../../backend/config.py)、[ui_api.py](../../backend/routers/) | APK 内只读，**启动即失败** | 同左 |
| 7 | 单用户、无鉴权、只绑 127.0.0.1 | 全后端 | 需随机 token（WebView 同源仍可） | 需 token + WebDAV 凭据 |
| 8 | 默认根硬编码 `/sdcard/ADM` | [frontend/js/app.js](../../frontend/js/app.js)（218/568/601/613 行） | 目录不存在 | 无意义 |

> 这 8 条就是“打包”和“WebDAV”两件事的共同改造清单。**建议先改 6、8、3 的抽象，再动 1**，否则两件事会互相踩。

---

## 2. 封装成 App

### 2.1 五条路线对比

| 路线 | 形态 | 依赖 | FFmpeg | 构建在哪 | 体积 | 首次工作量 | 适合 |
|---|---|---|---|---|---|---|---|
| **A. PWA** | 浏览器“添加到主屏”，独立窗口 | Termux 服务常驻 | 复用 Termux 的 ffmpeg | 不需要构建 | 0 | 0.5 天 | 先要“像 app”的体验 |
| **B. WebView 壳** | 独立 APK，加载本地/远端服务 | Termux 或服务器 | 同 A | PC / CI | 3~5 MB | 1~2 天 | 要图标、全屏、返回键 |
| **C. Chaquopy 内嵌** | 真独立 APK，Python 在 app 内跑 | 无外部依赖 | `ffmpeg-kit` JNI 库 | PC / CI | 60~90 MB | 3~6 天 | 离线、单机、长期形态 |
| **D. 桌面版** | Windows/macOS/Linux 可执行 | 无 | 随包 ffmpeg | PC / CI | 60~120 MB | 1~2 天 | 有 PC 使用场景 |
| **E. 服务端 + 轻客户端** | NAS/PC 上 Docker，手机 PWA/壳 | 服务器 | 容器内 ffmpeg | Docker | — | 1~2 天 | 多设备、音乐库在 NAS |

**推荐演进**：A（立刻）→ 存储抽象 → E 或 C（按是否需要离线独立决定）→ D（可选）。
如果音乐库最终在 NAS 上，E 是运维成本最低的形态，且与 WebDAV 天然契合；如果坚持“手机单机、不依赖 Termux”，走 C。

### 2.2 为什么 FFmpeg 是 Android 封装的核心难点

不是“Python 调不动 ffmpeg”，而是三层限制叠加：

1. **Android 10（API 29）起，应用不能执行自己可写数据目录里的文件**（W^X 策略，官方行为变更 “Execution of files in app home directory”）。`execve` 直接 `EACCES`。
2. 当前 Termux 之所以能跑 `ffmpeg`，是因为 Termux APK 的 `targetSdk=28`（本机实测 `TERMUX_APP__TARGET_SDK=28`），享受旧 targetSdk 豁免；新 app 用 targetSdk 35/36，没有这个豁免。
3. 新 app 只有两个合法位置能执行原生代码：
   - **nativeLibraryDir**（`/data/app/.../lib/arm64`，APK 安装时解压的只读目录）——可以把静态 ffmpeg 命名成 `libffmpeg.so` 放 `jniLibs`，再 `ProcessBuilder` 执行；需要 `extractNativeLibs=true`、16 KB 页对齐、只含 arm64、真机验证 SELinux；
   - **JNI 库**（把 libav* 作为共享库加载）——这正是 ffmpeg-kit 的做法，最稳，不需要 exec。

**结论：不要在 app 里“带一个 ffmpeg 可执行文件”。** 用 JNI 库。

### 2.3 路线 C 落地设计（Chaquopy + WebView + ffmpeg-kit）

#### 2.3.1 组件关系

```
Android Activity / Service（Kotlin）
 ├─ WebView  ──加载── http://127.0.0.1:<随机端口>
 ├─ Python 线程（Chaquopy）── uvicorn + Starlette 应用
 │     ├─ backend/routers/*（业务代码原样）
 │     ├─ backend/jobs_core.py（算法原样，路径仍是本地路径）
 │     └─ backend/ffmpeg.py（替换底层实现）
 └─ Ac2Ffmpeg.kt（Java 桥）
       └─ FFmpegKit / FFprobeKit（ffmpeg-kit-audio:8.1.7，libav* 静态库）
```

关键点：**算法层与 FFmpeg 调用方式解耦**。`jobs_core.py` 只依赖 `execute()`、`probe_file_detail()`、`execute_ffmpeg_with_progress()` 三个函数，把这三个函数做成可插拔后端即可：

```
backend/ffmpeg.py
 ├─ LocalRunner      subprocess（Termux / 服务端 / 桌面）
 └─ AndroidRunner    jclass('...Ac2Ffmpeg') → FFmpegKit（进度用 Statistics 回调）
```

#### 2.3.2 FFmpeg 桥的具体做法

依赖（Maven Central，社区维护分支）：

```gradle
// ffmpeg-kit 上游 2025-04 归档、制品从 Maven Central 下架；
// 这是兼容分支，同包名/同 API，只是 groupId 变了
implementation("dev.ffmpegkit-maintained:ffmpeg-kit-audio:8.1.7")
```

- `-audio` 变体 = 裸 FFmpeg + lame/opus/libvorbis/speex/opencore-amr/soxr/twolame 等，LGPL-3.0，arm64-v8a + x86_64，minSdk 24，targetSdk 35，**16 KB 页对齐**（Google Play 2025-11 起强制）。纯音频项目用它比 `-full` 小很多。
- 解码 DSD/APE/WV/ALAC 是 FFmpeg 内置能力，不依赖额外库；编码侧 mp3/flac/aac/opus/alac/wav 都覆盖（建议真机跑一次 `-codecs` 核对）。
- 如果将来想让 ffmpeg 直接读 https URL，需要 `-https`/`-full` 变体；但本项目 WebDAV 走“先物化再处理”，不需要。

桥接接口（Kotlin，约 150 行）：

```kotlin
object Ac2Ffmpeg {
    // 同步执行；返回 {code, output}，Python 侧 json.loads
    @JvmStatic fun run(args: Array<String>, timeoutMs: Long): String
    // 异步 + 轮询进度，避免 JNI 回调跨语言
    @JvmStatic fun start(args: Array<String>): String   // 返回 sessionId
    @JvmStatic fun poll(sessionId: String): String       // {running,pct,output}
    // ffprobe JSON 输出
    @JvmStatic fun probe(path: String): String
}
```

Python 侧适配（`backend/ffmpeg_android.py`）：

```python
from java import jclass
_B = jclass('com.ac2.app.Ac2Ffmpeg')

def execute(cmd, timeout=None):
    raw = _B.run(cmd, (timeout or 0) * 1000)
    d = json.loads(raw)
    return d['code'] == 0, d['output']
```

注意事项：
- `ffmpeg-kit` 的进度走 `StatisticsCallback`，命令行里已有的 `-progress pipe:1`、`-nostats` 要剥掉，否则输出会混。
- `probe_file_detail()` 用 `FFprobeKit` 执行同样的 `-print_format json -show_streams -show_format` 参数，解析逻辑不变。
- `-hwaccel mediacodec` 是视频硬解，音频项目可去掉（`check_hwaccel_support` 在 app 里恒 False 即可）。
- ffmpeg-kit 的日志回调拿到的是 ffmpeg 的 stderr，与现有错误信息格式兼容。
- **不要**在 Python 里用 `subprocess` 调 ffmpeg 二进制（见 §2.2）；Chaquopy 的 Python 是 app 进程内嵌，不保证能 fork/exec 成功。

#### 2.3.3 依赖适配（隐藏坑，必须提前知道）

Chaquopy 17 起 pip 只装 binary wheel，而 **pydantic-core 没有 Android wheel**（社区 issue #1326 也是自己在改 jiter 构建），所以：

| 依赖 | Termux/服务端 | Chaquopy app | 处理 |
|---|---|---|---|
| fastapi 0.162 | ✓ | ✗（依赖 pydantic 2） | app 版改用 Starlette |
| pydantic 2.14 | ✓ | ✗ | 手写校验 / dataclass |
| pydantic 1.x + Py3.11 | 可跑 | 不推荐（16 KB 设备要求 Python 3.13+） | 不采用 |
| uvicorn 0.54 | ✓ | ✓（纯 Python，别装 `[standard]`） | 直接可用 |
| starlette 1.10 | ✓ | ✓ 纯 Python | app 版路由框架 |
| httpx | — | ✓ 纯 Python | WebDAV 客户端 |
| pillow | 不用 | — | — |

Starlette 迁移工作量：路由声明、请求体解析、HTTPException、SSE、StaticFiles 都有对应物，现有约 20 个端点的请求体都很简单（[models.py](../../backend/models.py) 只有 45 行），**0.5~1 天**可以迁完并保持接口形状。**建议：app 版与 Termux 版共用同一套路由函数，用一个 `webapp` 兼容层屏蔽 FastAPI/Starlette 差异**，避免维护两份。

> 另一个做法是给 pydantic-core 自建 Android wheel（Chaquopy 支持本地 wheel）。不建议：Rust 交叉编译 + 16 KB 对齐 + 升级维护，成本远高于 Starlette 化。

#### 2.3.4 Android 适配清单

| 项 | 现状 | app 内改法 |
|---|---|---|
| 可写目录 | `SCRIPT_DIR` 写预设/配置 | 读 `os.environ["HOME"]`（Chaquopy 指向 `filesDir`）或壳注入 `AC2_DATA_DIR`；[config.py](../../backend/config.py) 改一处 |
| 临时文件 | `tempfile.gettempdir()` | 显式设到 `cacheDir`，避免 Android 上不可写 |
| 默认根 | `/sdcard/ADM` | 新增 `GET /api/roots`：内部目录 +（可选）SAF 导入目录 + WebDAV 绑定；前端删掉硬编码 |
| 存储权限 | Termux 已授权 | Android 13+ 需 `READ_MEDIA_AUDIO`；全盘要 `MANAGE_EXTERNAL_STORAGE`（侧载可用，Play 敏感）。**首版建议只做内部目录 + WebDAV，绕开权限** |
| 系统播放器 | `am start file://` | app 内没有 `am`；用 Intent + FileProvider（Android 7+ 禁 file://），或直接隐藏该模式 |
| WebView | — | `setJavaScriptEnabled`、`setDomStorageEnabled`、`setMediaPlaybackRequiresUserGesture(false)`、`setAllowFileAccess(false)`；明文放行 127.0.0.1（network-security-config） |
| 全屏/旋转 | 前端 `requestFullscreen` + orientation.lock | WebView 需实现 `WebChromeClient.onShowCustomView/onHideCustomView`，否则 ⛶/⟳ 失效 |
| 后台 | 浏览器标签页常驻 | 前台服务（`mediaPlayback` 类型）+ 通知，防进程被杀；WebView 后台 JS 会被节流，进度条/频谱可能停顿 |
| 通知栏媒体控制 | 浏览器 MediaSession | WebView 一般不显示媒体通知，需要原生 MediaSession 同步（额外工作量，可后置） |
| 返回键 | 浏览器 | 拦截 `OnBackPressed`：页面内导航优先，根页面再退出 |
| 日志 | stdout/nohup | `sys.stdout` 自动进 logcat（tag `python.stdout`）；再写一份滚动文件到 `filesDir` |

#### 2.3.5 体积与性能预期

- APK：Python 3.14 (~25 MB) + ffmpeg-kit-audio arm64 (~25-35 MB) + 代码/前端 (~2 MB)，**约 60~90 MB**。只打 arm64-v8a（本机 abilist 只有 arm64），不包含 x86_64 模拟器 ABI 可再省 ~30 MB。
- 启动：Python 解释器初始化 + uvicorn 启动，冷启动约 1~2 秒（Chaquopy 支持 .pyc 预编译，建议开启）。
- 任务速度：纯音频转码主要吃单核 CPU，与 Termux 版接近；ffmpeg-kit 为静态链接，NEON 优化完整。

### 2.4 路线 A：PWA + Termux（最快落地，建议先做）

- 工作量：**半天**。新增 `frontend/manifest.webmanifest` + 图标（192/512，maskable）+ `theme-color` + `display: standalone` + 可选 service worker（只缓存壳，`/api/*` 一律走网络）。
- 在 `http://127.0.0.1:8000` 上 Chrome 可直接“添加到主屏”（localhost 属于 secure context，不需要 HTTPS）。打开后无地址栏、独立任务卡。
- 优点：零构建、零 FFmpeg 改造、马上验证“是否真的需要独立 app”。
- 缺点：依赖 Termux 常驻；系统清后台/重启后要手动 `run.sh start`；没有通知栏媒体控制。
- 建议同时加：`run.sh` 开机自启（Termux:Boot）、`termux-wake-lock`、电池优化白名单说明。

### 2.5 路线 B：WebView 壳（有图标、仍依赖 Termux/服务端）

- 一个 Activity + WebView（30~80 行 Kotlin），加载 `http://127.0.0.1:8000` 或局域网服务器地址；处理返回键、全屏、下载、外链。
- 体积 3~5 MB，构建 1 分钟；需要 PC/CI。
- 价值：图标、全屏、独立窗口、可预置服务器地址；适合“后端跑在 NAS/Termux，手机只当客户端”。
- 与 PWA 的区别：PWA 不需要 APK 分发，壳可以打包进内网分发/应用商店（侧载）。

### 2.6 路线 D：桌面版（可选）

- PyInstaller（onedir 模式，避开 onefile 解压慢）或 Nuitka；把 `ffmpeg`/`ffprobe` 作为 `--add-binary` 随包，运行时用 `sys._MEIPASS` 拼路径。
- 前端继续用系统浏览器打开 `127.0.0.1`（最省事），或用 pywebview 套一层。
- macOS 需要签名 + 公证；Windows 建议静态编译 ffmpeg 免 VC 运行库；Linux 用 AppImage。
- 这条路线对“手机 app”没有帮助，但如果要在 PC 上批量处理音乐库，是成本最低的形态。

### 2.7 路线 E：服务端 + 轻客户端（与 WebDAV 最契合）

- Docker 镜像：`python:3.14-slim` + `apt install ffmpeg`（或静态 ffmpeg）+ 本项目；挂载 `/music`、`/config`。
- 手机端用 PWA 或 WebView 壳访问 `http://nas:8000`；加 `AC2_TOKEN` 鉴权 + 反代 HTTPS。
- 音乐库来自 WebDAV 或本地挂载（NFS/SMB 由宿主机挂载成路径，对 app 透明）。
- 这是“长期最省心”的形态：FFmpeg 打包问题不存在、升级只需重启容器、多设备共享。

---

## 3. 快速打包与持续迭代

### 3.1 先接受一个事实：Termux 上打不了 APK

- Android 构建需要 JDK + Android SDK + Gradle + `aapt2`/`d8`；本机实测没有 `java`/`gradle`，Termux 也没有可用的 Android SDK。
- 官方 `aapt2` 只有 x86_64 Linux/macOS/Windows 构建，arm64 Termux 无法直接运行（即使装 openjdk，也卡在 aapt2）。
- **结论：构建放在 PC 或 GitHub Actions。** 日常开发仍在 Termux（`python3 ac_web.py`），只是“发版构建”换地方。

### 3.2 工程布局：业务代码与壳分离（一次配置，长期受益）

```
audio_manager/                 # 业务仓库（保持现状，Termux 可直接跑）
  backend/  frontend/  ac_web.py  ...
  shell/android/               # Android 壳（新仓库或子目录）
    app/src/main/java/...      # MainActivity, Ac2Ffmpeg.kt
    app/build.gradle.kts
    settings.gradle.kts
    # 关键：不复制业务代码，直接引用
```

Gradle 里用 sourceSets/同步任务把业务代码映射进 APK：

```kotlin
android {
  sourceSets["main"].assets.srcDirs("../../frontend")   // 前端原样进 assets
}
chaquopy {
  defaultConfig {
    version = "3.14"
    pip { install("-r", "../../requirements-app.txt") }
  }
  sourceSets { getByName("main") { srcDir("../../backend") } }  // Python 原样进 APK
}
```

- 业务代码改动 → 只重跑 Gradle（增量 1~2 分钟，CI 3~6 分钟），不碰 Android 工程。
- 前端资源如果放 assets，改前端也要重打包；如果希望前端热更，见 §3.4。
- **不要**把 `backend/` 复制到 `shell/android/app/src/main/python`——两份代码必然分叉。

### 3.3 CI（GitHub Actions 草稿）

```yaml
name: build-apk
on:
  push:
    tags: ['v*']
  workflow_dispatch:
jobs:
  apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '17' }
      - uses: actions/setup-python@v5
        with: { python-version: '3.14' }        # 必须与 chaquopy.version 一致
      - uses: gradle/actions/setup-gradle@v4
      - name: Build
        working-directory: shell/android
        run: ./gradlew :app:assembleDebug --no-daemon -PversionName=${{ github.ref_name }}
      - uses: actions/upload-artifact@v4
        with:
          name: ac2-apk
          path: shell/android/app/build/outputs/apk/debug/*.apk
```

- 首次构建 8~12 分钟（下载 Gradle/依赖），之后有缓存 3~6 分钟。
- debug 签名固定（CI 缓存/仓库 secrets 里放 keystore），可直接覆盖安装、保留 app 数据；正式分发再上 release 签名。
- 版本号：`versionName` 用 tag，`versionCode` 用 `github.run_number`。
- 桌面包用 matrix（windows/macos/ubuntu）+ PyInstaller；Docker 用 `docker buildx` 推镜像。

### 3.4 版本、签名、热更新边界

| 事项 | 建议 |
|---|---|
| 版本号 | `versionName = git describe`，`versionCode` 单调递增；`/api/version` 返回后端/前端版本，前端启动时校验 |
| 配置迁移 | `ac2_ui_config.json`/预设加 `schema_version`，升级时跑迁移函数；app 升级不丢数据 |
| 前端热更 | 可选：`frontend/` 打包 zip + 签名，app 启动时从服务器拉取到 `filesDir` 并校验；WebView 指向本地服务，服务从可写目录读前端。**收益大、风险中**，自用侧载可接受 |
| Python 热更 | 不建议默认开启。侧载场景可以（下载 zip 解压 + `sys.path.insert` + 哈希校验），但一旦 API 不兼容会白屏；上架应用商店则不允许动态下发可执行代码 |
| 签名 | 自用固定一个 keystore，永久保存；换签名 = 必须卸载重装（数据丢失） |
| 分发 | 自用：GitHub Release/网盘传 APK；内网：直接安装；不要依赖 Play（政策/审核） |

### 3.5 打包前必过的检查（脚本化，一条命令）

1. `python3 -m py_compile ac_web.py backend/*.py backend/routers/*.py`（现有约定）。
2. 后端冒烟：`/`、`/api/browse`、`/api/presets` 返回 200。
3. 前端回归：`smoke2.mjs` 等 8 套 jsdom 脚本（现有资产）。
4. 算法回归：用 `ffmpeg -f lavfi -i sine` 生成 1 秒测试音频，跑 convert/tags/cover/check 四个任务，断言输出文件与标签。
5. 版本一致性：`/api/version` == tag；配置 schema 版本可迁移。
6. app 冒烟：安装 → 启动 → 浏览内部目录 → 播放 → 跑一次转换 → 杀进程重开（数据仍在）。

---

## 4. WebDAV 改造：影响面与真难点

### 4.1 今天代码对“本地文件”的依赖清单

| 模块 | 依赖 | 行数 |
|---|---|---|
| [browse_api.py](../../backend/routers/browse_api.py) | `os.listdir`/`stat`/`isfile` | 64 |
| [fs_api.py](../../backend/routers/fs_api.py) | `shutil.move`/`os.mkdir`/`os.rmdir`/`os.rename`/`rmtree` | 193 |
| [media_api.py](../../backend/routers/media_api.py) | `FileResponse`、ffmpeg 提取、`os.path.getmtime/getsize` | 139 |
| [jobs_core.py](../../backend/jobs_core.py) | 输入/输出/临时文件全为本地路径，`os.replace` 原子替换 | 283 |
| [waveform.py](../../backend/waveform.py) | 本地文件解码 + `os.stat` 指纹 | 88 |
| [ffmpeg.py](../../backend/ffmpeg.py) | 本地路径直接喂给 ffmpeg | 163 |
| 前端 | `path` 字符串、localStorage 路径、硬编码 `/sdcard/ADM`；`player.js` 直接拼 `/api/stream`、`taskrunner.js` 直接拼 SSE URL（不走 api.js） | app.js / player.js / taskrunner.js |

### 4.2 目标架构：Storage 抽象 + 物化层 + 派生缓存

```
API 层（不变）
   │  path 参数升级为 URI：local:/sdcard/x.flac  |  dav:<profile>/Music/x.flac
   ▼
StorageProvider（接口）
   ├─ LocalProvider   os.*（保留现有白名单语义）
   └─ DavProvider     httpx：PROPFIND/GET(Range)/PUT/MOVE/DELETE/MKCOL/HEAD
   ▼
Materializer（关键层）
   ├─ localize(uri) → 本地 workdir 文件（下载 + 指纹 + LRU，任务结束可保留/清理）
   ├─ commit(local, uri, etag) → PUT 临时名 + MOVE 覆盖（原子替换）
   └─ 传输进度 → SSE 事件（download/upload 阶段）
   ▼
DerivedCache（SQLite + 文件）
   ├─ probe JSON、cover JPEG、thumb、waveform
   └─ key = (etag, size, mtime, variant)
```

**核心设计原则：算法层只认本地路径。** 远端文件先物化，处理完再提交。这样：

- `jobs_core.py` / `waveform.py` / `ffmpeg.py` 几乎不改；
- 网络逻辑集中在 1~2 个模块，可单独测试；
- 本地模式和 WebDAV 模式共用同一套任务/播放/缓存逻辑；
- 换 S3/FTP/SFTP 时只需再加一个 Provider。

### 4.3 逐接口映射

| 接口 | 今天 | WebDAV 后 | 难度 |
|---|---|---|---|
| `GET /api/browse` | `listdir` + 逐项 `stat` | 一次 `PROPFIND Depth:1`（只请求必要属性），返回 dirs/files/size/mtime | 低 |
| `GET /api/tree` | 每层 `listdir` 两次（子目录再 listdir） | 一次 `PROPFIND Depth:1` 即可判断 `has_children`（看子项里有无 collection） | 低（但必须重构，否则 N+1） |
| `GET /api/image` | `FileResponse` | 下载/流式转发（带缓存） | 低 |
| `GET /api/cover` | 本地 ffmpeg 提取 | 物化 + ffmpeg + 缓存 | 中（首次要下载整曲） |
| `GET /api/thumb` | 同上 | 同上；建议优先用同目录 `cover.jpg`/`folder.jpg`，避免逐曲下载 | 中 |
| `GET /api/probe_file` | 本地 ffprobe | 物化 + ffprobe + JSON 缓存 | 中 |
| `GET /api/waveform` | 本地解码 | 物化 + 解码 + 缓存；按需触发，不预取 | 中（大文件下载耗时） |
| `GET /api/stream` | `FileResponse`（原生 Range） | **代理 Range**：解析 `Range` 头 → 转发上游 → 返回 206/Content-Range/Accept-Ranges；不落盘 | 中高 |
| `POST /api/play` | `am start file://` | 无本地文件 → 禁用或先下载到缓存再 Intent（FileProvider） | 低（降级） |
| `POST /api/move` | `shutil.move` + 冲突策略 | `MOVE` + `Overwrite` 头；rename 用 `Overwrite:F`；overwrite 先 `DELETE`；目标是目录时拒绝 | 中 |
| `POST /api/mkdir` | `os.mkdir` | `MKCOL`（已存在返回 405 → 转成 exists 错误） | 低 |
| `POST /api/rmdir` | `os.rmdir`（仅空目录） | `PROPFIND Depth:1` 判空 → `DELETE`（WebDAV 的 DELETE 是递归的，语义不同，必须先判空） | 低 |
| `POST /api/rename_dir` | `os.rename` | `MOVE` | 低 |
| `POST /api/delete` | `shutil.rmtree` / `os.remove` | `DELETE`（递归语义一致）；白名单改为“绑定根内” | 低 |
| `POST /api/edit_tags` | 本地临时文件 + `os.replace` | 物化 → ffmpeg 重写 → `PUT`（`If-Match: etag`）→ 冲突返回 409 | 中 |
| `POST /api/start`（4 类任务） | 全本地 | 任务开始批量物化（可流式逐文件），结束时逐文件 `PUT`；进度加 download/upload 阶段；失败可跳过 | 高 |
| `presets` / `ui_config` | 本地 JSON | 不变（仍在 app 私有目录） | 无 |

### 4.4 三个真难点

#### 难点 1：首屏性能（P0）

现状的列表页会为每个可见文件触发 `/api/thumb`，标签列还会对每个文件 `/api/probe_file`。本地是毫秒级；WebDAV 上是“每首歌下载整文件”——200 首的专辑目录 = 几 GB 流量、几分钟等待。

必须做的设计：

1. **一次 PROPFIND 拿全列表**，禁止逐项 HEAD；
2. **封面优先级**：同目录图片（`cover.jpg`/`folder.jpg`/`front.jpg`，已在 PROPFIND 结果里）> 内嵌封面（要下载整曲）。网格默认显示目录封面，点开/播放时再提取内嵌；
3. **标签列默认关闭**：WebDAV 模式下不自动 probe，只对已缓存/当前播放文件显示；
4. **缩略图/波形按需 + 指纹缓存**：ETag 变化才重算；缓存上限（如 2 GB）LRU；
5. **元数据索引**：SQLite 存 `(uri, etag, size, mtime, probe_json 摘要)`，列表排序用索引值，不实时请求；
6. **并发限流**：同时 2~3 个下载，避免打满 NAS 或手机网络。

#### 难点 2：写回一致性（P0）

`GET → 本地处理 → PUT` 期间远端可能被其他客户端修改；直接覆盖会丢更新。

- `PUT` 带 `If-Match: <etag>`，失败（412）→ 重新物化/提示冲突；
- 上传用 `PUT .ac2tmp` + `MOVE` 覆盖到目标（同服务器内原子）；失败留下临时文件可清理；
- 移动/重命名用 `MOVE` 的 `Overwrite` 头，语义映射清楚；
- 删除源文件在“上传成功后”执行，避免中途失败丢文件；
- 任务整体失败时，明确“已成功的文件不回滚”（与现在本地行为一致），日志写清楚。

#### 难点 3：播放与系统播放器（P1）

- `<audio>` 的拖动依赖 Range。代理必须正确返回 `206`、`Content-Range`、`Content-Length`、`Accept-Ranges: bytes`，并把 `Range` 透传给上游；上游不支持 Range 时降级为“整流转发”，进度条会失效（要提示）。
- 不要整文件缓存到磁盘再播放（DSD 几百 MB）；直接流式转发。
- `/api/play` 的 `file://` intent 在 WebDAV 模式下失效：建议隐藏“系统播放器”入口，保留网页播放；想要系统播放器就先下载到缓存再发 Intent（FileProvider）。

### 4.5 其余难点（可控，但要提前设计）

| 项 | 说明 | 对策 |
|---|---|---|
| 认证 | Basic（坚果云/Nextcloud/Alist/群晖）为主，少数 Digest | `httpx` 的 Basic/Digest；先 Basic，Digest 按需 |
| 凭据存储 | 不能明文进 JSON | Android Keystore / 桌面 keyring；配置接口回传时脱敏；日志禁止打印密码 |
| TLS | 自签/内网 CA | 支持导入自定义 CA（PEM），不提供“跳过校验”开关 |
| 路径 | href 是 URL 编码的绝对路径，可能带 base path | 统一 `unquote` + 规范化 + 拒绝 `..`，限定在绑定根内 |
| 目录变更 | 无 inotify | 手动刷新 + ETag/TTL 缓存；不做后台轮询 |
| 大文件 | DSD/APE 上百 MB | 分块下载 + 进度 + 断点续传（`.part` + Range）；磁盘上限 |
| 服务器差异 | PROPFIND 属性、MOVE 支持、Range 支持不一致 | 启动时能力探测（`OPTIONS`/`DAV` 头、HEAD Range 试探），不支持时降级并提示 |
| 离线 | 网络断开后页面不可用 | 本地模式保留；WebDAV 只读缓存可浏览已缓存内容（后置） |
| 并发/锁 | 多客户端同时写 | ETag 冲突检测；不做 WebDAV LOCK（服务器支持率低） |

### 4.6 结论：WebDAV 会不会引入新技术难点？

**会，但性质不同，而且总体可控。**

| 维度 | FFmpeg/打包 | WebDAV |
|---|---|---|
| 难点类型 | 平台限制（exec/ABI/权限） | 分布式存储（延迟/缓存/一致性） |
| 是否阻塞 | 是，绕不开 | 否，可分层解决 |
| 工作量 | 首次 3~6 天，之后重复 | 首次 1~2 周（含只读+写回） |
| 长期维护 | Chaquopy/ffmpeg-kit 上游风险 | 服务器兼容性矩阵 |
| 对 app 打包 | 核心难点 | **反而简化**：WebDAV 走网络，不需要 `/sdcard` 权限/SAF |

一句话：**WebDAV 不会让 app 更难打包，它让 app 不再需要“本地文件系统”这个最难打包的部分。** 但它会把“毫秒级本地 IO”换成“100ms~2s 网络 IO”，所以必须做缓存/懒加载/物化，否则体验会明显变差。

### 4.7 分阶段落地

| 阶段 | 内容 | 验收 |
|---|---|---|
| S1（3~5 天） | `StorageProvider` 接口 + `LocalProvider`（行为不变）+ `PathRef` URI + `/api/roots`；前端兼容旧路径 | 现有 8 套回归全过；本地模式零变化 |
| S2（3~5 天） | `DavProvider` 只读（PROPFIND/GET Range）+ 物化缓存 + probe/thumb/waveform 按需 + 播放代理 | 挂载 wsgidav/rclone 测试：浏览 200 项目录 < 2s；播放拖动正常；缩略图不触发批量下载 |
| S3（3~5 天） | 写回：move/mkdir/rmdir/rename/delete/edit_tags/任务上传 + ETag 冲突处理 | 任务全链路：下载→转换→上传→校验；断网重试有明确错误 |
| S4（可选） | 多绑定/凭据 UI/自签 CA/能力探测/离线缓存 | 真实 NAS（Nextcloud/坚果云）冒烟 |

测试建议：用 `wsgidav`（纯 Python，`pip install wsgidav`）或 `rclone serve webdav` 在 127.0.0.1:8081 起测试服务器，CI 里跑集成测试，不要拿真实网盘做单测。

---

## 5. 长期维护方案

### 5.1 目标分层（依赖方向自上而下，禁止反向）

```
[前端：零构建 IIFE]  ──HTTP/SSE──▶  [API 层：FastAPI（服务端）/ Starlette（app）]
                                          │
                                    [应用服务层]
                                      ├─ 任务编排（jobs/jobs_core）
                                      ├─ 播放/流代理
                                      └─ 索引与派生缓存
                                          │
                          ┌───────────────┴───────────────┐
                    [StorageProvider]                [FFmpegRunner]
                     ├─ Local                        ├─ SubprocessRunner
                     └─ WebDAV(httpx)                └─ AndroidRunner(ffmpeg-kit)
                          │
                    [Materializer + DerivedCache(SQLite)]
```

规则：

1. **算法层（jobs_core）只接受本地路径**，不 import 网络库；
2. 网络只出现在 `StorageProvider` / `Materializer`；
3. API 层不直接 `os.*`，一律走 Provider（本地 Provider 内部才 `os.*`）；
4. 前端不感知存储类型，只拿 URI + 显示名；
5. FFmpeg 调用只经 `FFmpegRunner`，任务代码不拼平台差异。

### 5.2 契约与测试

| 层 | 手段 |
|---|---|
| API 契约 | OpenAPI（FastAPI 自动生成）；app 版 Starlette 手写 schema 时用同一份 JSON 契约做快照测试 |
| 算法 | pytest + `ffmpeg -f lavfi -i sine` 生成 1 秒样本，覆盖 4 类任务与标签编辑 |
| 前端 | 保留现有 8 套 jsdom 脚本；新增 WebDAV 模式冒烟（拦截 fetch 返回假数据） |
| WebDAV | wsgidav 集成测试：浏览/搜索/移动/删除/上传/ETag 冲突 |
| 打包 | CI 构建 + 安装冒烟（脚本 adb install + monkey 启动 + 日志断言）；至少保证“能启动、能浏览、能播放、能跑一次任务” |
| 兼容 | 维护“服务器矩阵”文档：Nextcloud / 坚果云 / Alist / 群晖 / rclone，记录已知差异 |

### 5.3 发布节奏

| 类型 | 频率 | 动作 |
|---|---|---|
| 日常 | 随时 | Termux 直接改、跑冒烟；不做打包 |
| 小版本 | 1~2 周 | tag → CI 出 APK/桌面包/Docker；更新 HANDOVER 与变更记录 |
| 大版本 | 按需 | 先跑迁移脚本 + 全量回归；APK/服务端同版本号 |
| 配置/数据 | 每次结构变更 | `schema_version` + 向前迁移；保留备份（导出 JSON） |

### 5.4 风险登记

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 无鉴权 + 局域网/WebDAV 凭据泄漏 | 高 | 加 `AC2_TOKEN`；app 内绑 127.0.0.1；凭据进 Keystore；日志脱敏 |
| R2 | WebDAV 首屏/缩略图性能不达预期 | 中高 | S2 先做性能验收，不达标就砍自动缩略图/标签列 |
| R3 | Chaquopy/ffmpeg-kit 上游变化 | 中 | 锁版本；保留 Termux/服务端形态作为退路；CI 固定依赖 |
| R4 | pydantic→Starlette 迁移引入接口回归 | 中 | 契约快照 + 8 套回归；分接口迁移 |
| R5 | 单人维护、无 CI、无测试 | 中 | 先补 pytest + CI，再动大改 |
| R6 | WebDAV 服务器差异（MOVE/Range/属性） | 中 | 能力探测 + 降级 + 矩阵测试 |
| R7 | Android 存储权限/Play 政策 | 低（侧载） | 首版只做内部目录 + WebDAV |
| R8 | LGPL 合规（ffmpeg-kit-audio） | 低 | 动态链接 + 保留许可证/源码获取说明 |

### 5.5 路线图（建议）

```
v3.23  本周      PWA（manifest+图标）+ /api/version + /api/roots + 去硬编码 /sdcard
v3.24  1~2 周    StorageProvider 抽象（本地）+ PathRef URI + 单测
v4.0   2~3 周    WebDAV 只读（浏览/播放/probe/波形/缩略图）+ 物化缓存
v4.1   2~3 周    WebDAV 写回（移动/删除/标签/任务）+ 冲突处理
v5.0   按需      Chaquopy APK（Starlette 适配 + ffmpeg-kit 桥 + 前台服务）
v5.1   可选      桌面 PyInstaller 包 / Docker 镜像
```

---

## 6. 建议的下一步（按性价比排序）

1. **今天就能做（0.5 天）**：PWA。`frontend/manifest.webmanifest` + 图标 + `theme-color` + `display: standalone`；Chrome 添加到主屏。先确认“独立窗口 + 图标”是否已经满足需求——很多人到这一步就够用了。
2. **本周（1 天）**：打包前的代码解耦——`config.py` 支持 `AC2_DATA_DIR`；新增 `/api/roots`；前端去掉 `/sdcard/ADM` 硬编码；`/api/version`；`ffmpeg.py` 抽 `Runner` 接口（本地实现不变）。这些改动对现有功能零影响，但让后续三条路线都不返工。
3. **下周（3~5 天）**：StorageProvider 抽象 + LocalProvider + wsgidav 集成测试。这是 WebDAV 的地基，也是“以后换任何存储”的地基。
4. **再决定**：
   - 想要**离线独立 app** → 走 Chaquopy（先做 Starlette 适配 + ffmpeg-kit 桥的 PoC：只验证“能转一首 flac”）。
   - 音乐库要放 **NAS/PC** → 走服务端 Docker + WebDAV，手机端 PWA/壳即可，完全跳过 Chaquopy。
   - 只想**手机本地用** → PWA + Termux 已经够，最多加个 WebView 壳。

---

## 附录 A：本机实测环境（2026-11-15）

| 项 | 值 |
|---|---|
| 设备 | Xiaomi 23116PN5BC，Android 16（API 36） |
| ABI | arm64-v8a（只有 64 位） |
| 内存页 | 4096（4 KB；非 16 KB 设备，但打包仍按 16 KB 对齐要求做） |
| Python | 3.14.6（Termux） |
| ffmpeg/ffprobe | 8.1.3（Termux 构建，API 24，动态链接，GPL 构建） |
| ffmpeg 协议 | 有 http/https/ftp/sftp 等，**没有 webdav/dav** |
| ffmpeg 音频编码 | flac、libmp3lame、libopus、libvorbis、aac、alac；解码 ape/wavpack/alac |
| 已装 Python 包 | fastapi 0.162.0、uvicorn 0.54.0、pydantic 2.14.2、starlette 1.10.0 |
| 构建工具 | 无 java、无 gradle、无 Android SDK、无 aapt2 → Termux 不能构建 APK |
| Termux 存储 | `/sdcard` 已授权；`PREFIX=/data/data/com.termux/files/usr` |
| Termux targetSdk | 28（旧 targetSdk 豁免，是 Termux 能 exec ffmpeg 的原因） |

## 附录 B：参考与依据

- Chaquopy 17.0 发布说明（Python 3.14、16 KB 页、pip 只装 wheel）：<https://chaquo.com/chaquopy/chaquopy-version-17-0-0/>
- Chaquopy Gradle 文档（minSdk 24、ABI、pip、extractPackages、multiprocessing 限制）：<https://chaquo.com/chaquopy/doc/current/android.html>
- Chaquopy 免费许可（已完全免费开源）：<https://chaquo.com/chaquopy/free-license/>
- ffmpeg-kit 归档后的社区维护分支（8.1.7，LGPL，16 KB 对齐，arm64+x86_64）：<https://github.com/ffmpegkit-maintained/ffmpeg>
- 迁移说明（groupId 替换、变体矩阵、许可证）：<https://github.com/ffmpegkit-maintained/ffmpeg/blob/main/docs/MIGRATION.md>
- pydantic-core Android wheel 问题（需自行构建）：<https://github.com/chaquo/chaquopy/issues/1326>
- Android 10 行为变更：应用主目录内文件不可执行（W^X）：<https://developer.android.com/about/versions/10/behavior-changes-10>
- wsgidav（Python WebDAV 服务器，用于测试）：<https://github.com/mar10/wsgidav>
- Briefcase（备选打包工具，本方案未采用）：<https://github.com/beeware/briefcase>

## 附录 C：术语速查（给不熟打包的人）

| 词 | 一句话解释 |
|---|---|
| Gradle | Android 的构建工具，读 `build.gradle.kts` 把代码/资源打成 APK |
| AAR | Android 的库包（类似 jar，但含原生 .so） |
| ABI | CPU 架构，手机是 `arm64-v8a`；模拟器是 `x86_64` |
| jniLibs / nativeLibraryDir | APK 里放原生库的目录；安装后系统解压到只读目录，可执行 |
| Chaquopy | 把 CPython 解释器 + 你的 Python 代码打进 APK 的 Gradle 插件 |
| PWA | 网页 + manifest + service worker，可“添加到主屏”、独立窗口 |
| WebView 壳 | 一个只有 WebView 的 Android app，加载本地/远端网页 |
| CI | 自动构建服务（如 GitHub Actions），push/tag 后自动出包 |
| 16 KB 页 | Android 新设备的内存页大小；原生库必须按 16 KB 对齐，否则崩溃 |
