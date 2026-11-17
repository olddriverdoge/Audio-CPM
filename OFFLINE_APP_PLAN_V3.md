# Audio-CPM 离线 App 技术方案 v3（波形 / AIFF / 外部播放器修正）

> **打包路线待定（2026-11-15）**：本版默认“Chaquopy/单壳”打包。按最新讨论，打包壳候选改为 WebToApp / python-for-android(webview)，评估见 [PACKAGING_OPTIONS_WEBTOAPP_P4A.md](PACKAGING_OPTIONS_WEBTOAPP_P4A.md)。业务层方案（波形/AIFF/元数据/WebDAV）不受影响，差异只在启动器与 FFmpeg 二进制路径。

> 本版推翻 v2 的三处降级判断，并按“本地必须保留、WebDAV 可砍”重新划范围：
> - **本地波形不能砍** → 用 Android 系统解码器（MediaCodec）+ 纯 Python 容器解析替代 ffmpeg；
> - **AIFF 可以播放** → 纯 Python 把 AIFF 转封装成 WAV（无损、不重编码），交给 WebView 播；
> - **外部播放器保留**（仅本地模式）→ Android Intent + FileProvider，不是技术难点；
> - **WebDAV 收缩为只读优先**：浏览 / 元数据 / 流式播放 / 基础上传下载；波形、转换、标签写全部不做；
> - **WebDAV 写权限用 PROPFIND 的 `current-user-privilege-set` 判断**，不靠猜；
> - 目的：app 内不引入 FFmpeg、不引入 native 解码库，仍能保住“本地文件管理 + 元数据 + 无损播放 + 波形”。

---

## 0. 最终结论（一张表）

| 能力 | 本地（app） | WebDAV（app） | 实现 | 依赖 |
|---|---|---|---|---|
| 浏览 / 搜索 / 排序 | ✓ | ✓ | os / PROPFIND | 无 |
| 元数据（标题/艺术家/采样率/位深/封面） | ✓ | ✓ | **mutagen**（WebDAV 用 Range 读头尾） | 纯 Python |
| 标签编辑 | ✓ | ✗（砍） | mutagen 原地写 | 纯 Python |
| 播放 FLAC / WAV / MP3 / AAC / OGG / OPUS | ✓ | ✓ | WebView `<audio>` 原生解码 | 系统 |
| 播放 AIFF / AIFF-C PCM | ✓ | ✗（可后置） | **纯 Python 转封装 WAV** → WebView | 标准库 |
| 播放 ALAC / APE / DSD / WV | ✗ | ✗ | 不做（提示） | — |
| 外部播放器（本地文件） | ✓ | ✗ | Intent + FileProvider（Kotlin 桥） | 系统 |
| **波形** | ✓ | ✗（砍） | **MediaCodec 解码 + 分桶**（Kotlin 桥）；WAV/AIFF 纯 Python | 系统 |
| 频谱（实时） | ✓ | ✓ | WebAudio（前端） | 系统 |
| 移动 / 重命名 / 删除 / 新建目录 | ✓ | ✓（授权写） | os / MOVE / DELETE / MKCOL | 无 |
| 本地上传 WebDAV / 下载到本地 | ✓ | ✓（授权写） | 流式 PUT / GET | 无 |
| 格式转换 | ✗ | ✗ | 不做（Termux/PC Pro） | — |
| 替换封面 | ✗（可后置 mutagen 版） | ✗ | 不做 | — |

APK 体积估算：**30~35 MB**（Python 3.14 + 纯 Python 依赖 + 前端；无 ffmpeg、无 native 解码库）。

---

## 1. 播放子系统

### 1.1 播放路径（统一走 `<audio>`）

```
前端 <audio src="/api/stream?path=<uri>">
   │
   ├─ local:  FileResponse（原生 Range / 206）
   ├─ local + .aif/.aiff:
   │      纯 Python 解析 AIFF → 生成 WAV 缓存文件 → FileResponse（audio/wav）
   └─ dav:    Range 代理（httpx 透传 Range，不落盘，206）
```

- 前端 `player.js` 只拼 `/api/stream?path=`，不需要为 AIFF 改逻辑（后端按扩展名处理，返回 `audio/wav`）。
- 外部播放器入口在选中本地文件时显示；WebDAV 文件不显示（capability 控制）。
- 播放“简单”原则：**FLAC/WAV 不转码、不重采样、不引入第三方解码器**；只有 AIFF 做“容器换封装”。

### 1.2 格式支持矩阵

| 格式 | WebView 直接播放 | 后端处理 | 说明 |
|---|---|---|---|
| FLAC（16/24-bit） | ✓ | 无 | Chromium 支持；高采样率由系统重采样输出 |
| WAV（PCM 16/24-bit） | ✓ | 无 | — |
| MP3 / AAC(M4A) / OGG / OPUS | ✓ | 无 | — |
| **AIFF / AIFF-C（NONE/sowt/fl32）** | ✗ | **转 WAV 缓存** | 纯 Python；PCM 重封装无损（float 转 24-bit 会量化） |
| AIFF-C 压缩（ima4/GSM 等） | ✗ | 提示不支持 | 需要解码器，不做 |
| ALAC | ✗ | 提示不支持 | Chromium 不支持；转码放 Termux/PC |
| APE / DSD / WV | ✗ | 提示不支持 | 需要解码器，不做 |

