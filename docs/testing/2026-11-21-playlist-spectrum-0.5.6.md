# 播放管理 / 频谱内嵌 / 自动淡化回归（0.5.6）

日期：2026-11-21
分支：`feat/0.5.6-ui-defaults`

## 本轮改动

1. 停止状态播放列表直接显示当前目录的文件夹和音频，文件夹点一下进目录、音频点一下开播，不再依赖独立目录选择器；播放/暂停状态仍只显示音频队列，不混入文件夹。
2. 播放列表左右滑都返回上级目录；顶部原来的「上一级」「选择目录」两个按钮已删除，`#pf-dir-picker` 整套 DOM 和监听一并移除。
3. 停止播放后播放列表自动回到文件夹视图，不会停在音频队列。
4. 频谱/声谱展开后支持左右滑切换模式；内嵌 canvas 重新按宿主尺寸排布，柱子和声谱画面整体 50% 透明；长按配置底板由纯黑改为半透明玻璃。
5. 播放开始后 5 秒无操作，播放管理整体降到 10% 透明度并锁住点击；频谱/声谱展开时内部画面维持默认 50%，第一次点击或滑动只唤醒、不触发原按钮。
6. 左上角封面缩略图不再显示；原「点封面进元数据」的入口改到标题，标题可点击且保留键盘 Enter/Space。
7. 修复播放列表点击被指针捕获吞掉的问题：`pointerdown` 不再立刻 `setPointerCapture`，只有确认横向滑动后才捕获，避免 click 被重定向到 `#pf-queue` 导致文件夹/音频行点不中。

## 回归

命令：

```bash
python3 packaging/tests/cloud/run_cloud_suite.py --keep --report /tmp/ac2_v057j_suite_round3.json
```

结果：**API 50/50 + UI 36/36 = 86/86**，68.06 秒；`console_errors=[]`、`page_errors=[]`，未使用截图。

新增/调整 UI 用例覆盖：

- 停止状态显示文件夹行、无旧按钮/旧选择器；点文件夹直接进目录、点音频直接播放、暂停后不混文件夹；停止后回到文件夹视图。
- 右滑、左滑都回父目录；收藏仍从文件夹视图同步。
- 标题点击打开元数据；左上角封面不可见。
- 内嵌频谱 canvas `opacity=0.5`、封面背景保留、左右滑切换频谱/声谱、长按配置背景 alpha 0.38，并用 mock 原生帧确认 canvas 真正画出柱子像素；声谱模式 canvas 仍为 0.5。
- 播放 5.6 秒后 `.pf-idle-dim` 出现，周边控件 opacity 0.1、canvas 仍 0.5、守卫可见；点击停止按钮只唤醒不触发停止。
- 音频输出声音增益实际改变 `Player` 音量。

## 打包约定

本轮只构建**测试包名** `.dev`，不构建主干包名，避免未发布改动覆盖日常使用的正式版数据。

GitHub Actions 使用默认 `main_package=false`；构建产物包名应为
`com.github.olddriverdoge.audiocpm.dev`，与正式包可并存。

## 构建结果

- 推送提交：`17c71eb`（`feat: direct folder playlist, idle dim, embedded spectrum polish (0.5.6)`）
- GitHub Actions：run `44796709615`，`main_package=false`，结论 success
- 产物：`Audio-CPM-0.5.6-86-dev-playlist-final.apk`（测试包）
  - 包名 `com.github.olddriverdoge.audiocpm.dev`
  - versionName 0.5.6 / versionCode 86
  - 大小 22,607,148 字节
  - SHA256 `e291abeaed0d652dfd2721893046d3f780224d713bff78d03ffb3cb025016917`
  - 证书 SHA256 `BBA5DC52438BAEE4C3AF9B7FD9F5D4C3A464E14D95BCA811EA184223BF920DF9`
  - 下载：https://aka.doubaocdn.com/s/UVuJ3JHkw6
- 包内确认：`playpanel.js` 23922B、`spectrum.js` 53494B、`index.html` 31074B、`workbench.css` 28605B；CDN 下载与本地产物 SHA256 一致。
