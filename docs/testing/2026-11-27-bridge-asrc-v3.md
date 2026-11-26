# 桥接采样（ASRC）测试 V3 —— 工程落地验收（基线 0.5.24/104）

## 0. 版本定位

- V1：静态重采样音质矩阵（正弦/扫频/白噪声、SNR/THD/LSD、主观听测、验收门槛）。
- V2：时钟闭环 ASRC、水位调速、块标记透传、双向环回、PID 与风险清单、JSON 报告结构。
- **V3：落到本仓库现有链路、现有测试套件与现有埋点**，明确哪些用 CLI/云端可自动验收、哪些必须真机回归，并列出埋点缺口与补齐落点。

本次为测试方案文档（docs-only）：不改代码、不动 `versionName`/`versionCode`，不单独出包。离线 harness 与真机埋点随后续代码改动落地，届时再递增版本号并出 APK 回归。

## 1. 现有链路与代码位置（现状基线）

播放链路现状（0.5.24/104）：

1. 解码与时钟：`PlaybackService.java` 持有 ExoPlayer/Media3，源格式由 `AudioCpmBridge.sourceFormat()` 读取（`sampleRate`/`channels`/`encoding`）。
2. 重采样/转码 pipeline：`AaudioAudioSink.java` 的 `pipeline`（`queueInput`/`drainPipeline`），重采样发生在进入原生 sink 之前；非直通声道映射会回退默认 sink。
3. 原生输出：`cpp/aaudio_sink.cpp` 的 `nativeOpen`/`nativeWrite`；流采样率取设备输出格式，缓冲帧默认 `sampleRate/12`（约 80ms）。
4. 面板上报：`AudioCpmBridge.audioInfo()` 约 1.5s 一次，现有字段见第 2 节。

云端回归边界（见 `packaging/tests/cloud/README.md`「已知边界」）：云端能证明 HTTP、文件操作、前端交互与任务链路；**不能**覆盖 Media3/ExoPlayer、HiFi 原生输出、音频设备枚举与 AAudio 行为，这些必须真机回归。

## 2. 现有可观测字段 vs 埋点缺口

### 2.1 现有上报字段（`audioInfo()` / `AaudioAudioSink.describe()`）

| 指标 | 现有字段 | 来源 |
| --- | --- | --- |
| 设备原生采样率 | `deviceSampleRate` | AudioManager 属性 / AudioTrack 原生率 / AAudio 实际流率三级兜底 |
| 硬件缓冲帧数 / 估算延迟 | `framesPerBuffer`、`latencyMs` | AudioManager 属性，兜底 `AudioTrack.getMinBufferSize` |
| 源格式 | `sourceFormat.{sampleRate,channels,encoding}` | ExoPlayer `getCurrentTracks` |
| 播放倍速 | `speed` | `getPlaybackParameters().speed` |
| AAudio 流状态 | `aaudio.{active,fallback,sampleRate,channels,encoding,device,inputSampleRate,inputChannels,inputEncoding,exclusive,error}` | `AaudioAudioSink.describe()` |
| 频谱/音效 | `format`、`fx` | `SpectrumProcessor.describe()` / `AudioFx.info()` |

### 2.2 缺口（ASRC 验收必需，当前未上报）

| 指标 | 缺口说明 | 建议落点 |
| --- | --- | --- |
| 缓冲水位 | 均值/min/max/方差、触边时刻 | `AaudioAudioSink` 增加水位统计，纳入 `describe()` |
| underrun / overrun | 次数、发生时刻、触发时水位 | `aaudio_sink.cpp` xrun 计数回传 Java |
| ASRC 实际倍率与漂移 | 实际 `ratio`、长稳 ppm 漂移、调速超调/收敛时间 | pipeline 侧 ASRC 控制器（预留） |
| 块标记完整性 | 标记丢失率、标记偏移样本数、尾块保留 | 模型帧/缓冲元数据队列（预留，见 V2 第 3 节） |
| 双向环回计数 | 播放/录音两侧 ASRC 速率误差叠加 | 录音桥接入后补齐 |
| 回调线程耗时 | 单块处理耗时 P50/P95/P99，确认不阻塞 AAudio 回调 | `aaudio_sink.cpp` 写入路径计时 |
| 真实发送计数 | 累计写入字节/帧数、`nativeWrite` 负返回次数与最近错误、发送后 `framesWritten` 增量 | `AaudioAudioSink` 增加静态计数，纳入 `describe()` |
| XRun 上报 | cpp 已有 `nativeXRunCount`（`AAudioStream_getXRunCount`），Java `describe()` 尚未带出 | `AaudioAudioSink.describe()` 补 `xrunCount` 字段 |

