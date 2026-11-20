# 播放管理 / 频谱内嵌 / 顺序跨目录回归（0.5.6）

日期：2026-11-21
分支：`feat/0.5.6-ui-defaults`

## 本轮改动

1. 播放管理按钮与波形区域改为 30% 黑玻璃底，封面作为完整背景时不再被实色控件压住。
2. 播放列表标题由「当前目录」改为「播放列表」。
3. 声音增益从播放管理移动到「音频输出」模块，播放管理不再保留旧音量滑杆。
4. 顺序模式在播完当前目录最后一首后，查找父目录的下一个兄弟目录；若目录内有音频，切换浏览目录并从第一首继续。网页播放和原生 ExoPlayer 结束态（`playbackState=4`）都接入。
5. 播放列表支持右滑回上级目录、左滑打开目录选择；目录选择面板可打开子目录或父目录。文件浏览的目录收藏同步到播放列表：`+` 收藏、点击切换、长按删除。
6. 播放列表收起后显示「声谱 / 频谱」折叠区，默认展开。内嵌的是同一套频谱模块（不是复制一套取数链），因此频谱/声谱模式、延迟、配色、频段等长按配置全部保留；模块自身深色浮窗背景被移除，播放管理封面继续作为背景。
7. 底部旧播放条整体隐藏，工作台最底部不再出现波形进度条；播放控制统一在播放管理。
8. 新增 i18n 文案（播放列表、上级目录、选择目录、声谱/频谱、声音增益等）。

## 回归

命令：

```bash
python3 packaging/tests/cloud/run_cloud_suite.py --keep --report /tmp/ac2_v057j_suite.json
```

结果：**API 50/50 + UI 34/34 = 84/84**，51.34 秒；`console_errors=[]`、`page_errors=[]`，未使用截图。

新增/调整 UI 用例覆盖：

- 顺序模式跨目录续播。
- 播放列表标题、30% 玻璃控件、播放管理不再有音量滑杆。
- 播放列表右滑上级、左滑目录选择。
- 目录选择打开 + 目录收藏同步。
- 队列收起后频谱/声谱内嵌、封面背景保持、模式切换、长按配置展开。
- 音频输出声音增益实际改变 `Player` 音量。
- 网格视图不再出现底部播放条。

## 打包约定

本轮只构建**测试包名** `.dev`，不构建主干包名，避免未发布改动覆盖日常使用的正式版数据。

GitHub Actions 使用默认 `main_package=false`；构建产物包名应为
`com.github.olddriverdoge.audiocpm.dev`，与正式包可并存。

## 构建结果

- 推送提交：`d1aa89b`（`feat: polish playback manager and embed spectrum (0.5.6)`）
- GitHub Actions：run `44790675669`，`main_package=false`，结论 success
- 产物：`Audio-CPM-debug.apk`
  - 包名 `com.github.olddriverdoge.audiocpm.dev`（测试包，可与正式包并存）
  - versionName 0.5.6 / versionCode 86
  - 大小 22,604,944 字节
  - SHA256 `2d947a64cd4517ee1040071c4e5924b5f5b09b6dcab8bda0f252084f3c5cd3b7`
  - 证书 SHA256 `BB A5 DC 52 43 8B AE E4 C3 AF 9B 7F D9 F5 D4 C3 A4 64 E1 4D 95 BC A8 11 EA 18 42 23 BF 92 0D F9`
  - 下载：https://aka.doubaocdn.com/s/UXwg7zKUWF
- 包内确认：`assets/frontend/defaults.json` 4299B、`playpanel.js` 19432B、`spectrum.js` 52214B、`index.html` 31460B。