> 音质：FLAC/WAV/AIFF 都是无损解码；输出到 Android 系统音频栈（可能混音/重采样），不承诺 bit-perfect 直通。这是系统限制，不是功能缺失。

### 1.3 AIFF → WAV（纯 Python，不重编码）

#### 格式解析

AIFF 是 IFF 结构：`FORM` + `AIFF`/`AIFC`，需要读两个 chunk：

```
FORM <size> AIFF|AIFC
  COMM <size>: channels(2)  numSampleFrames(4)  sampleSize(2)  sampleRate(80-bit extended)
               [AIFC 额外: compressionType(4) + compressionName(pstr)]
  SSND <size>: offset(4)  blockSize(4)  <PCM 数据>
```

要点：

- 采样率是 80-bit IEEE 754 extended（不是 float32），要写一个 20 行转换函数；
- 数据默认**大端有符号 PCM**；AIFF-C 的 `sowt` 表示小端 PCM（常见于 macOS 导出）；
- 8-bit AIFF 是有符号，WAV 8-bit 是无符号（转换时 `+128`）；16/24/32-bit 保持位深；
- `fl32`/`FL32` 是 float32 → WAV 用 `format=3`（IEEE float）；
- 只支持 PCM 类压缩；`ima4`/`GSM`/`ALAW` 等直接返回“暂不支持”。

#### 转 WAV + 缓存

```
输入: /sdcard/Music/x.aiff
输出: $AC2_DATA_DIR/cache/aiff/<md5(path|mtime|size)>.wav
流程: 读 COMM/SSND → 写 RIFF/WAVE（fmt + data）→ 数据块按字节序转换 → 原子 replace
```

- 转换是纯 IO（200 MB 文件约 1~2 秒），不需要编码器，音质 100% 保持；
- 缓存命中直接 `FileResponse`；mtime/size 变化自动失效；
- 临时文件 `.part` + `os.replace`，避免半截文件；
- 大文件占磁盘：设置缓存上限（如 2 GB，LRU 清理）。

#### 80-bit extended 采样率解析（关键小函数）

```python
def _extended_to_float(b: bytes) -> float:
    """AIFF COMM 里的 sampleRate 是 80-bit IEEE extended。"""
    exp  = ((b[0] & 0x7F) << 8) | b[1]
    mant = int.from_bytes(b[2:10], "big")
    sign = -1.0 if (b[0] & 0x80) else 1.0
    if exp == 0 and mant == 0: return 0.0
    if exp == 0x7FFF: return sign * float("inf")
    return sign * mant * 2.0 ** (exp - 16383 - 63)
```

- 常见值：44100 → `b"\x40\x0e\xac\x44\x00\x00\x00\x00\x00\x00"`；48000 → `0x400e bb80...`；
- 写完 WAV 头后用 `wave` 模块回读校验，避免字节序错误。

#### 播放兼容性

- WAV PCM 16/24-bit 在 WebView 可播；32-bit float WAV 的兼容性不稳定，统一转成 24-bit PCM（有量化，但 float 母带通常源自 24-bit，误差可忽略）。
- 若转换失败：返回 `415` + 明确原因，前端 toast。

### 1.4 外部播放器（仅本地）

```
选中本地文件 → 点 ↗ → POST /api/play {path, player?, activity?}
   ├─ app 内（Android）：Kotlin Ac2ExternalPlayer.open(path, pkg, activity)
   │     FileProvider.getUriForFile(...) → content://
   │     Intent(ACTION_VIEW).setDataAndType(uri, mime)
   │       .addFlags(FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK)
   │     setPackage(pkg) / setComponent(activity)（可选）
   └─ Termux/服务端：保持现有 am start（不变）
```

实现要点：

- **必须用 FileProvider**：Android 7+ 禁止 `file://` 跨应用；`AndroidManifest` 配 `<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.fileprovider" android:exported="false" android:grantUriPermissions="true">` + `<external-path name="sdcard" path="."/>`（有 MANAGE_EXTERNAL_STORAGE 时可用）。
- MIME 映射：`.flac→audio/flac`、`.wav→audio/wav`、`.aif/.aiff→audio/aiff`、`.mp3→audio/mpeg`、`.m4a→audio/mp4`、`.ogg→audio/ogg`、`.opus→audio/opus`。
- 用户指定包名/Activity：`setPackage`/`setComponent`；需要在 `<queries>` 里声明 `ACTION_VIEW + audio/*`，否则 Android 11+ 的包可见性会查不到。
- 无播放器/无权限：返回 `{status:"error", message:"未找到可处理该格式的播放器"}`，前端提示。
- WebDAV 文件：不显示 ↗（capability 控制）；不下载后播放（避免“无脑降级”）。
- Termux 版继续 `am`，两者共用 `/api/play` 接口，前端无感。

