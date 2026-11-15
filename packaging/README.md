# packaging/ —— App 打包工程（p4a + FFmpeg）

> 业务代码在仓库根（`backend/`、`frontend/`），本目录只放打包物。
> 完整交接说明见 [../APP_PACKAGING_HANDOFF.md](../APP_PACKAGING_HANDOFF.md)。

## 目录

```
packaging/
├── p4a/
│   ├── main.py            启动器：env / 日志 / 权限 / nativeLibraryDir
│   ├── buildozer.spec     构建配置（ffmpeg recipe、targetSdk 28、arm64）
│   └── README.md
├── android/
│   ├── java/com/example/ac2/Ac2Bridge.java   原生桥（波形/Intent/权限；目前是骨架）
│   └── AndroidManifest.append.md             FileProvider / queries / 权限片段
├── ci/build-apk.yml       GitHub Actions 构建（复制到仓库根 .github/workflows/）
├── preflight.sh           打包前自检（编译/服务/端口/回归）
└── tests/                 12+ 套 jsdom 回归（打 APK 前先在 Termux 跑通）
```

## 本机（Termux）不能直接构建

Termux 里没有 JDK / Android SDK / NDK / Gradle；官方 `aapt2` 是 x86_64 二进制，aarch64 Termux 跑不了。
**构建必须用 PC / WSL / CI**，本机只负责开发与回归。

## 构建路径 A：GitHub Actions（推荐）

1. 把 `audio_manager/` 作为独立仓库推到 GitHub（当前它在一个更大的仓库里，CI 不会识别子目录的 workflow）。
2. 复制 workflow：

```bash
mkdir -p .github/workflows
cp packaging/ci/build-apk.yml .github/workflows/build-apk.yml
git add .github && git commit -m "ci: build apk" && git push
```

3. 在 Actions 里点 `build-apk` → `Run workflow`（或推 `v*` tag）。
4. 产物：`ac2-apk` artifact（`packaging/p4a/bin/ac2-0.1-arm64-v8a-debug.apk`）。
5. 首次 40~90 分钟（Python + FFmpeg + SDL 全部编译）；之后命中 `~/.buildozer` 缓存会快一些。

## 构建路径 B：PC / WSL

```bash
# Ubuntu 22.04+ / WSL2
sudo apt install -y git zip unzip openjdk-17-jdk python3-pip autoconf libtool \
  pkg-config zlib1g-dev libncurses5-dev libncursesw5-dev libtinfo6 cmake libffi-dev libssl-dev
pip install buildozer cython

cd packaging/p4a
buildozer -v android debug
# 产物：bin/ac2-0.1-arm64-v8a-debug.apk
```

## 构建前（Termux 上先跑）

```bash
bash packaging/preflight.sh     # py_compile + 服务 200 + 端口一致 + 12 套回归
```

当前基线：12/12 PASS。

## 已知缺口

- `Ac2Bridge.java` 仍是骨架：`peaks()` 返回 not implemented → 波形会回退到 ffmpeg（p4a 的 `libffmpegbin.so`，需 ffbin 定位成功）；`open()` 返回 not implemented → app 内系统播放器暂不可用。首版可先验证「浏览/播放/元数据/波形(ffmpeg)/转码」。
- `fullscreen = 1`：WebView 的全屏按钮（`requestFullscreen`）依赖 p4a 的 PythonActivity 是否实现 `WebChromeClient.onShowCustomView`，未验证；前端 CSS 布局本身可用。
- targetSdk 28：侧载可用、`/sdcard` 走旧权限模型；不能上 Google Play。
- `p4a.branch = develop`：首次构建成功后建议锁 commit，保证可复现。

## 相关文档

- [../APP_PACKAGING_HANDOFF.md](../APP_PACKAGING_HANDOFF.md)：待办/验收/风险
- [../P4A_MIGRATION_PLAN.md](../P4A_MIGRATION_PLAN.md)：p4a 事实与 FFmpeg 集成
