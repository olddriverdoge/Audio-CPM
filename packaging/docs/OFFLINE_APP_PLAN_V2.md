# Audio-CPM 离线 App + 本地/WebDAV 双栈方案（v2）

> **状态说明（v3 修订）**：本版“波形砍掉 / 外部播放器砍掉”的判断已被推翻。最新方案见 [OFFLINE_APP_PLAN_V3.md](OFFLINE_APP_PLAN_V3.md)：本地波形改用 Android MediaCodec 保留、AIFF 可播放（转 WAV）、外部播放器仅本地模式保留。本文保留作“WebDAV 范围收缩 / 4 种互通 / 技术债”的参考。

> 决策输入（2026-11-15）：
> 1. **必须离线独立**，否则打包没意义；
> 2. **本地 + WebDAV 并行兼容**，不做二选一，基础文件双向互通即可；
> 3. 可以用 **PC 辅助**，只要性价比高、减少工作量；
> 4. **FFmpeg 不是必须**：可以放弃转换，保住“文件管理 + 元数据采集 + 无损播放”；
> 5. WebDAV 写操作**默认只读，需用户显式授权**；播放走**流式**，不全量缓存；
> 6. 先梳理技术债，再打包。
>
> 本文是 v2 方案，取代 v1 中“FFmpeg 必须进 app”的前提。v1 保留作 FFmpeg 桥接/CI 的备选参考（[APP_PACKAGING_AND_WEBDAV_PLAN.md](APP_PACKAGING_AND_WEBDAV_PLAN.md)）。

---

## 0. 核心结论

**app 首版不带 FFmpeg。** 用三层平替：

| 原 FFmpeg 用途 | 平替 | 是否保留 |
|---|---|---|
| 元数据探测（ffprobe） | **mutagen**（纯 Python，读头/尾即可） | 保留，且更快 |
| 标签编辑（ffmpeg 重写） | **mutagen** 原地写标签（不重编码） | 保留（本地写；WebDAV 只读） |
| 内嵌封面提取（ffmpeg） | **mutagen** 读 picture 块 | 保留 |
| 缩略图缩放（ffmpeg） | 返回原图 + 前端 CSS 缩放（不做服务端缩放） | 降级保留 |
| 无损播放（浏览器/系统播放器） | WebView 原生解码 FLAC/WAV/MP3/AAC/OGG/OPUS | 保留 |
| 格式转换（ffmpeg） | 无 | **砍掉**（Termux/服务端 Pro 版保留） |
| 波形（ffmpeg 解码） | 无 | **砍掉**（或仅 WAV，后置） |
| APE/DSD/WV/ALAC 播放 | 无 | **砍掉**（提示不支持） |
| 系统播放器（am intent） | 无 | **砍掉**（保留设置入口，灰置） |

由此得到的关键收益：

- **打包难度骤降**：不涉及可执行文件 exec、ABI、16 KB 对齐的 FFmpeg，只装纯 Python 依赖（Chaquopy + Starlette + uvicorn + httpx + mutagen），APK 约 30~40 MB；
- 元数据读取从“每次 fork 一个 ffprobe 进程”变成“纯 Python 读几十 KB”，本地列表/标签列会明显变快；
- 标签编辑不再“整文件重写 + 重编码”，只改标签块，更快更安全（保留封面/多流）；
- WebDAV 模式不需要下载整文件就能读元数据（HTTP Range 读头/尾），这是“深挖 WebDAV 接口”的核心。

---

## 1. 功能分级