### 1.5 WebDAV 流式播放（Range 代理，不落盘）

```python
@router.get("/api/stream")
async def stream(path: str, request: Request):
    src = parse_uri(path)
    if src.kind == "local":
        if ext in (".aif", ".aiff"): return await aiff_to_wav_response(src)
        return FileResponse(src.local_path)
    rng = request.headers.get("range")
    up = await dav.open_range(src, rng)          # httpx.AsyncClient.stream("GET", ...)
    return StreamingResponse(up.aiter_bytes(),
        status_code=206 if rng else 200,
        headers={"Accept-Ranges": "bytes",
                 "Content-Range": up.headers.get("content-range", ""),
                 "Content-Length": up.headers.get("content-length", "")})
```

- 上游不支持 Range：返回 200 整流 + `X-Audio-CPM-Range: unsupported`，前端提示“该服务器不支持拖动”；
- 超时：connect 10s / read 30s；GET 幂等，断线可重试一次；
- 不缓存音频文件；只缓存元数据/封面。

### 1.6 锁屏/通知栏（可接受暂不做，但不是难点）

- WebView 的 MediaSession 在 WebView 中通常不显示通知；要做的话是原生 `MediaSessionCompat` + 通知 + JS Bridge 同步播放状态，约 100~150 行 Kotlin；
- 首版不做，列入 P2；不影响“无损播放”。

---

## 2. 波形子系统（本地必须保留）

### 2.1 结论：用 Android MediaCodec，不用 ffmpeg

| 方案 | 覆盖 | 体积 | 工作量 | 结论 |
|---|---|---|---|---|
| ffmpeg 可执行文件 | 全格式 | +30MB | exec 限制，不可行 | ✗ |
| ffmpeg-kit（JNI） | 全格式 | +30MB | 中 | 备选（体积换兼容） |
| **Android MediaCodec + 纯 Python** | FLAC/MP3/AAC/OGG/OPUS/WAV/AIFF | 0 | 中（Kotlin 桥 150 行） | **主方案** |
| libsndfile（NDK 编译） | WAV/AIFF/FLAC/OGG/MP3 | +2MB | 高（交叉编译） | 备选 |
| 纯 Python 解码 FLAC | 全格式 | 0 | 性能不可接受（整曲几十秒） | ✗ |

**设计：**

- FLAC / MP3 / M4A(AAC) / OGG / OPUS → Kotlin `AudioCpmWave.peaks(path, buckets)`，用 `MediaExtractor` + `MediaCodec` 解码，按 `presentationTimeUs` 分桶，返回每桶峰值（0~1，未归一化）；
- WAV / AIFF（转 WAV 后）→ **纯 Python** 解析 PCM（标准库 `wave` + `array`，8:1 抽样），原因：Android 的 WAV/raw 解码器对 24-bit/float 支持不稳定，纯 Python 反而更可控；
- Python 侧统一做现有归一化（20% 分位拉伸，与 [backend/waveform.py](backend/waveform.py) 一致）→ 视觉与 Termux 版完全一致；
- 缓存 key/格式不变：`md5(v2|uri|mtime|size|buckets)` → `$AC2_DATA_DIR/cache/wave/*.json`，内存 LRU 60 条（沿用）。

### 2.2 MediaCodec 桥实现（Kotlin，约 150 行）

```kotlin
object AudioCpmWave {
    /** 返回 {"ok":true,"peaks":[0.12,...]} 或 {"ok":false,"error":"..."} */
    @JvmStatic fun peaks(path: String, buckets: Int): String {
        val extractor = MediaExtractor()
        extractor.setDataSource(path)
        // 选第一个 audio track
        val format = ...
        val mime = format.getString(MediaFormat.KEY_MIME)          // audio/flac, audio/mpeg, ...
        val durationUs = format.getLong(MediaFormat.KEY_DURATION)
        val decoder = MediaCodec.createDecoderByType(mime)
        decoder.configure(format, null, null, 0)
        decoder.start()
        // 同步模式循环：
        //   dequeueInputBuffer → extractor.readSampleData → queueInputBuffer
        //   dequeueOutputBuffer → getOutputBuffer → 按 KEY_PCM_ENCODING 解析
        //   用 bufferInfo.presentationTimeUs / durationUs * buckets 归桶，累加 abs 峰值
        // 输出 float[buckets]（0~1）→ JSON
    }
}
```

- **PCM 编码处理**：`KEY_PCM_ENCODING` 可能是 `ENCODING_PCM_16BIT`（默认）、`ENCODING_PCM_FLOAT`、`ENCODING_PCM_24BIT_PACKED`；分别按 2/4/3 字节读，取绝对值最大；
- **声道**：直接对所有声道取最大值（波形不需要分离）；
- **分桶**：`bucket = min(buckets-1, (presentationTimeUs * buckets / durationUs))`；duration 缺失时退化为按样本数动态分桶；
- **内存**：只保留 `buckets` 个 float + 一个输出 buffer，不缓存整曲 PCM；
- **异常**：解码器不支持/文件损坏 → 返回 `ok:false`，Python 回退（见 2.5）。

