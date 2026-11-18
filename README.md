# Audio-CPM

Audio-CPM 是一个面向 Android 本地音乐库的音频管理与播放工具。它把目录浏览、音频播放、标签/封面编辑、批量处理和文件整理放进同一个可自定义的工作台，适合管理手机、SD 卡或 WebDAV 上的音乐收藏。

当前版本：**0.4.0**（`versionCode 47`，`minSdk 24`，`arm64-v8a`）。

## 简介

Audio-CPM 的核心不是“再做一个播放器”，而是把日常音乐文件处理中分散的操作集中起来：

- 在一个界面里浏览目录、查看封面、播放音频；
- 对单曲或整批文件做格式转换、标签整理、封面替换和标签检查；
- 用双栏文件整理页完成源目录到目标目录的移动、复制和撤销；
- 把常用浮窗和场景布局保存下来，下次直接恢复；
- 在 Android App 内运行 Python 后端，前端由 WebView 承载，不依赖外部服务器。

## 主要功能

### 音乐库浏览

- 本地目录与 WebDAV 数据源
- 列表 / 网格两种浏览方式
- 封面缩略图、文件搜索、排序、最近播放筛选
- 音频格式识别：FLAC、WAV、AIFF、MP3、M4A、AAC、OGG、Opus、APE、WV、DSF、DFF 等
- 目录收藏与快捷入口，可一键把当前目录设为目标目录

### 播放与音频输出

- 网页内流式播放：进度、暂停、音量都在页面内控制
- 系统播放器模式：可配置播放器包名和 Activity
- 播放管理浮窗：播放/暂停、上一首/下一首、停止、播放模式、音量、当前目录队列
- Media3 ExoPlayer + MediaSession，支持通知栏/锁屏控制和后台播放
- 波形进度条、频谱、瀑布声谱
- 10 段均衡器（频段增益限制 ±20 dB）
- 低音增强、高音增强、虚拟环绕与前级增益
- EQ 关闭时旁路频段与前级处理，避免“关了还在影响输出”

### 元数据与文件整理

- 封面、格式、采样率、比特率、声道、时长等详情
- 标签查看与编辑
- 双栏整理：左侧元数据，右上源文件，右下目标目录
- 移动 / 复制 / 撤销，支持同名冲突策略
- 目标目录树惰性加载，支持新建、重命名、删除空目录

### 批量任务

- 格式转换
- 整理标签
- 替换封面
- 检查标签
- SSE 实时进度与任务日志
- 批处理输出目录支持一键填入当前路径

### 工作台与场景

- 模块以浮窗形式摆放，可拖动、缩放、收起
- 右下角“+”纵向展开模块，10 秒无操作自动收回
- 顶部场景栏切换布局，“+”把当前布局保存为场景
- 场景删除只保留在工作台场景首页，避免顶部误触
- 手形锁定后只允许双指缩放，范围 50%–300%
- 浮窗点击自动置顶，避免被其他窗口盖住
- 全局日志浮窗，支持复制、清空、收起

## 技术架构

| 层 | 实现 |
|---|---|
| Android 壳 | Gradle + Chaquopy，Java 17，compileSdk 35 |
| 界面 | WebView 中的纯 HTML/CSS/JS 单页应用，无前端构建 |
| 后端 | Python 3.14 + Starlette，运行在 App 内 |
| 播放 | Media3 ExoPlayer + MediaSession；网页内流式播放 |
| 音频处理 | 软件 EQ / 高低音增强；音频专用 FFmpeg 二进制用于转码与波形 |
| 存储 | 本地文件系统 + WebDAV |
| 构建 | GitHub Actions `build-gradle.yml`，产出 arm64 debug APK |

前端按经典脚本顺序加载，模块使用 IIFE 命名空间，不需要 Node/npm 构建。后端与前端通过相对路径 `/api/*` 通信，静态前端由 Starlette `StaticFiles` 挂载。

## 快速开始

### 安装 APK

从 GitHub Releases 下载最新 APK：

- 发布页：<https://github.com/olddriverdoge/Audio-CPM/releases>
- 当前版本直链：<https://github.com/olddriverdoge/Audio-CPM/releases/download/v0.4.0/Audio-CPM-0.4.0.apk>

APK 使用固定调试签名，适合侧载安装，不是应用商店发布签名。当前只打 `arm64-v8a`。

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

### 构建 APK

推荐使用 GitHub Actions：

1. 打开仓库 Actions 页面；
2. 选择 `build-audio-cpm`；
3. 点击 `Run workflow`，分支选 `main`；
4. 构建完成后下载 `audio-cpm-apk` artifact。

本地构建需要 JDK 17、Android SDK 35、Gradle 8.10.2，以及 FFmpeg 预编译产物；具体说明见 [packaging/README.md](packaging/README.md)。

## 目录结构

```text
ac_web.py                  服务启动入口
backend/                   Python 后端：配置、元数据、任务、存储、路由
frontend/                  WebView 前端：HTML + CSS + JS
packaging/android/         Gradle + Chaquopy Android 工程
packaging/docs/            历史方案、交接与接口文档
packaging/tests/           前端回归脚本
requirements.txt           Python 依赖
```


## 当前限制

- 仅 Android，当前 APK 为 `arm64-v8a`。
- APK 为调试签名，不能直接上架应用商店。
- 网页内播放依赖后端流式接口；系统播放器模式需要填写正确的包名/Activity。
- WebDAV 功能依赖服务端对 `PROPFIND`、`Range`、`MOVE` 等方法的支持。
- 高音增强、EQ 关闭旁路等音频效果已通过桌面模拟和 CI 编译验证，仍建议在目标真机上做听感确认。