| 功能 | 本地 | WebDAV | app 首版 | 备注 |
|---|---|---|---|---|
| 浏览/搜索/排序/面包屑 | ✓ | ✓ | ✓ | PROPFIND 一次拿全 |
| 封面/缩略图 | ✓ | ✓ | ✓（原图） | 同目录图优先，内嵌图用 mutagen |
| 元数据查看 | ✓ | ✓ | ✓ | mutagen；WebDAV 用 Range |
| 标签编辑 | ✓ | 授权写 | ✓（本地） | mutagen；WebDAV 需下载+上传 |
| 整理标签（按标签改名） | ✓ | 否 | ✓（本地） | 纯文件操作 + mutagen |
| 检查标签 | ✓ | ✓ | ✓ | mutagen 扫描 |
| 播放（FLAC/WAV/MP3/AAC/OGG/OPUS） | ✓ | ✓ | ✓ | WebView 原生解码 |
| 播放（ALAC） | 否 | 否 | 否 | 浏览器不支持 ALAC（后续 Pro） |
| 播放（APE/DSD/WV） | 否（网页） | 否 | 否 | 需 ffmpeg，砍 |
| 移动/重命名/删除/新建目录 | ✓ | 授权写 | ✓ | 4 种互通 |
| 上传/下载/跨存储复制移动 | — | — | ✓ | 4 种互通 |
| 格式转换 | ✓（ffmpeg） | 否 | **否** | Termux/服务端 Pro |
| 替换封面 | ✓（ffmpeg） | 否 | **否**（可后置 mutagen 版） | 非必需 |
| 波形 | ✓（ffmpeg） | 否 | **否** | 进度条改为普通条 |
| 频谱 | ✓（WebAudio） | ✓ | ✓ | 前端分析，不依赖后端 |
| 系统播放器 | ✓（am） | 否 | **否** | 设置入口灰置 |
| 界面配置/预设 | ✓ | ✓ | ✓ | 存 app 私有目录 |

> 结论：**“文件管理 + 元数据 + 无损播放”完全不需要 FFmpeg。** 砍掉转换后，app 的功能完整度仍然很高。

---

## 2. 技术债清单（先还债，再打包）

| ID | 债务 | 现状（代码位置） | 对 app | 对 WebDAV | 改法 | 优先级 |
|---|---|---|---|---|---|---|
| T1 | `path` = 本地绝对路径 | 全后端 + 前端 localStorage | 可用但 `/sdcard` 受限 | **不成立** | 引入 `PathRef` URI（`local:` / `dav:<id>:`) + StorageProvider | P0 |
| T2 | 配置写项目根目录 | [config.py](../../backend/config.py)、[ui_api.py](../../backend/routers/) | **只读崩溃** | 同左 | `AC2_DATA_DIR` 环境变量，默认回退旧行为 | P0 |
| T3 | 前端硬编码 `/sdcard/ADM`、`/sdcard` | [app.js](../../frontend/js/app.js) 218/568/601/613 | 目录不存在 | 无意义 | 新增 `/api/roots`，前端动态取根；localStorage 按数据源分键 | P0 |
| T4 | 元数据依赖 ffprobe | [ffmpeg.py](../../backend/ffmpeg.py)、[browse_api.py](../../backend/routers/browse_api.py)、[media_api.py](../../backend/routers/media_api.py) | **无 ffmpeg** | 需下载整文件 | 新 `meta.py`：mutagen 优先，ffprobe 回退（服务端/Pro） | P0 |
| T5 | 系统播放器依赖 `am`/`file://` | [media_api.py](../../backend/routers/media_api.py) | 无 am | 无本地文件 | 前端隐藏入口/灰置；后端保留接口但 app 内返回 not_supported | P0 |
| T6 | 任务只支持 ffmpeg 批处理，无传输任务/取消 | [jobs.py](../../backend/jobs.py)、[jobs_core.py](../../backend/jobs_core.py) | 上传下载需要 | 同左 | 新增 `TransferTask`（copy/move 4 模式）+ 取消 | P1 |
| T7 | 无权限/只读模型 | 全后端（无鉴权） | 需存储权限 | 需 WebDAV 授权 | 本地：MANAGE_EXTERNAL_STORAGE；远端：连接级 `readonly` + 403 降级 | P0 |
| T8 | ffmpeg-only 功能没有开关 | 前端按钮写死 | 会点了报错 | 同左 | `/api/capabilities` 下发，前端按能力隐藏 | P1 |
| T9 | 无鉴权 | 全后端 | 本地 127.0.0.1 尚可 | 局域网危险 | 启动时随机 token，壳注入 + 前端带上 | P1 |
| T10 | FastAPI + pydantic 在 Chaquopy 不可用 | [app.py](../../backend/app.py)、[models.py](../../backend/models.py) | **装不上** | — | 全量迁 Starlette（推荐）或双适配器 | P0（打包前） |
| T11 | 配置无 schema/版本 | `ac2_ui_config.json` | 升级易丢 | 同左 | `schema_version` + 迁移函数 + `/api/version` | P2 |
| T12 | 缺 pytest/CI，回归靠临时 jsdom | — | 打包风险 | 同左 | pytest（算法/元数据）+ 现有 jsdom + CI | P1 |

