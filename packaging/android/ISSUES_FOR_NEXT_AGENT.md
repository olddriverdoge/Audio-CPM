# Android 壳层问题交接（给下一个 agent）

> **状态更新（2026-11-16）**：本文列的 4 个问题已在 `446c747` 修复；随后在 `56e156b`/`5a7647d`/`d992230`
> 补齐了 FFmpeg（CI 自编音频专用 8.0.1）与 Media3 HiFi/通知栏，详见 `packaging/android/FFMPEG_AND_HIFI.md`。
> 下面保留原始问题描述，仅作背景。

分支：`fix/android-shell`（从 `cloud/agent` 开出；`cloud/agent` 已与 GitHub main 同步）
包名：`com.github.olddriverdoge.audiocpm`
构建：GitHub Actions `build-gradle`（`.github/workflows/build-gradle.yml`），产物 artifact `ac2-gradle-apk`
真机：小米 23116PN5BC，Android 16（API 36），已配 adb：`192.168.31.14:44049`
当前 APK：Gradle + Chaquopy 空壳（**没有** Media3/FFmpeg；Phase 1）

## 用户反馈的 4 个现象

1. **前端占满全屏，通知栏/状态栏挡住顶部按钮，无法点击**
   - `MainActivity` 用 `@android:style/Theme.Material.NoActionBar`，WebView 直接 `setContentView`。
   - targetSdk 35 在 Android 15+ 强制 edge-to-edge，WebView 会绘制到状态栏/导航栏下面。
   - 当前没有任何 WindowInsets 处理。

2. **App 没有自动请求目录权限**
   - `MainActivity` 没有 `requestPermissions`/`MANAGE_EXTERNAL_STORAGE` 引导。
   - manifest 只有 `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE`；targetSdk 35 下这两个对 `/sdcard` 文件路径基本无效（Android 13+ 需要 `READ_MEDIA_AUDIO`；全盘路径需要 `MANAGE_EXTERNAL_STORAGE` 或 SAF）。

3. **只能看到文件夹，文件列表为空，播放不了任何东西**
   - `backend/routers/browse_api.py` 对每个 entry 做 `os.path.isdir/getsize/getmtime`，异常时 `continue` 静默跳过。
   - 无存储权限时 `/sdcard` 可以列出目录名，但文件的 `stat`/读会失败 → 文件被过滤掉，表现为“只有文件夹”。
   - `/api/stream` 也读不到文件，播放失败。

4. **通知栏/锁屏/HiFi 均未接入**
   - 当前是 Phase 1 空壳；Media3/PlaybackService/PCM 频谱在 `packaging/android` 的 Java 源里尚未加入 `app/build.gradle.kts` 的依赖与 manifest（p4a 旧代码在 `packaging/p4a` 仅作参考）。
   - 不在本分支首轮修复范围，先解决 1~3，保证“能看、能播（`<audio>`）”。

## 建议修复顺序

### A. Edge-to-edge / 顶部按钮可点
- `MainActivity` 使用 `WindowCompat.setDecorFitsSystemWindows(window, false)`，再给 WebView 设置 `ViewCompat.setOnApplyWindowInsetsListener`，把 `systemBars().top` 作为 paddingTop、`systemBars().bottom` 作为 paddingBottom；或给根布局加 padding。
- 依赖已包含 `androidx.core:core:1.13.1`（`WindowCompat`/`ViewCompat`/`WindowInsetsCompat` 可用）。
- 验收：顶部按钮不被状态栏/通知栏遮挡；底部不被手势条遮挡；横竖屏切换后 padding 正确。

### B. 存储权限（targetSdk 35）
- manifest 增加：
  - `MANAGE_EXTERNAL_STORAGE`
  - `READ_MEDIA_AUDIO`（33+）
  - 保留 `READ_EXTERNAL_STORAGE`（<=32，`maxSdkVersion=32`）
- `MainActivity` 启动时：
  - `Environment.isExternalStorageManager()`；false → `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` 跳设置页；
  - 33+ 请求 `READ_MEDIA_AUDIO`；
  - 返回 app 后 `webView.reload()` 或前端 `visibilitychange` 刷新。
- 验收：首次启动有明确引导；授权后 `/sdcard` 文件可见、可播放、可移动/标签。
- 不要改 `/api/*` 契约；权限属壳层。

### C. 文件浏览静默失败
- 授权后仍为空的话，给 `browse_api.py` 的 `except` 加日志（不要静默 `continue`），确认是权限还是路径问题。
- 检查 `AC2_ROOT=/sdcard`、`PUBLIC_PREFIXES`、`/api/roots` 返回的 local root。
- 验收：`/api/browse?path=/sdcard` 返回 files 非空；`/api/stream` FLAC 可播。

## 构建与安装

```bash
# GitHub Actions：workflow_dispatch build-gradle
# 产物 artifact ac2-gradle-apk
adb install -r -d app-debug.apk
adb shell am start -n com.github.olddriverdoge.audiocpm/.MainActivity
adb logcat -d | grep -iE 'Audio-CPM|python|chaquopy|AndroidRuntime'
adb shell run-as com.github.olddriverdoge.audiocpm ls files
```

## 约束

- 业务代码不写 `if is_android`；平台差异只在壳层/native_bridge。
- 不改 `/api/*` 契约。
- 不把 targetSdk 降回 28。
- Termux `python3 ac_web.py` 必须保持可用。
- 本轮只做 1~3；Media3/通知栏/FFmpeg 另开 Phase。