### 2.2.1 Python 调用桥

```python
from java import jclass
_Wave = jclass("com.ac2.app.AudioCpmWave")

def peaks_android(path: str, buckets: int) -> list:
    d = json.loads(_Wave.peaks(path, buckets))   # 阻塞 JNI 调用，放在任务线程
    if not d.get("ok"):
        raise RuntimeError(d.get("error") or "decode failed")
    return d["peaks"]        # 0~1 未归一化，交给 waveform.py 的 20% 分位逻辑
```

- 调用发生在 FastAPI/Starlette 的线程池里，不会阻塞事件循环；
- `AudioCpmWave.peaks` 内部捕获所有异常并返回 JSON，不让 JNI 抛到 Python。

### 2.3 WAV / AIFF 纯 Python 波形

- `wave` 模块读参数与帧；`array('h')`（16-bit）或手动 24-bit 解析；
- 抽样步长 `step = max(1, total_frames // (buckets * 64))`，保证每桶至少 64 个采样点，速度约 1~2 秒/5 分钟曲（纯 Python 可接受）；
- AIFF 先复用 §1.3 的解析器（不生成 WAV 也能直接读 SSND 数据）；
- 输出同样走 Python 归一化。

### 2.4 接口与缓存（不变）

- `GET /api/waveform?path=&buckets=` 行为不变；WebDAV 源返回 `501`（前端隐藏波形按钮/不请求）；
- 缓存目录从 `$TMPDIR/ac2web_wave` 改到 `$AC2_DATA_DIR/cache/wave`（app 内 TMPDIR 不可靠）；
- 缓存命中逻辑、内存 LRU、20% 分位归一化全部沿用。

### 2.5 失败回退（必须设计，但不必默认启用）

| 失败场景 | 回退 |
|---|---|
| MediaCodec 不支持某编码（罕见） | 返回 `501`，前端显示“该格式波形不可用”；不阻塞播放 |
| FLAC 24-bit 解码异常 | 同上；实测若高发，启用 ffmpeg-kit-audio 仅波形（+30MB） |
| AIFF-C 压缩格式 | 提示不支持 |
| 设备解码器缺失 | 同上 |

> 如果真机实测 MediaCodec 覆盖率不足，**备选方案是 ffmpeg-kit-audio 只做波形解码**（JNI，不需要 exec，16KB 已对齐），代价是 +30MB；这是“体积换兼容”的开关，不是主方案。

### 2.6 波形 PoC 验收（W1 必做）

1. 用 Termux ffmpeg 生成测试集：FLAC 16/44.1、FLAC 24/96、MP3 320、M4A、OGG、OPUS、WAV 16/24、AIFF 16/24、AIFF-C sowt；
2. 真机跑 `AudioCpmWave.peaks`，与 Termux 版 `/api/waveform` 对比 160 桶曲线（允许 5% 误差）；
3. 5 分钟 FLAC 解码耗时 < 3 秒、内存峰值 < 50 MB；
4. WAV/AIFF 纯 Python 路径耗时 < 3 秒；
5. 缓存命中 < 50 ms。

---

## 3. Python 有没有开源的 FFmpeg 平替？

### 3.1 调研结论表

| 方案 | 类型 | 能力 | Android/Chaquopy 可用性 | 结论 |
|---|---|---|---|---|
| ffmpeg-python / pydub / imageio-ffmpeg | 包装器 | 调 ffmpeg 二进制 | ❌（app 不能 exec） | 不是替代 |
| **PyAV** | libav* 绑定 | 全功能转码/解码 | ❌ 无 Android wheel；自编译 FFmpeg 全量库，极重 | 不现实 |
| **soundfile（libsndfile）** | native C 库 | WAV/AIFF/FLAC/OGG/MP3 解码；WAV/AIFF/FLAC 编码 | ❌ 无 Android wheel；可 NDK 编译（+2MB） | 中期可选 |
| **miniaudio** | 单头文件 C | WAV/FLAC/MP3/Vorbis 解码；WAV 编码 | ❌ 无 wheel；可编译 | 中期可选 |
| pyflac | libFLAC 绑定 | FLAC 编解码 | ❌ 需编译 | 不推荐 |
| **纯 Python WAV/AIFF** | 标准库/手写 | PCM 容器读写、字节序转换 | ✅ | **采用（AIFF→WAV）** |
| 纯 Python FLAC 解码 | 第三方 | 解码 | ✅ 但慢 10~50 倍 | ❌ 波形改用 MediaCodec |
| **Android MediaCodec** | 系统 API | FLAC/MP3/AAC/OGG/OPUS 解码；FLAC 编码视设备 | ✅ | **采用（波形）** |

**结论：不存在“pip 装上就能替代 FFmpeg”的开源库。** 原因：

1. 转码的核心是编解码器（libavcodec/FLAC/MP3/AAC），纯 Python 性能差一个数量级；
2. native 库（soundfile/miniaudio/PyAV）都没有 Android wheel，必须交叉编译；
3. Android 自带的编解码器（MediaCodec）恰好覆盖主流音频，且零体积——这是 Android 上最合理的“平替”。