> 缺口字段在真机埋点补齐前，第 3.2 节对应指标只能人工从 logcat 记录，不能作为自动化门禁。

## 3. 测试分层

### 3.1 CLI / 云端离线可自动跑（不依赖真机音频硬件）

对照 `packaging/tests/cloud/` 约定：隔离临时目录、退出码语义（0 全过 / 1 断言异常 / 2 夹具失败）、输出 JSON 报告。建议新 harness 落在 `packaging/tests/bridge/`。

1. **测试信号生成**（ffmpeg，确定性可复现）：
   - 1kHz / 4kHz 正弦、20–20kHz 扫频、白噪声；
   - 源采样率 16000 / 24000；位深 S16 / Float32；声道 Mono / Stereo。
2. **离线重采样质量基准**：
   - 矩阵：`16k/24k → 44.1k/48k`，以及反向 `48k → 16k/24k`；
   - 转换后回采对齐，计算 SNR、THD、LSD、RMS 增益偏差、DC offset、相位/时间偏移；
   - 直通（同速率）作为基线，要求 LSD≈0、样本零修改。
3. **配置/格式静态校验**：采样率 × 位深 × 声道组合在后端/前端不返回 500、不抛未捕获异常。

### 3.2 真机回归（AAudio / ExoPlayer，`audioInfo()` 采集）

沿用 V2 分组，逐条在真机上跑并记录面板/日志数值：

- **A 播放桥**：直通；24k→48k（整数倍基线）；24k→44.1k（非整数倍，漂移高发）；16k→48k；16k→44.1k；运行时热切换 48k↔44.1k；回调帧长扰动（固定/随机小帧/超大帧）。
- **B 录音桥**：48k→24k；44.1k→24k；短时静音、突发大音量、水位过载。
- **C 双向环回**：24k 模型，播放桥与录音桥同时跑，48k 与 44.1k 两组；抓两侧 ASRC 速率误差叠加导致的长时间单调漂移与音调缓偏。
- **D 块边界专项**：正常连续块、短尾块、零样本静音块、跨插值窗口边界、语音→静音→语音快速切换；核对尾音不被吞、不粘连杂音。
- **E 接管模式与真实发送**（`AaudioAudioSink` nativeActive 路径）：
  - *接管前置条件*（`configure()` 判定，全部满足才 `nativeActive=true`）：SDK ≥ 26；采样率/声道有效、声道 ≤ 2；线性 PCM 16BIT/FLOAT；`speed==1.0` 且 `pitch==1.0`；声道映射直通；pipeline 激活；`nativeOpen` 成功且实际 rate/ch/编码与请求一致。
  - *真接管断言*：`audioInfo().aaudio` 为 `active=true`、`fallback=false`、`sampleRate>0`、`error=""`，`device` 为 `AAudio exclusive`/`AAudio shared`；不能出现"面板显示在播但实际走 fallback"。
  - *真实发送校验*：接管后 PCM 经 `pipeline.queueInput → drainPipeline → nativeWrite` 写入原生流（非 direct buffer 先拷 `directScratch`）。当前可观测：播放位置持续推进、`hasPendingData`/`nativePendingFrames` 有硬件队列帧数、无 `WriteException`、logcat 无 fallback 切换记录；埋点补齐后再核对累计写入字节/帧数随播放单调增长、负返回计数为 0。
  - *必须降级反例*（以下任一命中应 `fallback=true`，且 `error` 能对应原因，不得伪接管）：变速/变调（speed 或 pitch ≠ 1.0）；非直通声道映射；声道 > 2；非 S16/FLOAT 编码；`nativeOpen` 失败或实际参数不匹配；SDK < 26。
  - *发送健壮性*：`nativeWrite` 返回负值须上抛 `WriteException` 交上层处理；返回 0 不死循环（`drainPipeline`/`handleBuffer` guard 上限生效）；暂停期间补的 preroll 帧直接丢弃，不在写路径内 `requestStart`。
- **长稳**：连续 30min，统计水位波动、underrun/overrun 次数与时刻、P50/P90/P99 延迟、ppm 漂移收敛情况。

### 3.3 主观听测（真机，控制台/听感记录，不截图）

- 纯正弦：有无滴答、爆音、颤音、频率偏移（时钟漂移典型现象）。
- 语音：清晰、无金属失真、语速不忽快忽慢。
- 音乐：复杂频谱无混叠、高频不抹糊。
- 静音段：底噪稳定，无随机噪声、无静音突爆。