依赖顺序：

```
T2 ─┐
T3 ─┼─▶ T1 存储抽象 ─▶ T4 元数据 ─▶ T6 传输 ─▶ T7 权限/只读 ─▶ T8 capability
T5 ─┘                      │
                           └─▶ T10 Starlette ─▶ 打包 PoC
T9/T11/T12 可并行
```

**先把 T1~T5 做完，WebDAV 和打包会同时变简单；顺序反过来会写两套代码。**

---

## 3. 目标架构

```
前端（零构建 IIFE，19 个模块不变）
  ├─ 数据源选择：本地根列表 + WebDAV 绑定列表（/api/roots）
  ├─ 浏览/播放/元数据/移动/上传下载
  └─ 按 /api/capabilities 显隐按钮（无 ffmpeg 时隐藏转换/波形）
        │ HTTP + SSE
API 层（Starlette；Termux/服务端同一套）
  ├─ /api/roots         数据源列表（local root / dav profile）
  ├─ /api/browse        统一目录列表（PROPFIND / os.listdir）
  ├─ /api/meta          元数据（mutagen；WebDAV 用 Range）
  ├─ /api/stream        Range 代理（Dav）/ FileResponse（Local）
  ├─ /api/transfer      copy/move 4 模式，SSE 进度，可取消
  └─ /api/tags          标签编辑（本地 mutagen；WebDAV 只读）
        │
Core（与平台无关）
  ├─ storage/base.py    StorageProvider 接口
  ├─ storage/local.py   os.*（保留白名单）
  ├─ storage/dav.py     httpx：PROPFIND/GET Range/PUT/MOVE/DELETE/MKCOL
  ├─ meta/mutagen_io.py mutagen 读取/写入 + RangeFile
  └─ transfer.py        4 种互通模式 + 冲突策略
        │
Platform
  ├─ Android：Chaquopy + WebView + 前台服务 + 权限引导
  └─ Termux/服务端：uvicorn + ffmpeg（Pro 功能：转换/波形/APE 播放）
```

设计规则不变：**算法/元数据层只认本地或 file-like；网络只在 storage；前端不感知存储类型。**

---

## 4. 元数据平替：mutagen（本方案基石）

### 4.1 为什么可行

- **纯 Python**，无 native wheel，Chaquopy 直接 `pip install mutagen` 可用。
- 只读文件头/尾：FLAC 读 STREAMINFO/VORBIS_COMMENT/PICTURE；MP3 读 ID3v2 + 尾部 ID3v1；MP4 读 moov；OGG 读 comment header。通常几十 KB 到几 MB（含封面），**不需要整文件**。
- 支持读写标签的格式：FLAC、MP3、MP4/M4A/ALAC、OGG Vorbis、Opus、WAV、AIFF、APE、WavPack、DSF（写支持视格式而定）。
- 支持读取音频参数：采样率、位深、声道、时长、码率（各格式 info 对象）。
- 封面：FLAC `pictures`、MP3 `APIC`、MP4 `covr`、OGG `METADATA_BLOCK_PICTURE`。