### 3.2 “间接实现转换”能做到什么

| 需求 | 可行性 | 方案 |
|---|---|---|
| AIFF → WAV | ✅ 无损、纯 Python | PCM 容器重封装（§1.3） |
| WAV → AIFF | ✅ 无损、纯 Python | 反向封装（大端） |
| PCM 位深/声道转换（简单） | ✅ 纯 Python（可能量化） | 手动重排 |
| WAV/AIFF → FLAC | ❌ 纯 Python 不可行 | MediaCodec FLAC 编码（设备相关）或 Termux/PC |
| FLAC → WAV | ⚠️ 需解码 | MediaCodec 解码 + 写 WAV（可做，但收益低） |
| MP3/AAC → 其它 | ❌ | Termux/PC |
| APE/DSD/WV → 其它 | ❌ | 仅 FFmpeg |

**建议**：app 内只做“AIFF→WAV 播放”这一种无损封装；转 FLAC 继续放在 Termux/PC（用户本来就计划 AIF 后续转 FLAC）。不在 app 内做编码，避免引入 native 编解码器。

### 3.3 如果以后确实要在 app 内转 FLAC

按性价比排序：

1. **MediaCodec FLAC 编码**（0 体积，但设备支持不稳定，需实测）；
2. **libsndfile**（+2MB，FLAC 编码质量/兼容性好，需 NDK 编译 + ctypes 调用）；
3. **ffmpeg-kit-audio**（+30MB，最稳，全格式，JNI 调用）；
4. 不做，交给 Termux/PC。

---

## 4. 元数据 / 标签 / 封面（沿用 v2，修正细节）

- **读取**：mutagen `File(easy=True)` + 各格式 `info`；输出结构与现有 `probe_file_detail()` 对齐（顶层 `tags`、`audio`、`has_cover`）；
- **WebDAV**：`HttpRangeFile`（seekable file-like）按 64KB 块 Range 读取，只读头/尾；缓存 `(etag, size) → JSON`；
- **封面**：FLAC `pictures` / ID3 `APIC` / MP4 `covr` / OGG `METADATA_BLOCK_PICTURE`；列表优先同目录图片，内嵌图按需取；**不做服务端缩放**，返回原图 + 前端 CSS 缩放（缓存按真实 MIME 存扩展名）；
- **标签写入**：仅本地；`copy → 改 → 校验 → os.replace`（保留原文件直到成功）；不支持/校验失败则不动原文件；
- **检查标签 / 整理标签**：本地可用（mutagen 扫描 + 文件改名），WebDAV 不做；
- **字段归一化**：复用 [backend/ffmpeg.py](backend/ffmpeg.py) 的 `clean_text`（注意它现在放在 ffmpeg.py，不是 jobs_core.py）。

---

## 5. WebDAV 设计（范围收缩）

### 5.1 保留 / 砍掉

| 功能 | WebDAV | 理由 |
|---|---|---|
| 浏览（PROPFIND Depth:1） | ✓ | 基础 |
| 元数据（Range + mutagen） | ✓ | 不下载整文件 |
| 播放（Range 代理） | ✓ | 流式，不缓存 |
| 封面（同目录图 / 内嵌图 Range） | ✓ | 按需 |
| 下载到本地 | ✓ | 基础互通 |
| 上传到远端（授权后） | ✓ | 基础互通 |
| 移动 / 重命名 / 删除 / 新建目录（授权后） | ✓ | 标准 MOVE/DELETE/MKCOL |
| 波形 | ✗ | 需要整曲解码，砍（用户允许） |
| 标签编辑 | ✗ | 需下载整文件再上传，砍 |
| 转换 / 封面替换 / 批量任务 | ✗ | 砍 |
| 外部播放器 | ✗ | 无本地文件 |
| 锁屏控制 | ✗ | 与存储无关，首版不做 |

### 5.2 写权限判断（回答“PROPFIND 能不能判断”）

**能，但要分三级，不能只靠一次 PROPFIND：**

1. **首选 RFC 5397 `current-user-privilege-set`**（Nextcloud/ownCloud 支持）：

```xml
PROPFIND /dav/Music/ Depth: 0
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-privilege-set/></d:prop>
</d:propfind>
```

返回里找 `d:privilege/d:write`、`d:write-content`、`d:write-properties`；有 → 可写，没有 → 只读。

2. **次选 `OPTIONS` 的 `Allow` 头**：包含 `PUT`/`MOVE`/`DELETE`/`MKCOL` → 标记“可能可写”（服务器可能仍按路径授权）；
3. **兜底**：默认只读；用户打开“允许写入”后，第一次写失败（403/405）→ 自动降级为只读并提示“服务器未授权写入”。

> 注意：`PROPFIND` 成功只证明“可读”，不能证明“可写”；有些服务器对根目录返回可写，对子目录不可写。所以按“目录级”缓存权限结果，写失败时更新。

#### 解析示例

