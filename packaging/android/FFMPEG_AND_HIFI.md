# 新壳能力补齐说明（FFmpeg + HiFi + 爆音）

> 对应提交 `56e156b`（分支 `fix/android-shell`）。本文描述构建链路、运行链路与验收方法。

## 1. 整体结构

```
GitHub Actions
 ├─ job ffmpeg ── NDK 编 ffmpeg 8.0.1（音频专用，静态单文件）
 │                 └─ 产物 libffmpegbin.so（16KB 页对齐）→ artifact + cache
 └─ job build ─── 下载 artifact → app/src/main/jniLibs/arm64-v8a/
                   └─ gradle assembleDebug → APK
APK 安装
 └─ extractNativeLibs=true → /data/app/<pkg>/lib/arm64/libffmpegbin.so
Python(Chaquopy)
 └─ ffbin.prepare()：① 直接 exec；② 失败 → /system/bin/linker64 <bin>；③ 都挂 → ffmpeg=False
 └─ /api/capabilities → 前端按能力显隐
```

### 为什么必须保留 `useLegacyPackaging = true`

只有「安装时解压到 `nativeLibraryDir`」才有可执行的文件路径。新版对齐打包（不落盘、直接 mmap）会让 exec 这条路彻底断掉。

### ffmpeg 构建参数要点

- 源：ffmpeg **8.0.1**（与历史 p4a 成功构建同版本）
- 只编音频：`--disable-everything` + 显式 decoders/encoders/muxers/parsers
- 解码覆盖 `.flac/.wav/.aif/.mp3/.m4a/.aac/.ogg/.opus/.ape/.wv/.dsf/.dff`
- 编码只保留 `flac / aac(m4a) / alac / pcm_*`，**不含 mp3/ogg/opus**（需要外部库，产品侧已移除对应选项）
- `--disable-network --disable-avdevice --disable-swscale --disable-zlib`
- `-Wl,-z,max-page-size=16384`（Android 15 的 16KB 页要求）

## 2. 能力自检与接口

`GET /api/capabilities` 返回：

```json
{
  "ffmpeg": true,
  "mode": "native",          // native | linker64 | system | unavailable
  "version": "ffmpeg version 8.0.1 ...",
  "formats": ["flac", "m4a", "wav", "aif"],
  "encoders": ["aac", "alac", "flac", "pcm_s16le", "..."],
  "hifi": true,
  "notification": true,
  "error": ""
}
```

启动时 `ffbin.prepare()` 会把同样的信息写进 `ac2.log`（`ffbin: mode=... version=...`）。

前端在初始化时拉一次：
- `ffmpeg=false` → 转换单选项禁用，格式下拉显示「当前包不含 ffmpeg」；
- 格式下拉按 `formats` 裁剪，不出现点了必失败的选项。

## 3. HiFi 播放（Media3）

- `PlaybackService`（`MediaSessionService` + `ExoPlayer`），manifest 里声明
  `foregroundServiceType="mediaPlayback"`，通知栏 / 锁屏 / 后台播放交给 Media3；
- `AudioCpmBridge` 提供 `play/pause/resume/stop/seek/state/spectrum`，Python 侧
  `native_bridge` 用 Chaquopy 的 `jclass` 调用（Termux 仍走 jnius）；
- `MediaSession.setSessionActivity` 指向 `MainActivity`，点通知回 app；
- `onTaskRemoved` 留空：从最近任务划掉后继续播放；
- 权限：`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`、`POST_NOTIFICATIONS`（33+ 运行时申请）。

### 频谱只有一条路径

`SpectrumProcessor` 挂在 `DefaultAudioSink` 上读 PCM（1024 点 FFT / 64 band），
前端 100ms 轮询 `/api/playback/spectrum`。

> 旧实现 `super.queueInput(inputBuffer)` 不消费输入缓冲区，会丢音频；已改为
> `replaceOutputBuffer(size)` + `out.put(inputBuffer)` 的原样透传。

## 4. 爆音的三个来源与处理

| 来源 | 处理 |
|---|---|
| `createMediaElementSource(Player.audio)` + `connect(destination)` 把主播放链路拉进 WebAudio（Android WebView 重采样、切后台限流 → 咔哒/断续） | **移除**。频谱只在 HiFi（ExoPlayer PCM 旁路）下提供，WebDAV 走 WebView 时不再接管音频 |
| 自定义 AudioProcessor 不透传 | 已按 Media3 规范改为透传 |
| 切歌/seek 的瞬态 | `setSkipSilenceEnabled(false)`；播放前先停 Web 播放，避免两路同时出声 |

## 5. 验收清单（真机）

1. 打开 app：顶部按钮可点，无遮挡；
2. 授权后 `/sdcard` 能列文件、能播放；
3. 波形、封面正常（ffmpeg 生效的直接证据）；
4. 转换 FLAC / M4A / WAV / AIFF 各一次成功；
5. 播放本地无损：HiFi 出声、进度正常；
6. 通知栏出现播放控制，锁屏可控；
7. 切后台连续播放 10 分钟不断；
8. 开频谱 / 关上再开、切歌、seek：无爆音；
9. `ac2.log` 里应有 `ffbin: mode=native` 或 `mode=linker64`。

## 6. 排障

- `ac2.log` 出现 `ffbin: ffmpeg unavailable: direct=...` → 说明 nativeLibraryDir 里的文件没有 x 位且 linker64 也失败；
  此时转换/波形/封面会退化（封面走 mutagen 原图，波形走 MediaCodec/WAV），功能可用性下降但不崩。
- 通知栏不出现 → 检查是否授予了通知权限（Android 13+）。
- 服务启动失败 → `logcat -s Audio-CPM`，以及 `files/ac2_boot.json`。