## 4. 验收门禁（量化）

| 门槛 | 指标要求 | 判定方式 |
| --- | --- | --- |
| 直通无损 | 块标记 100% 保留，LSD≈0，无样本修改 | 自动化（离线 harness） |
| 静态倍率音质 | THD < -80dB，SNR > 90dB，无 DC offset | 自动化（离线 harness） |
| 闭环长稳 | 30min 无持续 underrun/overrun；允许极短时触边但自动恢复、不爆音；ppm 稳定收敛、无单调累积偏移 | 自动化（埋点补齐后）+ 人工复核 |
| 延迟 | P99 < 120ms；单块处理耗时 P95 < 回调周期 30% | 自动化（埋点补齐后） |
| 块边界 | 静音块、短尾块正常渲染，无吞尾、无粘连杂音，标记零错位 | 人工 + 标记计数自动化 |
| 接管与真实发送 | 满足前置条件时 `fallback=false` 且 PCM 真实写入原生流（发送计数单调增长、无负返回）；命中反例必须降级且 `error` 可归因 | 自动化（埋点补齐后）+ 人工复核 |
| 热切换 | 采样率/声道切换仅允许一次极短淡入淡出，不卡死、不爆音、不丢标记流 | 人工 |

## 5. 报告 JSON 结构

对齐 cloud suite 的 `report.json`，每条用例一份结果：

```json
{
  "test_case": "C1-loopback-24k-48k-30min",
  "layer": "device",
  "model_sr": 24000,
  "hw_sr": 48000,
  "mode": "asrc_closed_loop",
  "total_duration_s": 1800,
  "ppm_drift_max": 7.2,
  "waterlevel": {"avg": 0.45, "min": 0.21, "max": 0.78},
  "underrun": 0,
  "overrun": 0,
  "block_marker_lost": 0,
  "block_marker_offset_max": 0,
  "thd_db": -84.3,
  "snr_db": 92.1,
  "latency_p99_ms": 96,
  "takeover": {"active": true, "fallback": false, "exclusive": false},
  "send": {"bytes_written": 0, "frames_written": 0, "write_errors": 0, "xrun_count": 0},
  "converge_ok": true,
  "verdict": "pass"
}
```

## 6. 风险与本仓库对应坑

1. **系统级二次重采样叠加**：部分设备/蓝牙路由下系统混频再做一次转换，等于两级串联，失真翻倍。真机记录需读取 `deviceSampleRate` 与 `aaudio.sampleRate`，确认是否被系统再次转码。
2. **重采样阻塞 AAudio 回调线程**：`nativeWrite` 路径不能做重采样重计算；转换放独立 worker，回调只入队/出队。埋点补齐后用单块耗时 P95 门禁卡。
3. **插值跨块边界**：插值核跨过语音→静音突变边界会产生拖尾杂音；块边界需可配置强制截断插值窗口。
4. **静音帧被优化逻辑丢弃**：显式静音块承载停顿语义，桥接层必须原样透传标记，不能当无效数据丢弃。
5. **双向闭环调速共振**：播放桥与录音桥各一套水位闭环，参数未错开带宽会周期性水位起伏、声音发颤；播放侧优先稳水位，录音侧调速更保守。
6. **ROM 不上报原生采样率**：`audioInfo()` 已有三级兜底（AudioManager 属性 → AudioTrack 原生率 → AAudio 实际流率），真机回归需确认兜底链路在目标机型生效。
7. **伪接管 / 静默误降级**：`nativeActive` 打开失败后回退 `fallback`，若面板只看"在播"状态容易误以为走了 AAudio。真机必须核对 `aaudio.fallback` 与 `error`；降级原因（变速/非直通/打开失败/参数不匹配）要能从 `error` 字段直接归因。

## 7. 落地步骤（本地 CLI）

1. 先入离线 harness：`packaging/tests/bridge/` 信号生成 + 质量基准，可独立 CLI 运行并输出 JSON 报告；不依赖真机。
2. 真机埋点按第 2.2 节补齐水位、xrun、倍率、标记计数，纳入 `audioInfo()` 上报，再把 3.2 节指标转为自动化断言。
3. 每次出 APK 前过第 4 节矩阵；离线项进 CI，真机项作为发版前人工回归清单。

## 附：与前两版关系

- V1 的信号/指标/听测项在第 3.1、3.3 节落地为可执行用例。
- V2 的分组 A/B/C/D、水位闭环、块标记、PID 与风险清单在第 3.2、4、6 节对齐到本仓库代码路径与现有上报字段。