```python
PROPFIND_BODY = """<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-privilege-set/></d:prop></d:propfind>"""

resp = await client.request(
    "PROPFIND", url,
    headers={"Depth": "0", "Content-Type": "application/xml"},
    content=PROPFIND_BODY)
root = ET.fromstring(resp.content)
privs = {p.tag.split("}")[-1] for p in root.iter("{DAV:}privilege")}
write_ok = bool(privs & {"write", "write-content", "write-properties"})
```

- 有些服务器对 `current-user-privilege-set` 返回 404 或空 → 走 `OPTIONS`；
- 把结果按“目录”缓存（权限可能逐级不同），写失败时刷新该目录。

### 5.3 只读 / 授权写

- 连接配置 `readonly=true` 默认；UI 有“允许写入（需服务器授权）”开关；
- 只读时：写按钮禁用，`/api/transfer` 的目标为 dav 时直接拒绝；
- 401（凭据错）→ 提示重输；403（无权限）→ 本次会话降级只读；405（方法不支持）→ 禁用对应操作（如服务器不支持 MOVE）。

### 5.4 路径与缓存

- URI：`dav:<profile>/<relpath>`；href 解码后去 base、拒绝 `..`、限制在绑定根内；
- 目录缓存 TTL 30~60s + 手动刷新；元数据/封面按 ETag 缓存；
- 并发：PROPFIND 串行，下载/上传 2~3 并发。

---

## 6. 四种互通模式（本地 ↔ WebDAV）

| 模式 | 源 → 目标 | 实现 | 备注 |
|---|---|---|---|
| M1 | 本地 → 本地 | `shutil.move` / `os.rename` | 现有 |
| M2 | 本地 → WebDAV | 流式 `PUT` 临时名 + `MOVE` 覆盖 | 上传 |
| M3 | WebDAV → 本地 | `GET` 流式 → `.part` → 替换 | 下载 |
| M4 | WebDAV → WebDAV | 同 profile `MOVE`/`COPY`；跨 profile 下载+上传 | 远端整理 |

- 动作：copy / move；冲突：skip / rename / overwrite；
- 目录递归：逐层 PROPFIND；跨存储目录“复制成功再删源”；
- 只读守卫：目标 dav 且 readonly → 直接拒绝；
- 进度：SSE（阶段 download/upload/delete、文件数、字节数）；可取消；
- 不做：后台同步、镜像、断点续传跨会话、WebDAV LOCK。

---

## 7. 技术债清单（更新版）

| ID | 债务 | 影响 | 改法 | 优先级 |
|---|---|---|---|---|
| T1 | `path` = 本地绝对路径 | WebDAV/打包 | `PathRef` URI + StorageProvider | P0 |
| T2 | 配置写项目根 | app 只读崩溃 | `AC2_DATA_DIR` | P0 |
| T3 | 前端硬编码 `/sdcard/ADM` | app/WebDAV | `/api/roots` + 数据源选择 | P0 |
| T4 | 元数据依赖 ffprobe | app 无 ffmpeg | `meta.py`：mutagen 优先，ffprobe 回退 | P0 |
| **T4b** | 波形依赖 ffmpeg | app 无 ffmpeg | 本地 MediaCodec 桥 + WAV/AIFF 纯 Python；WebDAV 不做 | P0 |
| **T4c** | AIFF 不能播放 | 用户有 AIF | 纯 Python AIFF→WAV + 缓存 | P0 |
| T5 | 外部播放器依赖 am | app 无 am | 本地保留：Kotlin Intent + FileProvider；WebDAV 隐藏 | P1 |
| T6 | 无传输任务/取消 | 4 种互通 | `TransferTask` + SSE + 取消 | P1 |
| T7 | 无权限/只读模型 | app/WebDAV | MANAGE_EXTERNAL_STORAGE；WebDAV readonly + 权限探测 | P0 |
| T8 | capability 是全局的 | 不同源能力不同 | `/api/capabilities` **按 source 返回**（本地 vs dav） | P1 |
| T9 | 无鉴权 | 局域网风险 | 随机 token（壳注入） | P2 |
| T10 | FastAPI + pydantic 不能进 Chaquopy | 打包 | 迁 Starlette（或双适配器） | P0（打包前） |
| T11 | 配置无 schema | 升级 | `schema_version` + 迁移 | P2 |
| T12 | 缺 pytest/CI | 质量 | pytest + jsdom + CI | P1 |
| **T13** | 无 Android 原生桥 | 波形/播放器 | Kotlin 桥：`AudioCpmWave`、`Ac2ExternalPlayer`、权限引导 | P0 |

依赖顺序：

```
T2/T3/T5 ─▶ T1 ─▶ T4/T4b/T4c ─▶ T8 ─▶ T6 ─▶ T7 ─▶ 打包
                     │
                     └─▶ T13（Kotlin 桥）─▶ T10（Starlette）─▶ Chaquopy PoC
```

---

## 8. 架构与打包

### 8.1 组件图

