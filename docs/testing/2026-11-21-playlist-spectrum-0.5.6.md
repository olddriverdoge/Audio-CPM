# 播放管理 / 频谱内嵌 / 自动淡化回归（0.5.6）

日期：2026-11-21
分支：`feat/0.5.6-ui-defaults`

## 本轮改动

1. 播放列表从“当前有没有在播”解耦为「目录 / 队列」双视图。播放中也能从目录 tab、左右滑或顶部收藏路径切回文件夹；停止播放才强制回到目录。旧实现按 `Player.current` 二选一渲染，只要开播就永远画音频队列，文件夹入口等于被锁死。
2. 从播放列表选曲改为静默起播：`PlayMgr.play(path, ratio, {quiet:true})` 不再二次弹出播放管理/频谱，只有文件浏览、网格等外部起播才自动展开声谱。
3. 播放管理窗口尺寸只在 `hidden` 可见性真正变化时 `apply/raise`。此前 `MutationObserver` 监听任意 class 变化，`pf-idle-dim`、`has-cover` 等一增删就重读预设几何，用户拖过的尺寸会跳回默认；现在淡化、封面、内嵌声谱等 class 变化不再触碰几何。
4. 自动淡化从 5 秒改为 10 秒；`#pf-bg` 封面背景和 `::after` 不再被 `.pf-idle-dim` 压暗，只淡出标题、曲名、进度、传输按钮、列表、频谱头和 resize。
5. 内嵌声谱空白区改为真正透明：`clearWf()` 在内嵌模式 `clearRect`，独立浮窗仍铺黑底；暂停时内嵌也不再盖黑色遮罩。进出内嵌会重置瀑布缓冲，避免复用旧黑底。
6. 目录/队列文案补齐 en/de/ja/ru/vi/hi 六语言。
7. 「保存场景」不再放单独的覆盖按钮，但已有场景行可点击：确认后用当前布局更新该场景，窗口位置/大小/缩放/视口一起更新；＋ 新建仍另存一份。
8. 单曲没有内嵌封面时回退到所在文件夹封面（cover.jpg 或同目录第一首带封面的音频）；仍没有封面时用暗蓝玻璃底图，不再直接黑块。
9. 播放管理底部遮罩从 80% 降到 30%，顶部文字区仍保留足够压暗；独立频谱/声谱浮窗也改成透明 canvas + 玻璃底板，不再铺纯黑。
10. 瀑布图逐像素 alpha 跟随电平：`palette[0]` 的纯黑不再固定 `alpha=255`，低于亮度阈值的静音行 alpha=0，弱信号按 `ci` 渐入；有声区域仍是原调色板。此前顶部空白区透明、绘图区静音行却是完全不透明黑块，CSS 半透明只能把它压成“半透明黑”。

## 回归

命令：

```bash
python3 packaging/tests/cloud/run_cloud_suite.py --keep --report /tmp/ac2_v057j_suite_round11.json
```

结果：**API 50/50 + UI 37/37 = 87/87**，87.92 秒；`console_errors=[]`、`page_errors=[]`，未使用截图。

本轮新增/加强的 UI 断言：

- 播放中目录视图仍可进入其它文件夹、切「队列」只显示音频、切回「目录」继续浏览；暂停不锁视图，停止才回目录。
- 播放列表点曲后 `#spectrum-float` 可见状态不变，不二次弹窗；窗口固定 520×620 后点曲尺寸不跳回预设。
- 普通起播仍自动展开声谱，兼容原有浏览/网格入口。
- 10.6 秒无操作后 `.pf-idle-dim` 出现，周边控件 0.1、canvas 0.5、封面背景 `#pf-bg` 保持 ≥0.9 且数值不变、窗口仍 520×620。
- 内嵌声谱 canvas 顶部空白区 alpha ≤ 4；再用全零原生帧重建瀑布，绘图区 15 个采样点至少 12 个 alpha=0，确认静音行不再画不透明黑。
- 内嵌声谱 canvas 柱子/瀑布像素与 0.5 透明度仍通过；`#spectrum-float`、`#pf-sf-body`、`#pf-sf-host`、`#sf-canvas` 均无 opaque 背景。
- 独立频谱浮窗 canvas 背景为透明，不再是 `#080c11` 黑底。
- 无内嵌封面的 Track One 能回退到 `cover.jpg`（`/api/folder_cover`），播放管理仍保持 `has-cover`。
- 保存场景：新建后用 `.ss-row` 点击更新，确认弹窗、窗口几何 `w=488` 落库、`updatedAt` 写入；`.ss-overwrite` 按钮仍不存在。
- 左右滑、收藏同步、标题进元数据、增益滑杆等旧用例继续通过。

## 打包约定

本轮只构建**测试包名** `.dev`，不构建主干包名，避免未发布改动覆盖日常使用的正式版数据。

GitHub Actions 使用默认 `main_package=false`；构建产物包名应为
`com.github.olddriverdoge.audiocpm.dev`，与正式包可并存。

## 构建结果

- 提交：`1602625`（`fix: remove embedded spectrum veil (blur + full-window scrim) (0.5.6)`）
- GitHub Actions：run `44858355181`，`main_package=false`、`build_release=false`，success
- 产物：`Audio-CPM-0.5.6-86-dev-nofog.apk`（测试包，包名 `com.github.olddriverdoge.audiocpm.dev`）
  - 0.5.6 / versionCode 86
  - 大小 22,602,544 字节
  - SHA256 `8c8416cc8841d782adaedf75ccae73eaf4e3545dacf54a738876af4743bdde7b`
  - 下载：https://aka.doubaocdn.com/s/NjdImL77I7
- 回归：API 50/50 + UI 37/37 = 87/87

## 10 秒淡出后仍有"遮罩"的修正

现象：播放管理 10 秒无操作降到 10% 后，控件淡了，画面上仍留着整片暗色，标题区封面清晰、内部发灰。

原因：淡出只作用于控件元素（`#pf-head`、`.pf-now`、`.pf-transport` 等）的 `opacity`，而**铺底层不在淡出名单里**：`.pf-body` 的控件底色、`.mf-head` 的底色、`.play-float::after` 的全窗渐变都还是满强度。控件变淡后剩下的就是那几层颜色，看起来就是一层灰。

改动：`.pf-idle-dim` 状态下把 `.pf-body` 与 `.mf-head` 的背景置 none，`::after` 设 `display:none`，只剩封面。

量化（内嵌声谱 + 条纹封面，控件区 350×200 采样）：

| 状态 | 均值 RGB | 水平梯度 |
| --- | --- | --- |
| 修正前淡出 | 77.8 / 71.9 / 75.6 | 40.7 |
| 修正后淡出 | 158.7 / 139.6 / 140.6 | 88.0 |
| 声谱区（参照） | 160.9 / 141.2 / 142.2 | 91.2 |

修正后控件区与声谱区亮度、梯度基本一致，说明画面上只剩封面、没有任何附加层。

回归：API 50/50 + UI 37/37 = 87/87（`/tmp/ac2_round13.json`），新增三条断言：淡出后 `.pf-body`、`.mf-head` 不得有背景，`::after` 不得绘制。