### 4.2 字段映射

现有前端用 `probe_file_detail()` 的顶层 `tags`（小写 key）与 `audio`（codec/sample_rate/...）。新 `meta.py` 输出同结构，前端不改：

| 现有字段 | mutagen 来源 |
|---|---|
| title/artist/album/album_artist/composer/track/disc/year/genre/comment | `mutagen.File(easy=True)` 的 title/artist/album/albumartist/composer/tracknumber/discnumber/date/genre/comment |
| format.duration/size/bit_rate | `info.length` / `os.stat` / `info.bitrate` |
| audio.codec_name/sample_rate/channels/bits_per_sample | 各格式 `info.*` + 扩展名映射 |
| has_cover | `pictures`/`APIC`/`covr` 是否存在 |
| tags（原始） | easy 映射后再补原始键（保持现有 `clean_text` 逻辑） |

注意：APE/WV 用 APEv2 键名大写；DSF 用 ID3；需要在 `meta.py` 里做一次字段归一化（复用 `backend/ffmpeg.py` 里的 `clean_text`）。

### 4.3 WebDAV：Range 读元数据（关键优化）

```python
class HttpRangeFile(io.RawIOBase):
    """把 WebDAV 文件包装成 seekable file-like；按 64KB 块按需 Range GET。"""
    def __init__(self, dav, uri, size): ...
    def seekable(self): return True
    def seek(self, pos, whence=0): ...
    def read(self, n=-1): ...          # 命中块缓存，否则 HTTP Range
    def readinto(self, b): ...
```

- `mutagen.File(HttpRangeFile(...), filename=name)` 即可解析；尾部的 ID3v1/APE tag 会触发尾块 Range，也能命中。
- 每个文件保留一个块缓存（例如 8 个 64KB 块），避免重复请求；文件夹切换即丢弃。
- 一次目录列表的元数据成本从“N 次整文件下载”降为“N 次 1~2 个 Range 请求”。
- 封面（PICTURE 块）可能几 MB，按需读取并缓存；列表首屏**不要**自动取内嵌封面，优先用同目录图片。

### 4.4 与 ffprobe 的关系

- 本地模式：默认 mutagen；解析失败/字段缺失时可回退 ffprobe（Termux/服务端有 ffmpeg）。
- app 内：只有 mutagen；无法解析的格式显示“未知”，不报错。
- 转换/波形仍走 ffmpeg（仅 Pro）。

### 4.5 标签写入（本地）

- 用 `mutagen` 打开 → 修改 tags/pictures → `save()`。
- 安全流程：复制到 `.ac2tagtmp` → 修改 → 校验 → `os.replace`（大文件多一次 IO，但避免写坏；FLAC 200MB 可接受）。
- 不需要 ffmpeg，不重编码，封面/多流保留。
- WebDAV：需要下载整文件才能写标签，成本高；**首版只读**，未来作为“授权写”的高级功能（明确提示上传整文件）。

### 4.6 PoC 验收（第 1 周必须做）

1. 读取 5 种格式（FLAC/MP3/M4A/APE/DSF）的标题/艺术家/专辑/采样率/位深/时长/封面；
2. 写 FLAC 与 MP3 标签（含封面）并回读校验；
3. `HttpRangeFile` 在 wsgidav 上读 FLAC 标签（只发 1~3 个 Range 请求）；
4. 与现有 ffprobe 输出对比 10 个文件，字段差异可接受。

---

## 5. 播放方案

### 5.1 格式矩阵（WebView / Chromium）

| 格式 | WebView 播放 | 说明 |
|---|---|---|
| FLAC | ✓ | 含 24-bit/96kHz（高位深/高采样率由系统重采样输出） |
| WAV | ✓ | 16/24-bit PCM |
| MP3 / AAC(M4A) / OGG Vorbis / Opus | ✓ | 现有能力 |
| ALAC | ✗ | Chromium 不支持；提示“需转换或用 Pro” |
| APE / WV / DSF / DFF | ✗ | 需 ffmpeg 解码，砍 |