```
Android Activity / 前台服务
 ├─ WebView ── http://127.0.0.1:<随机端口>
 ├─ Python（Chaquopy）：Starlette + uvicorn + mutagen + httpx
 │     ├─ storage/local.py / dav.py
 │     ├─ meta/mutagen_io.py（含 HttpRangeFile）
 │     ├─ waveform_local.py（调 Kotlin 桥 / 纯 Python WAV）
 │     └─ transfer.py（4 模式）
 └─ Kotlin 桥
       ├─ AudioCpmWave.peaks(path, buckets)          MediaCodec 解码
       ├─ Ac2ExternalPlayer.open(path, pkg, act) Intent + FileProvider
       └─ Ac2Permission.ensureAllFilesAccess()  权限引导
```

### 8.2 依赖与体积

- Python 3.14（Chaquopy 17.2）；pip：starlette、uvicorn（无 `[standard]`）、httpx、mutagen、anyio、h11、click、certifi、idna、sniffio（全纯 Python）。
- 无 ffmpeg、无 ffmpeg-kit、无 native 解码库；Kotlin 桥只用系统 API。
- 体积：30~35 MB（arm64-v8a 单 ABI）。

### 8.3 权限与 WebView

- 权限：`INTERNET`、`MANAGE_EXTERNAL_STORAGE`、`READ_MEDIA_AUDIO`（13+，降级用）、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_DATA_SYNC`；首启引导“所有文件访问”。
- WebView：`setJavaScriptEnabled`、`setDomStorageEnabled`、`setMediaPlaybackRequiresUserGesture(false)`、`setAllowFileAccess(false)`；`network-security-config` 放行 127.0.0.1 + 局域网（WebDAV http）。
- 前台服务 `dataSync` 保活；WebView 全屏 `onShowCustomView`；返回键拦截。
- 配置文件/缓存：`AC2_DATA_DIR = filesDir`（预设、UI 配置、波形/封面/元数据缓存）。

### 8.4 构建

- PC 上 Android Studio（推荐，调试快）；CI 出包（GitHub Actions，3~6 分钟）。
- Gradle：`sourceSets["main"].assets.srcDirs("../../frontend")`；`chaquopy.sourceSets.main.srcDir("../../backend")`；`abiFilters += "arm64-v8a"`。
- `buildPython` 指向 PC 的 Python 3.14；`pyc { src = true }`。
- 版本：`versionName=tag`，`versionCode=run_number`；固定 keystore。

---

## 9. 关键接口契约

### 9.1 `/api/roots`（新增）

```json
{"roots":[
  {"id":"local:/sdcard","kind":"local","name":"本机存储","path":"/sdcard",
   "caps":["browse","meta","play","waveform","tags_write","external_player","move","delete","mkdir"]},
  {"id":"dav:nas","kind":"dav","name":"NAS","path":"/dav/Music",
   "caps":["browse","meta","play","download","upload","move","delete"],
   "readonly":true}
]}
```

### 9.2 `/api/waveform`（行为不变，新增 source 限制）

- `local`：Kotlin 桥（压缩格式）或纯 Python（WAV/AIFF）→ 归一化 → 缓存；
- `dav`：`501 {"detail":"waveform not supported for webdav"}`。

### 9.3 `/api/stream`（新增 AIFF/WebDAV 分支）

- `local .aif/.aiff` → `audio/wav`（缓存）；
- `dav` → 206/200 代理，附 `Accept-Ranges`、`X-Audio-CPM-Range`。

### 9.4 `/api/play`（本地保留）

- app：Kotlin 桥 Intent；Termux：`am`；dav：`{"status":"blocked","message":"WebDAV 文件不支持外部播放器"}`。

### 9.5 `/api/transfer`（新增）

```json
{"sources":["local:/sdcard/a.flac"],"target":"dav:nas/Music","action":"move",
 "conflict":"rename"}
