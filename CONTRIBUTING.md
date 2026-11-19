# 贡献指南

感谢你愿意改进 Audio-CPM。这个项目同时包含 Python 后端、WebView 前端和 Android 壳，改动前请先了解下面的约定，避免把简单问题改复杂。

## 开始之前

- 先搜索 [Issues](https://github.com/olddriverdoge/Audio-CPM/issues) 和 [Pull Requests](https://github.com/olddriverdoge/Audio-CPM/pulls)，确认问题没有被处理过。
- 功能建议请先开 Issue 说明使用场景；涉及播放链路、音频输出、数据结构或打包方式的改动，先讨论方案再动手。
- 安全问题不要公开开 Issue，按 [SECURITY.md](SECURITY.md) 私下报告。

## 开发环境

### 桌面运行

需要 Python 3.10+（Android 构建使用 Chaquopy Python 3.14）：

```bash
python3 -m pip install -r requirements.txt
python3 ac_web.py
```

服务默认监听 `127.0.0.1:8000`。可用环境变量指定音乐根目录和数据目录：

```bash
AC2_ROOT=/path/to/music AC2_DATA_DIR=./data python3 ac_web.py
```

### 前端回归测试

测试基于 jsdom，需要 Node.js 18+，并要求服务已在 `127.0.0.1:8000` 运行：

```bash
cd packaging/tests
npm install
./run.sh
```

部分数据源/WebDAV 端到端脚本需要本地 WebDAV 服务，按脚本顶部注释单独运行。

### Android 构建

需要 JDK 17、Android SDK 35、Gradle 8.10.2、Android NDK 27，以及 FFmpeg 预编译产物。完整步骤见 [packaging/README.md](packaging/README.md)。

CI 使用 `.github/workflows/build-gradle.yml`，也可以在 Actions 页面手动运行 `build-audio-cpm`。

## 代码约定

### 通用

- 保持改动聚焦：一个 PR 解决一个问题，不夹带无关格式化或重构。
- 不提交密钥、口令、个人路径、WebDAV 凭据或真实音乐库数据。
- 新增用户可见文案必须同时更新 `frontend/i18n/*.json`；源码中文是翻译 key。
- 修改行为时同步更新 README、相关文档和回归测试。
- 版本号按 `0.0.1` 递增；每次出 APK 都要更新 `versionCode` 和 `versionName`。

### 前端

- 前端是经典脚本 + IIFE 命名空间，没有 Node/npm 构建步骤。
- 不要引入需要打包器的框架；新增脚本按现有顺序在 `frontend/index.html` 加载。
- 浮窗逻辑优先复用 `winmgr.js`、`floatwin.js`、`scene_store.js` 的现有能力。
- 场景保存必须保留窗口位置、大小、窗口缩放、全局缩放和画布位置；不要用默认场景覆盖用户历史几何。
- 修改手势时同时验证：普通模式、手掌锁定模式、单窗口缩放、空白区域全局缩放。

### 后端与 Android

- 后端接口保持 `/api/*` 相对路径契约，前端不硬编码服务器地址。
- Android 播放底座固定为 `androidx.media3:media3-exoplayer:1.5.1` 与 `media3-session:1.5.1`；新增 Media3 组件、迁移播放器或替换为纯 MediaCodec 前必须先讨论。
- 包名策略：`main` 和发布 tag 使用 `com.github.olddriverdoge.audiocpm`，其他分支自动加 `.dev`。
- 文件移动/删除如果命中当前播放文件或其所在目录，必须停止播放，不能让播放器停留在失效文件上。

### 提交信息

建议使用 Conventional Commits 风格：

```text
feat(scene): save current layout with full geometry
fix(player): stop playback when current file is deleted
docs: update README for 0.4.33
```

## Pull Request 流程

1. 从 `main` 拉出功能分支。
2. 完成改动，补充测试/文档。
3. 本地至少运行相关回归脚本；UI 改动附前后截图或录屏说明。
4. 在 PR 模板中写清：问题、方案、影响范围、验证设备与结果。
5. 等待 CI 通过和维护者review；不要在未确认前合并或发布。

## 发布

维护者负责：

- 确认 `main` 的版本号、README 和 Release Notes 一致；
- 创建 `vX.Y.Z` tag，由 tag 触发稳定包名构建；
- 下载 `audio-cpm-apk` artifact，重命名为 `Audio-CPM-X.Y.Z.apk`；
- 创建 GitHub Release 并上传 APK，注明调试签名、`arm64-v8a` 和主要变更。

发布 APK 目前使用固定调试签名，只适合侧载，不是应用商店签名。