> 音质说明：WebView 播放是“无损解码 + Android 系统音频输出”，不保证 bit-perfect 直通（系统会混音/重采样）；真正的直通需要原生 AudioTrack/独占模式，属于以后的可选项。**“无损播放”在本方案里指 FLAC/WAV 原样解码，不转码、不降码率。**

### 5.2 流式与 Range

- 本地：继续 `FileResponse`（自带 Range/206）。
- WebDAV：`/api/stream` 代理 Range，**不落盘**；透传 `Range` → 上游，返回 `206` + `Content-Range` + `Accept-Ranges`。
- 上游不支持 Range：降级为整流转发（首播要等，拖动失效），并返回 `X-Audio-CPM-Range: unsupported` 供前端提示。
- 超时/断线：GET 幂等，可重试一次；播放器自身会重连。
- 大文件（DSD 几百 MB）不缓存；只缓存元数据/封面。

### 5.3 系统播放器与通知栏

- `/api/play` 与设置里的“系统播放器”保留配置入口，但 app 内标记不可用（灰置说明）；Termux/服务端仍可用。
- 锁屏/通知栏媒体控制：WebView 不可靠，首版不做；后续可用原生 MediaSession + 通知（工作量中等，非核心）。

---

## 6. 本地文件权限（回答“app 授权能不能解决”）

可以，但要选对路径。三条路：

| 方案 | 读写范围 | 用户体验 | 代码改动 | 结论 |
|---|---|---|---|---|
| app 私有目录（filesDir / Android/data） | 仅自己 | 用户拷贝麻烦 | 无 | 兜底 |
| **MANAGE_EXTERNAL_STORAGE（所有文件访问）** | 整个共享存储 | 设置页授权一次，侧载可用 | 小（申请 + 引导） | **首版采用** |
| SAF（`ACTION_OPEN_DOCUMENT_TREE`） | 用户选定目录 | 授权一次，但给的是 `content://` | 大（fd 桥接、目录遍历、移动） | 以后上架再考虑 |

- Android 13+ 同时申请 `READ_MEDIA_AUDIO`（读音频）；写/移动/删除仍要 `MANAGE_EXTERNAL_STORAGE`。
- 侧载 app 不受 Play 政策限制，MANAGE 可用；如果未来上架 Play，音乐播放器申请“所有文件访问”大概率被拒，需要改 SAF/MediaStore——这是远期风险，先记入风险表。
- 拒绝授权时：降级为“私有目录 + WebDAV”，页面提示授权入口。
- 引导页：`Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` + 说明为什么需要（管理本地音乐文件）。

**结论：读写权限用 app 授权可以解决；首版走 MANAGE_EXTERNAL_STORAGE 最省事，不引入 SAF 复杂度。**

---

## 7. 四种互通模式（本地 ↔ WebDAV）

### 7.1 定义

数据源（DataSource）有两种：
- `local:<root>`：本地根（可多个，如内部存储、SD 卡）；
- `dav:<profile>`：一个 WebDAV 绑定（URL + 凭据 + 只读开关）。

“互通”按 **源 × 目标** 分四种：

| 模式 | 源 | 目标 | 实现 | 说明 |
|---|---|---|---|---|
| M1 | 本地 | 本地 | `shutil.move` / `copy2` / `os.rename` | 现有行为 |
| M2 | 本地 | WebDAV | 读本地 → `PUT` 流式（临时名 + MOVE） | 上传 |
| M3 | WebDAV | 本地 | `GET` 流式 → `.part` → 原子替换 | 下载 |
| M4 | WebDAV | WebDAV | 同 profile：`MOVE`/`COPY`；跨 profile：下载 + 上传 | 远端整理 |