→ {"task_id":"...","stream":"/api/transfer/{id}/stream"}
```

事件：`{phase:"download|upload|delete", file, index, total, bytes}`、`done`、`error`。

### 9.6 错误码约定

| 场景 | 返回 |
|---|---|
| WebDAV 只读时写 | `403 {"error":"readonly_source"}` |
| 服务器无权限 | `403 {"error":"server_forbidden"}` |
| 方法不支持 | `405 {"error":"method_not_allowed","method":"MOVE"}` |
| AIFF 压缩格式 | `415 {"error":"aiff_compressed_unsupported"}` |
| 波形不支持 | `501 {"error":"waveform_unsupported"}` |

---

### 9.7 前端改动点（按文件）

| 文件 | 改动 |
|---|---|
| `index.html` | 顶部加数据源 `<select id="source-select">`；任务面板加传输任务区 |
| `app.js` | `loadRoots()` 替代 `defaultRoot()`；路径带 source 前缀；localStorage 按 source 分键；按 caps 显隐按钮 |
| `api.js` | 新增 `roots()`、`caps()`、`transfer()`；`streamUrl` 接受 URI |
| `browse.js` | 不需要改（仍拿字符串路径），仅按 caps 隐藏“转换/波形/外部播放器” |
| `player.js` | 播放 URL 不变；`↗` 按钮按 caps 显隐；AIFF 无需特殊处理（后端返回 `audio/wav`） |
| `wave.js` | WebDAV 源不请求 `/api/waveform`，画占位条；本地不变 |
| `treeview.js` | 目标根支持 local/dav 两组 tab |
| `settings.js` | 新增 WebDAV 连接管理（URL/用户名/密码/只读开关/自签 CA） |
| `taskrunner.js` | 支持传输任务（SSE 事件里新增 download/upload 阶段） |

> 原则：**接口形状尽量不变**，前端主要改“数据源选择 + 按能力显隐”，不改渲染逻辑。

## 10. 路线图（PoC 前置）

| 周 | 内容 | 验收 |
|---|---|---|
| W1 | T2/T3 + mutagen PoC + **T13 MediaCodec 波形 PoC** + T4c AIFF PoC | 三个 PoC 真机通过（读标签、波形曲线、AIFF 播放） |
| W2 | T4/T4b/T4c 全量 + T5 外部播放器 + Chaquopy 空壳 | 本地元数据/波形/AIFF/外部播放器可用；app 能启动 |
| W3 | T1 存储抽象 + WebDAV 只读 | 双源浏览、Range 播放、Range 元数据、权限探测 |
| W4 | T6 四种互通 + T7 只读/授权写 | 上传/下载/移动/删除、冲突策略、进度/取消 |
| W5 | T8/T10/T12 + 打磨 | per-source caps、Starlette、pytest/CI、发版 |

> 波形 PoC 放在 W1，因为它决定“本地波形能不能保”；AIFF PoC 同理。

---

## 11. 验收清单（app 首版）

1. 首启授权“所有文件访问”→ 浏览 `/sdcard/Music`；
2. 列表元数据正确（标题/艺术家/采样率/位深/时长），封面显示；
3. FLAC 16/44.1、FLAC 24/96、WAV、MP3、M4A、OGG、OPUS 播放 + 拖动；
4. **AIFF 16/24 播放**（转 WAV），AIFF-C sowt 播放，压缩 AIFC 报“不支持”；
5. **本地波形**：FLAC/WAV/AIFF 曲线与 Termux 版一致（±5%），缓存命中；
6. **外部播放器**：本地 FLAC 用 Poweramp 打开成功；WebDAV 文件无该入口；
7. 标签编辑 FLAC/MP3（标题/艺术家/封面）成功，其他播放器可见；
8. 本地移动/重命名/删除/新建目录；
9. WebDAV 只读：浏览、元数据、流播放、拖动；波形/转换入口隐藏；
10. 开启写后：上传/下载/移动/删除成功；403 自动降级只读提示；
11. 杀进程重开：配置/缓存/权限保持；断网时本地不受影响。

---

## 12. 风险与待确认

| 风险 | 等级 | 应对 |
|---|---|---|
| MediaCodec 对 FLAC 24-bit 输出格式差异 | **高** | W1 真机验证；失败回退 ffmpeg-kit-audio 仅波形（+30MB） |
| MediaCodec 对 OGG/OPUS 支持因设备而异 | 中 | 测试矩阵；失败提示 |
| AIFF-C 压缩变体 | 中 | 只支持 NONE/sowt/fl32；其余明确报错 |
| AIFF 转 WAV 占磁盘 | 低 | 缓存上限 + LRU |
| FileProvider 对 `/sdcard` 的兼容 | 中 | 真机验证；备选 MediaStore URI |
| Chaquopy + uvicorn 端口/线程 | 中 | W2 PoC；随机端口 + 重试 |
| Starlette 迁移回归 | 中 | 契约快照 + 现有回归 |
| WebDAV 权限探测服务器差异 | 中 | 三级探测 + 写失败降级 |
| 无锁屏控制 | 低 | 用户接受；P2 原生 MediaSession |

待确认（不影响 W1 开工）：

1. 标签编辑是否必须（若只读，可省 T4 写标签部分）；
2. AIFF 是否只要“能播放”，不要求 app 内转 FLAC（当前方案：只转 WAV）；
3. WebDAV 是否只做“浏览/播放/上传/下载”，移动/删除也够用即可。

---

## 附录：与 v2 的差异

| 项 | v2 | v3 |
|---|---|---|
| 本地波形 | 砍 | **保留**（MediaCodec + 纯 Python WAV/AIFF） |
| AIFF 播放 | 不支持 | **支持**（纯 Python 转 WAV） |
| 外部播放器 | 砍 | **保留（仅本地）** |
| WebDAV 波形 | 砍 | 砍（确认） |
| WebDAV 写权限 | 只读开关 | PROPFIND privilege-set + OPTIONS + 写失败降级 |
| Python FFmpeg 平替 | 未调研 | 完整调研（无可直接用；MediaCodec 是正解） |
| APK 体积 | 28~35 MB | 30~35 MB（Kotlin 桥不增体积） |
| 新增 Kotlin 桥 | 无 | AudioCpmWave / Ac2ExternalPlayer / 权限引导 |
