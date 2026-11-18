# packaging/ —— Android 打包工程与文档归档

本目录放 Android 构建工程、打包脚本和历史技术文档。业务代码仍在仓库根：

- `backend/`：Python/Starlette 后端
- `frontend/`：WebView 前端
- `ac_web.py`：本地/桌面运行入口

当前实际构建路线是 **Gradle + Chaquopy**，不再使用 p4a 作为主构建。`docs/` 下的 p4a、WebToApp 文档是历史评估记录，只用于追溯决策，不代表当前工程。

## 目录

```text
packaging/
├── android/
│   ├── app/                    Android 应用模块
│   ├── ffmpeg/                  音频专用 FFmpeg 构建脚本与产物
│   ├── build.gradle.kts         根构建配置
│   └── app/build.gradle.kts     版本号、Chaquopy、签名、前端/Python staging
├── docs/                        历史方案、交接、接口文档
├── tests/                       前端回归脚本
├── ci/                          旧版 CI 参考
├── preflight.sh                 打包前自检
└── README.md                    本文件
```

## 构建 APK

### GitHub Actions（推荐）

工作流：`.github/workflows/build-gradle.yml`

1. 打开仓库 Actions 页面；
2. 选择 `build-audio-cpm`；
3. `Run workflow`，分支选 `main`；
4. 构建完成后下载 `audio-cpm-apk` artifact。

构建会先编译音频专用 FFmpeg，再执行 `gradle assembleDebug`。首次构建约 15–30 分钟，命中缓存后更快。

### 本地构建

环境要求：

- JDK 17
- Android SDK 35 / Build Tools 35.0.0
- Gradle 8.10.2
- Android NDK（仅重新编译 FFmpeg 时需要）

步骤：

```bash
cd packaging/android
gradle assembleDebug --no-daemon
```

如果 FFmpeg 产物尚未生成，需要先按 `packaging/android/ffmpeg/build_ffmpeg_android.sh` 编译，并把 `libffmpegbin.so` 放到：

```text
packaging/android/app/src/main/jniLibs/arm64-v8a/
```

产物：

```text
packaging/android/app/build/outputs/apk/debug/Audio-CPM-debug.apk
```

对外发布时建议重命名为 `Audio-CPM-<versionName>.apk`，不要带 `debug` 字样。

## 版本号

修改 `packaging/android/app/build.gradle.kts`：

```kotlin
versionCode = 47
versionName = "0.4.0"
```

每次发版同时递增 `versionCode`。构建完成后可在 GitHub Release 上传重命名后的 APK。

## 打包前自检

```bash
bash packaging/preflight.sh
```

前端回归脚本在 `packaging/tests/`，覆盖文件浏览、播放、任务、频谱、元数据排序、数据源等场景。测试依赖见 `packaging/tests/package.json`。

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/HANDOVER.md](docs/HANDOVER.md) | 代码结构、接口契约、运行方式、排障 |
| [docs/APP_PACKAGING_HANDOFF.md](docs/APP_PACKAGING_HANDOFF.md) | 打包交接、验收项、风险 |
| [docs/OFFLINE_APP_PLAN_V3.md](docs/OFFLINE_APP_PLAN_V3.md) | 离线 App 业务层方案（波形/AIFF/元数据/WebDAV） |
| [docs/OFFLINE_APP_PLAN_V2.md](docs/OFFLINE_APP_PLAN_V2.md) | 离线方案 v2 存档 |
| [docs/APP_PACKAGING_AND_WEBDAV_PLAN.md](docs/APP_PACKAGING_AND_WEBDAV_PLAN.md) | FFmpeg/WebDAV 旧方案存档 |
| [docs/P4A_MIGRATION_PLAN.md](docs/P4A_MIGRATION_PLAN.md) | p4a 迁移评估存档 |
| [docs/PACKAGING_OPTIONS_WEBTOAPP_P4A.md](docs/PACKAGING_OPTIONS_WEBTOAPP_P4A.md) | WebToApp / p4a 壳选型对比存档 |

项目介绍、功能列表和快速开始见仓库根 [README.md](../README.md)。