每种模式都支持 **copy / move** 两个动作，统一冲突策略 `skip / rename / overwrite`。

### 7.2 统一流程

```
1. 解析 src/dst 数据源（URI），检查目标可写（readonly 直接拒绝）
2. 若是目录：递归遍历（WebDAV 用 PROPFIND Depth:∞ 或逐层；优先逐层，避免服务器禁用 infinity）
3. 每个文件：
   a. 目标已存在 → 按冲突策略（skip / rename 尾部 _1 / overwrite）
   b. copy：读源 → 写目标（流式，64KB~1MB chunk）
   c. move：copy 成功后删源（同存储同 provider 时优先用原子 RENAME/MOVE）
4. 进度：SSE 事件（总文件数/当前文件/字节数/阶段 download/upload/delete）
5. 失败：单文件失败不阻塞后续（与现有任务一致），汇总 results
6. 取消：协作式取消（每 chunk 检查标志），已复制文件保留
```

### 7.3 冲突与原子性

- 本地 overwrite：先删/替换（现有 `os.replace` 语义）。
- WebDAV overwrite：`PUT .ac2tmp` + `MOVE .ac2tmp → target`（`Overwrite: T`，同服务器内原子）。
- WebDAV rename：`MOVE` + `Overwrite: F`；目标存在则生成 `_1` 后缀。
- 跨存储 move：**先 copy 成功、再删源**；删除失败只告警（不丢文件）。
- 目录跨存储：不支持“原子目录移动”，递归复制后再删源；WebDAV 不支持跨服务器 MOVE。

### 7.4 UI 入口

- 浏览页顶部加“数据源”切换（本地根 / WebDAV 绑定），路径面包屑按数据源显示。
- 整理页：目标目录树支持“本地根 + WebDAV 根”两个 tab 组；移动条显示“本地 → WebDAV”方向。
- 上传/下载：工具栏按钮 + 选中项操作；传输任务在任务面板展示进度。
- 只读数据源：所有写按钮禁用，hover 提示“该连接为只读（可在设置中授权写入）”。

### 7.5 明确不做

- 不做后台自动同步/双向镜像/增量扫描（这是另一个产品）；
- 不做跨 profile 的目录级原子移动；
- 不做 WebDAV LOCK/UNLOCK；
- 不做断点续传的跨会话恢复（单次传输内可重试；会话级续传后置）。

---

## 8. WebDAV 设计（只读优先）

### 8.1 连接配置

- 字段：名称、URL（含 base path）、用户名、密码（Keystore/桌面 keyring）、`readonly`（默认 true）、自签 CA（PEM，可选）。
- 能力探测（连接时一次）：`OPTIONS`（DAV 头/允许方法）、`PROPFIND Depth:0`、`HEAD` 试探 Range。
- 不支持 PROPFIND → 不是 WebDAV，报错；不支持 Range → 播放降级提示；不支持 MOVE → 移动降级为“复制+删除”。

### 8.2 路径与编码

- 前端/后端统一 URI：`dav:<profile_id>/<相对路径>`；显示名与真实 href 分开。
- href 是 URL 编码的绝对路径（可能带 base path）：`unquote` → 去掉 base → 规范化为相对路径；`..` 拒绝；必须落在绑定根内。
- 文件名含 `#`/`?`/`%`/中文：编码一次，不重复编码。

### 8.3 只读与授权写

- 默认 `readonly=true`：只发 PROPFIND/GET/HEAD。
- 用户在设置里打开“允许写入”并确认风险后，才发 PUT/MOVE/DELETE/MKCOL。
- 服务器返回 403/401：写操作失败 → 前端提示“服务器未授权写入”，并自动把该连接标记为只读（本次会话）。
- 凭据错误：401 → 提示重新输入；不要无限重试。

### 8.4 缓存与性能

