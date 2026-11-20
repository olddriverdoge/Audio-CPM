# Audio-CPM

[![Build](https://github.com/olddriverdoge/Audio-CPM/actions/workflows/build-gradle.yml/badge.svg?branch=main)](https://github.com/olddriverdoge/Audio-CPM/actions/workflows/build-gradle.yml)
[![Latest release](https://img.shields.io/github/v/release/olddriverdoge/Audio-CPM)](https://github.com/olddriverdoge/Audio-CPM/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Audio-CPM 是一个面向 Android 本地与 WebDAV 音乐库的音频管理、播放和整理工作台。它把目录浏览、播放、标签/封面查看、批量转换、元数据整理和文件移动放进同一套可自定义的浮窗界面，适合管理手机、SD 卡或 NAS 上的音乐收藏。

当前版本：**0.5.1**（`versionCode 81`，`minSdk 24`，`arm64-v8a`）。

## 为什么是 Audio-CPM

Audio-CPM 不只是“再做一个播放器”。它把日常音乐文件处理中分散的步骤集中到同一个界面：

- 一边浏览目录和封面，一边播放、看频谱、查看元数据；
- 对单曲或整批文件做格式转换、按标签重命名、替换封面；
- 用双栏整理页把源目录文件移动/复制到目标目录，并支持撤销；
- 用可保存的场景恢复常用浮窗布局、窗口位置、大小和缩放；
- 在 Android App 内运行 Python 后端，由 WebView 承载前端，不依赖外部服务器。

## 主要功能

### 工作台与场景

- 文件浏览、批处理、目标目录、播放管理、音频输出、元数据、频谱/声谱、日志等模块以浮窗形式摆放。
- 浮窗支持拖动、改变大小、收起、置顶和单窗口内容缩放；窗口内文字与控件一起缩放。
- 空白区域双指缩放全部组件，范围 50%–300%；顶部“缩放”按钮用于快速恢复/调整全局比例。
- 手掌按钮开启后进入“锁定 + 拖动”模式：禁止缩放和改变任何浮窗尺寸，但模块内部按钮、列表和滚动仍可正常点击。
- 点击浮窗自动置顶，避免被其他窗口盖住。
- 顶部“保存场景”打开场景列表：
  - `＋ 新建场景` 用当前布局创建新场景；
  - 点击已有场景行或“覆盖”用当前布局覆盖；
  - 覆盖会保存每个窗口的位置 `x/y`、大小 `w/h`、窗口缩放，以及全局缩放和画布位置。
- 内置场景的用户覆盖独立存储；App 升级时，同名默认场景不会覆盖用户已保存的窗口几何。
- 场景删除入口集中在工作台场景首页，减少顶部误触。
- 全局日志浮窗支持复制、清空、收起。

### 音乐库浏览

- 本地目录与 WebDAV 数据源，可保存多个来源并配置只读访问。
- 列表 / 网格两种浏览方式，支持搜索、排序、最近播放筛选和封面缩略图。
- 可配置列表表头字段与列宽，兼顾标签浏览和长文件名。
- 音频格式识别：FLAC、WAV、AIFF、MP3、M4A、AAC、OGG、Opus、APE、WV、DSF、DFF 等。
- 面包屑与“上级目录”导航；目标目录快捷入口和收藏入口。
- 收藏使用 `＋` 快捷添加；快捷按钮统一长按删除，不显示容易误触的 `✕`。
- 多选、全选、清空、删除；删除或移动命中当前播放文件/目录时，播放立即停止。
- 选中目标目录中的文件夹后，用 `＋` 加入快捷入口；路径和上级跳转不会自动新增按钮。

### 播放与音频输出

- 网页内流式播放：进度、暂停、音量都在页面内控制，可拖动进度。
- 系统播放器模式：可配置外部播放器包名和 Activity。
- 播放管理浮窗：播放/暂停、上一首/下一首、停止、播放模式、音量、当前目录队列。
- Media3 ExoPlayer + MediaSession，支持通知栏、锁屏控制和后台播放。
- 通知栏媒体元数据包含标题、艺术家、专辑和 composer 等信息。
- 波形进度条、实时频谱、瀑布声谱。
- 音频输出面板显示音源格式、实际输出参数与 AAudio 状态。
- AAudio 独占/共享输出：优先独占，设备拒绝时自动回退共享混音；也支持选择 USB DAC 或系统默认输出。
- 10 段软件均衡器，单频段增益限制 **±10 dB**；前级增益同样限制在 ±10 dB。
- 低音增强、高音增强、虚拟环绕；EQ 关闭时旁路频段与前级处理。
- 软件 EQ/音效工作在原生 ExoPlayer PCM 链路；WebView 网页播放由系统混音，输出参数以系统为准。

### 元数据与文件整理

- 封面、容器格式、采样率、比特率、声道、时长、音频流等详情。
- 标签查看与编辑，独立元数据浮窗。
- 双栏整理：元数据、源文件、目标目录同时可见。
- 移动 / 复制 / 撤销，支持跳过同名、重命名、覆盖三种冲突策略。
- 移动完成后可撤销；涉及当前播放文件或所在目录时停止播放并清空播放器。
- 目标目录树惰性加载，支持展开一层、全部收起、新建、重命名和删除空目录。
- 目标目录支持面包屑和上级路径导航；新增快捷入口只在下方 `＋` 完成。

### 批处理

- 格式转换：FLAC、WAV、AIFF、M4A 等，可选采样率/位深/码率。
- 按标签批量重命名，支持命名模板、变量和预览。
- 批量替换封面。
- 任务预设保存/删除，输出目录可一键填入当前路径。
- SSE 实时进度、任务日志和取消当前任务。

### 多语言

- 界面支持简体中文、English、日本語、Deutsch、Русский、Tiếng Việt、हिन्दी。
- 默认跟随系统语言；系统首选语言不在支持列表时回退英文，不会误回退中文。
- 设置中可手动切换语言；语言包按需加载，未翻译条目回退英文，再回退中文源文案。

## 技术架构

| 层 | 实现 |
|---|---|
| Android 壳 | Gradle + Chaquopy，Java 17，compileSdk/targetSdk 35 |
| 界面 | WebView 中的 HTML/CSS/JS 单页应用，无前端构建步骤 |
| 后端 | Python 3.14 + Starlette，运行在 App 内 |
| 播放 | Media3 ExoPlayer 1.5.1 + MediaSession；WebView 流式播放 |
| 音频处理 | 软件 EQ / 高低音增强 / 虚拟环绕；音频专用 FFmpeg 二进制用于转码与波形 |
| 存储 | 本地文件系统 + WebDAV |
| 构建 | GitHub Actions `build-audio-cpm`，产出 arm64 APK |

前端按经典脚本顺序加载，模块使用 IIFE 命名空间，不需要 Node/npm 构建。后端与前端通过相对路径 `/api/*` 通信，静态前端由 Starlette `StaticFiles` 挂载。

## 快速开始

### 安装 APK

从 GitHub Releases 下载最新 APK：

- 发布页：<https://github.com/olddriverdoge/Audio-CPM/releases/latest>
- 当前发布：<https://github.com/olddriverdoge/Audio-CPM/releases/tag/v0.4.33>

发布 APK 使用固定调试签名，适合侧载安装，**不是应用商店发布签名**。当前只提供 `arm64-v8a`。

Android 11+ 若需要访问 `/sdcard` 任意目录，需要在系统设置中授予“所有文件访问权限”；Android 13+ 读取媒体库还需要音频读取权限。

### 从源码运行（Termux / PC）

```bash
python3 -m pip install -r requirements.txt
python3 ac_web.py
```

默认监听 `127.0.0.1:8000`，浏览器打开：

```text
http://127.0.0.1:8000
```

默认音乐根目录为 `/sdcard/ADM`，不存在时回退到用户主目录；可用环境变量覆盖：

```bash
AC2_ROOT=/sdcard/Music AC2_DATA_DIR=./data python3 ac_web.py
```

服务默认没有鉴权，不要随意绑定 `0.0.0.0` 到公网。

### 构建 APK / AAB

推荐使用 GitHub Actions：

1. 打开仓库 Actions 页面；
2. 选择 `build-audio-cpm`；
3. 点击 `Run workflow`；
4. `main` 或发布 tag 使用主干包名 `com.github.olddriverdoge.audiocpm`；
5. 非 `main` 分支自动使用 `.dev` 后缀（`com.github.olddriverdoge.audiocpm.dev`），可与正式版同时安装；
6. 普通分支构建下载 `audio-cpm-apk` artifact，包内为 `Audio-CPM-debug.apk`；
7. 推送 `v*` tag 或手动勾选 `build_release` 时，构建已签名的 `Audio-CPM-release.apk` 和 `Audio-CPM-release.aab`，artifact 名为 `audio-cpm-release`。

Release 构建需要配置 4 个签名 Secrets，步骤见 [docs/store/RELEASE_SIGNING.md](docs/store/RELEASE_SIGNING.md)。本地构建需要 JDK 17、Android SDK 35、Gradle 8.10.2、Android NDK 27，以及 FFmpeg 预编译产物；具体说明见 [packaging/README.md](packaging/README.md)。

## 商店与合规材料

- [PRIVACY.md](PRIVACY.md)：隐私政策源文件
- [隐私政策公开页](https://olddriverdoge.github.io/Audio-CPM/privacy/)：GitHub Pages 版本
- [docs/store/README.md](docs/store/README.md)：上架准备清单
- [docs/store/RELEASE_SIGNING.md](docs/store/RELEASE_SIGNING.md)：release keystore、GitHub Secrets、AAB 构建
- [docs/store/DATA_SAFETY.md](docs/store/DATA_SAFETY.md)：数据安全与权限底稿
- [docs/store/LISTING.md](docs/store/LISTING.md)：中英文商店文案
- [docs/store/ASSETS.md](docs/store/ASSETS.md)：图标、功能图和截图规格
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：第三方组件许可证

> `MANAGE_EXTERNAL_STORAGE` 仍是 Google Play 审核的主要风险；SAF 目录授权模式尚未实现，不能把当前全盘模式当作已合规的商店方案。

## 目录结构

```text
ac_web.py                  服务启动入口
backend/                   Python 后端：配置、元数据、任务、存储、路由
frontend/                  WebView 前端：HTML + CSS + JS + 7 种语言包
packaging/android/         Gradle + Chaquopy Android 工程
packaging/docs/            架构、交接与历史方案文档
packaging/tests/           前端回归脚本
docs/                      隐私政策与商店材料
fastlane/metadata/         商店文案骨架
requirements.txt           Python 依赖
.github/                   CI、Issue 模板、PR 模板与 Dependabot
```

## 文档与社区

- [packaging/README.md](packaging/README.md)：Android 构建说明与历史文档索引
- [packaging/docs/HANDOVER.md](packaging/docs/HANDOVER.md)：代码结构、接口契约、运行与排障
- [packaging/docs/APP_PACKAGING_HANDOFF.md](packaging/docs/APP_PACKAGING_HANDOFF.md)：打包交接与验收
- [CONTRIBUTING.md](CONTRIBUTING.md)：开发、测试与提交规范
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)：社区行为准则
- [SECURITY.md](SECURITY.md)：安全漏洞报告方式
- [PRIVACY.md](PRIVACY.md)：隐私政策
- [LICENSE](LICENSE)：MIT License

> `packaging/docs/` 中的 p4a、WebToApp 等文档是路线评估记录；当前实际构建以 Gradle + Chaquopy 工程为准。

## 当前限制

- 仅 Android，当前 APK 为 `arm64-v8a`。
- GitHub 上的 `0.4.33` Release 仍是固定调试签名；商店发布必须使用独立 release key 重新构建，不能直接复用该 APK。
- `MANAGE_EXTERNAL_STORAGE` 与 Play All files access 政策存在审核风险，SAF 合规路径尚未完成。
- AAudio 独占是否真正生效取决于 ROM、设备和音频通路；被拒绝时会回退共享混音，输出面板会显示实际状态。
- 网页内播放由 WebView/系统解码，无法保证与原生 AAudio 路径相同的采样率和位深。
- WebDAV 功能依赖服务端对 `PROPFIND`、`Range`、`MOVE` 等方法的支持。
- 部分 EQ、高音增强和 HiFi 输出效果已通过编译与桌面回归验证，仍建议在目标真机上做听感确认。

## 许可证

项目源代码采用 [MIT License](LICENSE)。打包产物中的 FFmpeg 可执行文件、AndroidX/Media3、Chaquopy、Mutagen 等第三方组件遵循各自许可证；分发时请保留 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中的声明。
