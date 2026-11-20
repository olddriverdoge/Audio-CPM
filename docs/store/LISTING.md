# 商店文案与素材

## 应用名称

- 中文：`Audio-CPM 音乐库工作台`（≤30 字符）
- English: `Audio-CPM Music Library`（≤30 characters）

## 简短描述（Google Play 80 字符内）

**中文**

> 本地与 WebDAV 音乐库：浏览、播放、元数据、批量转换与文件整理。

**English**

> Local & WebDAV music library: browse, play, tag, convert and organize audio.

## 完整描述

### 中文

Audio-CPM 是一个面向 Android 本地与 WebDAV 音乐库的播放和整理工作台。它把目录浏览、播放、频谱、元数据、批量转换和文件移动集中到一套可自定义的浮窗界面，适合管理手机、SD 卡或 NAS 上的音乐收藏。

主要功能：

- 本地目录与 WebDAV 数据源，支持列表/网格浏览、搜索、排序和封面缩略图。
- 播放管理：播放/暂停、上一首/下一首、播放模式、音量、当前目录队列、通知栏与锁屏控制。
- 音频输出：Media3 ExoPlayer、AAudio 独占/共享回退、USB DAC / 系统默认输出。
- 10 段软件均衡器（±10 dB）、前级增益、低音/高音增强、虚拟环绕。
- 波形进度条、实时频谱与瀑布声谱。
- 元数据浮窗：封面、格式、采样率、比特率、声道、时长和标签。
- 双栏整理：移动、复制、撤销、同名冲突策略；目标目录树和快捷入口。
- 批处理：格式转换、按标签重命名、替换封面、任务预设、实时进度和取消。
- 工作台场景：浮窗位置、大小、窗口缩放、全局缩放和画布位置可保存与恢复。
- 7 种界面语言：简体中文、English、日本語、Deutsch、Русский、Tiếng Việt、हिन्दी；默认跟随系统并回退英文。

隐私说明：

Audio-CPM 不要求账号，不含广告、统计或崩溃上报 SDK。音乐文件、元数据、日志和 WebDAV 配置在设备本地处理；WebDAV 只连接你填写的服务器。完整隐私政策：https://olddriverdoge.github.io/Audio-CPM/privacy/

安装说明：

当前 APK 为 arm64-v8a；Android 11+ 访问 /sdcard 任意目录时需要在系统设置中授予“所有文件访问权限”。部分功能依赖设备/ROM 的音频通路，AAudio 独占不可用时会自动回退共享混音。

### English

Audio-CPM is a modular music-library workbench for Android, built for local folders and WebDAV libraries. Browse, play, inspect metadata, convert batches and organize files in one customizable floating-window workspace.

Highlights:

- Local and WebDAV sources, list/grid browsing, search, sorting and cover thumbnails.
- Playback queue, play modes, notification/lock-screen controls and background playback.
- Media3 ExoPlayer with AAudio exclusive/shared output and USB DAC / system default routing.
- 10-band software EQ (±10 dB), preamp, bass/treble boost and virtual surround.
- Waveform progress, live spectrum and waterfall spectrogram.
- Metadata window with cover, format, sample rate, bitrate, channels, duration and tags.
- Two-pane organizer: move, copy, undo and conflict handling; target tree and shortcuts.
- Batch conversion, tag-based rename, cover replacement, presets, live progress and cancel.
- Scene layouts that preserve window position, size, per-window scale, global zoom and canvas offset.
- Seven UI languages with system-language detection and English fallback.

Privacy:

No account, ads, analytics or crash-reporting SDK. Music files, metadata, local logs and WebDAV profiles stay on your device; WebDAV connections go only to the server you configure. Privacy policy: https://olddriverdoge.github.io/Audio-CPM/privacy/

Notes:

The APK is arm64-v8a. Android 11+ requires “All files access” for arbitrary /sdcard folder management. AAudio exclusive output depends on the device/ROM and falls back to shared mixing when unavailable.

## 分类与联系信息

- Category: Music & Audio
- Secondary category: Tools（如商店允许）
- Contact: https://github.com/olddriverdoge/Audio-CPM/issues
- Privacy policy: `https://olddriverdoge.github.io/Audio-CPM/privacy/`
- Website: `https://github.com/olddriverdoge/Audio-CPM`
- Support: GitHub Issues

## 截图建议

建议 5 张手机截图，顺序如下：

1. 工作台全景：多个浮窗、场景栏、“保存场景”入口。
2. 本地/WebDAV 文件浏览：列表、封面、搜索、目标目录快捷入口。
3. 播放管理：播放队列、进度、播放模式、音频输出状态（可显示 AAudio）。
4. 元数据与整理：封面、格式信息、双栏移动/复制。
5. 批处理或 EQ：任务进度或 10 段均衡器。

截图要求：

- 不要露出真实 WebDAV 地址、用户名、密码、私人目录或文件名；
- 建议 1080×1920 或更高，统一比例；
- 不要使用设备边框、虚假评分、虚假商店标识；
- 每张图只表达一个主要功能，文字不要贴在截图上。

## What's New 模板

```text
0.5.1
- 播放管理封面打开元数据；封面编辑跳到批处理替换封面
- 元数据封面放大并支持置顶预览；替换封面使用系统文件选择器
- 频谱延迟按输出设备隔离；输出面板识别蓝牙/有线/USB 当前设备
- 高低音增强幅度提高，音效参数原生持久化
- 移动/删除当前播放文件时立即停止播放
- AAudio 独占/共享状态显示与 USB DAC 输出
- 10 段 EQ 限制 ±10 dB
- 修复目标目录、收藏快捷入口和全选/清空交互
```