- 目录缓存：`(profile, path) → {etag, items, fetched_at}`，TTL 30~60s；手动刷新强制过期。
- 元数据缓存：`(profile, href, etag) → probe JSON`；etag 变化才重读 Range。
- 封面缓存：`(etag, size) → jpg`；列表首屏不取内嵌封面，用同目录图片。
- 并发：下载/上传各限 2~3 并发；PROPFIND 串行（避免打爆）。

---

## 9. 打包（无 FFmpeg 版）

### 9.1 依赖与体积

- Python 3.14（Chaquopy 17.2 支持；16 KB 设备兼容）。
- pip 依赖：`starlette`、`uvicorn`（不带 `[standard]`）、`httpx`、`mutagen`、`anyio`、`h11`、`click`、`certifi`、`idna`、`sniffio`（全是纯 Python，`--only-binary` 也能装）。
- 体积估算：libpython ~25 MB + 代码/前端 ~2 MB ≈ **28~35 MB**（只打 arm64-v8a）。
- 不再需要 ffmpeg-kit、不需要自编译 .so、不需要处理 exec/ABI/16 KB 对齐（Chaquopy 自己处理 libpython）。

### 9.2 Gradle 要点

```kotlin
android {
  defaultConfig {
    minSdk = 24
    targetSdk = 36
    ndk { abiFilters += listOf("arm64-v8a") }   // 本机只有 arm64；模拟器再议
  }
  sourceSets["main"].assets.srcDirs("../../frontend")
}
chaquopy {
  defaultConfig {
    version = "3.14"
    pip { install("-r", "../../requirements-app.txt") }
    pyc { src = true }
  }
  sourceSets { getByName("main") { srcDir("../../backend") } }
}
```

