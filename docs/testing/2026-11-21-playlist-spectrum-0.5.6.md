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

- 提交：`2bbc1a3`（`feat: drop standalone spectrum module, bare idle visuals, hide meta cover (0.5.6)`）
- GitHub Actions：run `44860030917`，`main_package=false`、`build_release=false`，success
- 产物：`Audio-CPM-0.5.6-86-dev-bare.apk`（测试包 `com.github.olddriverdoge.audiocpm.dev`）
  - 0.5.6 / versionCode 86
  - 大小 22,602,844 字节
  - SHA256 `5de422cef2e51ee11ff99abe57677ee7aa2c70e27b807d77034ac09ba94450f1`
  - 下载：https://aka.doubaocdn.com/s/SUy8kGCU8N
- 回归：API 50/50 + UI 37/37 = 87/87

## 第 18 轮：头部去曲目名、淡出唤醒范围收窄、尺寸不再被自适应改回（提交 `947ef85`）

用户真机验收后追加三项：

| 问题 | 根因 | 修正 |
| --- | --- | --- |
| 播放管理顶部还显示文件名 | `#pf-head` 内 `#pf-track` 一直在 | 删除该节点，`renderMeta` 改为可空保护 |
| 别的模块一操作就把淡出唤醒 | `document` 上 capture 的 pointerdown/keydown 对任意目标都 `preventDefault+stopPropagation+wakeFromIdle` | 只处理 `win.contains(e.target)`；外部交互完全放行，既不唤醒也不吞事件；唤醒后的 click 抑制同样限定在窗口内 |
| 尺寸会被自动改回默认（首次起播、后台切回） | ① `SceneStore.apply` 打开内置场景后再跑一次 `fitCurrent()`，用**场景保存的旧几何**覆盖刚恢复的窗口；② `fitCurrent()` 以场景 geo 为源 + `force:true`，只要窗口间有点重叠就 `arrangePortrait/Landscape` 重排成默认尺寸；③ 转屏监听只看 `isLandscape()`，播放条/地址栏造成的几十像素抖动也会被当成转屏；④ WinMgr 的 `onRotate` 直接按 WebView 瞬时缩小的视口 `fit()`，把窗口压小并写回存储 | ① 内置场景默认定义不再触发重排；只有用户自己的场景才按保存几何落位；② `fitCurrent()` 改为**以当前实际几何为源**，非真转屏时只把跑出可视区的窗口收回（超出 >110% 才压缩），不再按重叠重排；③ 转屏判断要求宽高真正换向（长短边互换且差值 >80px）并 150ms 防抖；④ `onRotate` 增加稳定视口守卫，同方向骤然缩小（<72% 宽 / <60% 高）视为瞬时抖动不重算 |

回归新增断言：`#pf-track` 不存在；淡出期间向 `#fw-browse` 派发 pointerdown 仍保持 `pf-idle-dim`，派发到 `#play-float` 才唤醒；窗口落到 340×520 后触发 `resize` + `SceneStore.fitCurrent()` 尺寸不变，关闭再打开仍为 340×520。结果 API 50/50 + UI 37/37 = 87/87。

构建（run `44862875716`，提交 `947ef85`，`main_package=false` / `build_release=false`）：`Audio-CPM-0.5.6-86-dev-sizefix.apk`，22,604,448 字节，SHA256 `a9bb3a35bc071725d202bedcd474310fb075d8aeaac8bde3561a0e300687df62`，下载 https://aka.doubaocdn.com/s/DfVzJRbcmX 。

## 第 19 轮：真机仍“改回默认”——抓到真因（提交 `11c7c23`）

用前端真实交互复现（Playwright 移动视口 390×844）：

1. 打开播放管理 → 落位 340×520；
2. 双指捏合放大到 416×636、`--win-scale≈1.32`；
3. 点停止 `#pf-stop` → 再点曲起播 → 窗口回到 **340×520、--win-scale=1**（CSS 默认）。

根因：捏合只改 `rect` 和 `--win-scale`，几何**只在 pointerup 时 persist**。一旦 pointerup 没到
（系统手势抢触摸、切后台、停止播放打断手势、pointercancel 丢失），存储里还是上一次/默认几何，
下次 `apply()` 就按旧值恢复 —— 观感就是“尺寸被改回默认”，且 `--win-scale` 一起归 1。

修正：

- `WinMgr.zoomAt()` 结束后 450ms 防抖 `persist()`：即使 pointerup 丢失，尺寸与内容缩放也会落盘；
- `document.visibilitychange→hidden` 和 `pagehide` 时 `WinMgr.persistAll()`：切后台前保底落盘；
- 退化视口保护保留：`innerWidth/innerHeight < 200` 不参与 `fit()`，同方向骤缩（<72% 宽 / <60% 高）视为瞬时抖动。

A/B 验证（同一条用例，只回退上面两条落盘改动）：缩放后停止再播 → `416×636` 回退 `340×520`，用例失败；
带修正 → `416×636` / `--win-scale≈1.32` 保持不变，用例通过。全套 API 50/50 + UI 37/37 = 87/87。

构建（run `44874288259`，提交 `11c7c23`）：`Audio-CPM-0.5.6-86-dev-zoomsize.apk`，22,604,964 字节，
SHA256 `2698be8622f07ab8d8ad3cd4b6276749b20e0cdaa06fb79da962eb048e76ac74`，
下载 https://aka.doubaocdn.com/s/weEn7Batgt 。

## 第 20 轮：顶部按钮靠右 + 版本号 0.5.7（提交 `b1096ee`）

- 去掉 `#pf-track` 后 `.mf-head` 里没有可伸缩元素，`—` 按钮贴左：给 `.play-float .mf-title` 加 `flex:1 1 auto`、`#pf-min` 加 `margin-left:auto`，并加 UI 断言（按钮右边缘距头部右边缘 ≤10px、宽度 ≥18px）。
- 版本号按 `0.0.1` 递增：`versionName 0.5.7` / `versionCode 87`（`packaging/android/app/build.gradle.kts`、README 同步）。后续每次出包都递增 0.0.1。

构建（run `44903169121`，提交 `3897fd1`）：`Audio-CPM-0.5.7-87-dev.apk`，22,605,168 字节，
SHA256 `ae6ef03d49c601d4c52000fdc5281ff1799d9ab918eaa2df822618260d613a07`，
下载 https://aka.doubaocdn.com/s/zZMxOFAS9n 。