- `buildPython` 指向 PC 上的 Python 3.14（版本必须与 app 一致）。
- 启动：`Application.onCreate` 里 `Python.start`，后台线程 `uvicorn.Server.run(sockets=[sock])`；端口用 `socket.bind(('127.0.0.1', 0))` 取随机端口，传给 WebView。
- 前台服务：`dataSync` 类型（传输/长时间任务保活）；WebView 在 Activity。
- 权限：`INTERNET`、`MANAGE_EXTERNAL_STORAGE`、`READ_MEDIA_AUDIO`（13+）、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_DATA_SYNC`、`POST_NOTIFICATIONS`（可选）。
- WebView：`setJavaScriptEnabled`、`setDomStorageEnabled`、`setMediaPlaybackRequiresUserGesture(false)`、`setAllowFileAccess(false)`；明文放行 127.0.0.1（network-security-config）。
- 配置目录：壳注入 `AC2_DATA_DIR = filesDir`，预设/UI 配置/缓存都写在里面。

### 9.3 构建方式（PC 辅助）

| 场景 | 方式 | 耗时 |
|---|---|---|
| 日常调试 | PC 上 Android Studio `Run` / `installDebug` | 1~2 分钟（增量） |
| 出包 | `./gradlew assembleDebug` 或 GitHub Actions | 3~6 分钟（CI 有缓存） |
| 版本 | `versionName` 取 tag，`versionCode` 用 run number | — |
| 签名 | 固定 keystore（自用）；换签名必须卸载重装 | — |

### 9.4 首版验收清单

1. 安装 → 授权“所有文件访问” → 浏览 `/sdcard/Music`；
2. 列表元数据（标题/艺术家/时长）正确，48px 封面显示；
3. 播放 FLAC 24/96、WAV，拖动进度；
4. 编辑 FLAC 标签（标题/封面）→ 回读正确 → 其他播放器可见；
5. 本地移动/重命名/删除/新建目录；
6. 添加 WebDAV（只读）→ 浏览 → Range 读元数据 → 流式播放 → 拖动；
7. 开启写入 → 上传一个文件 → 远端可见；下载到本地；
8. 跨存储移动（本地→WebDAV、WebDAV→本地）；
9. 杀进程重开：配置/预设/缓存仍在；
10. 断网：WebDAV 报错友好，本地功能不受影响。

---

## 10. 路线图（技术债优先）

| 周 | 目标 | 交付/验收 |
|---|---|---|
| W1 | T2/T3/T5 + T1 抽象 + T4 mutagen PoC | `AC2_DATA_DIR`；`/api/roots`；前端去硬编码；`/api/capabilities`；mutagen 读写/封面/Range PoC 通过 |
| W2 | T4 全量 + T10 Starlette + 打包 PoC | 元数据/标签/封面全部走 mutagen；本地回归全过；Chaquopy 空壳跑通“浏览+播放+标签” |
| W3 | WebDAV 只读（T7 部分） | 双源浏览、Range 播放、Range 元数据、封面缓存；性能验收 |
| W4 | 4 种互通 + 传输任务（T6/T7） | 上传/下载/跨存储移动、只读守卫、进度/取消、冲突策略 |
| W5 | 打磨 + T8/T9/T11/T12 | capability 显隐、token、schema 迁移、pytest/CI、发版 |

> 打包 PoC 必须放在 W2，而不是最后——Chaquopy/权限/WebView 的坑要提前暴露。

---

## 11. 风险与待确认

| 风险 | 等级 | 应对 |
|---|---|---|
| mutagen 对 APE/DSF/WAV 的写支持不完整 | 中 | 只开放已验证格式（FLAC/MP3/M4A/OGG）；其他只读 |
| WebView 高位深 FLAC/长音频兼容性 | 中 | W2 真机验收；失败则降级提示 |
| `MANAGE_EXTERNAL_STORAGE` 未来上架受限 | 中 | 侧载用户无影响；上架前改 SAF |
| Chaquopy + uvicorn 线程/端口/前台服务 | 中 | W2 PoC 验证；备选固定端口重试 |
| WebDAV 服务器 Range/尾读/MOVE 差异 | 中 | 能力探测 + 降级 + wsgidav 测试 |
| 标签编辑大文件复制耗时 | 低 | 只在本地启用；显示进度 |
| 无波形/无锁屏控制 | 低 | 产品降级，UI 说明 |
| WebView 内频谱（MediaElementSource）兼容性 | 低 | 失败时隐藏频谱入口，不影响播放 |
| 封面原图直出（不缩放）的带宽/内存 | 低 | 列表用同目录图 + 前端 CSS 缩放；原图缓存按 MIME 存正确扩展名 |
| 单人维护 + 时间 | 中 | 砍功能保主线：先“浏览+播放+元数据+双源”，再做互通 |

待确认（影响 W1 排期）：

1. 标签编辑是否必须（决定 mutagen 写 + 安全替换的工作量）；
2. 音乐库格式分布（FLAC 为主？ALAC/APE/DSD 占比）；
3. WebDAV 是否接受“默认只读、手动授权写”；
4. 是否接受“无波形、无锁屏控制、无系统播放器”。

---

## 附录：v1 → v2 变更对照

| 主题 | v1 | v2 |
|---|---|---|
| FFmpeg | 必须进 app（ffmpeg-kit JNI 桥） | 不进 app；转换/波形/APE 播放砍掉 |
| 元数据 | ffprobe | mutagen（纯 Python；WebDAV 用 Range） |
| 标签编辑 | ffmpeg 重写 | mutagen 原地改标签 |
| 打包 | Chaquopy + ffmpeg-kit + Starlette | Chaquopy + Starlette（无 ffmpeg） |
| 播放 | 网页 + 系统播放器双通道 | 仅网页无损；系统播放器砍 |
| WebDAV | 全功能（含转换） | 只读优先 + 授权写；不做转换 |
| 互通 | 未定义 | 4 种模式（LL/LD/DL/DD） |
| 优先级 | 先打包 | 先技术债，再打包 |
| 体积 | 60~90 MB | 28~35 MB |
