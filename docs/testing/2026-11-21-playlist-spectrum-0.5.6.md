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

## 第 21 轮：系统级全局浮窗（播放管理）+ 0.5.8（提交 `0b00506`）

做法：`SYSTEM_ALERT_WINDOW` + 前台服务 `FloatingPlayService` + `WindowManager.addView(TYPE_APPLICATION_OVERLAY)`，
内容是一个**独立 WebView**，只加载本地服务的 `/?float=1`，不依赖工作台页面；播放状态用
`Player.hydrateNative()` 接管本机 HiFi 正在播放的曲目，拖动/缩放/关闭通过 `AudioCpmFloat` 桥驱动原生窗口。

- 原生：新增服务与五语言通知文案；`MainActivity` 增加 `floatPlayStatus/Start/Stop`，未授权时跳转
  `ACTION_MANAGE_OVERLAY_PERMISSION`，返回后自动开窗；窗口几何存 `SharedPreferences("ac2_float_geo")`。
- 前端：`floatmode.js`、`?float=1` 全屏样式、播放管理头部 `⧉` 按钮与设置页「全局浮窗」卡片，内含权限/运行状态。
- 浮窗页点击 `—` 关闭浮窗（播放本身在 `PlaybackService`，不受影响）；窗口内禁用手势改尺寸，尺寸由原生窗口决定。

调试中发现：`#play-float` 原本嵌在 `.app` 里，`body.float-mode` 隐藏 `.app` 会把播放窗口一起隐藏（测得 0×0）；
`FloatMode.boot()` 已把该节点挂到 `body` 下并清掉旧几何，`WinMgr.fit()` 在浮窗模式下直接跳过。

回归：API 50/50 + UI 38/38 = **88/88**（新增 `?float=1` 用例：仅播放管理、铺满视口、队列隐藏、`—` 靠右）。
构建（run `44904530044`）：`Audio-CPM-0.5.8-88-dev-float.apk`，22,614,777 字节，
SHA256 `710484d3f9dc344b8e4b3459e06f89e6a11c8055ad3f594a8781c6cef5e58bb5`，
下载 https://aka.doubaocdn.com/s/FipTtDV9uK 。

## 第 22 轮：浮窗拖动抖动 + 队列选择 + 声谱空白（0.5.9/89）

真机反馈三个问题，逐条处理：

1. **拖动时整窗抖动**：页面原来按 `clientX/clientY` 增量调 `moveBy`。窗口跟着手指移动后，`clientX`
   会相对视口反向变化，形成“移动→坐标变化→再移动”的反馈环。改为 `screenX/screenY` 绝对坐标：
   pointerdown 取 `AudioCpmFloat.pos()` 的原生窗口几何，pointermove 用绝对位移算出目标 x/y，
   走 `moveTo(x,y)`，并且每帧最多发一次（rAF 合并）。缩放同样改成绝对宽高 + `resizeTo`。
2. **浮窗没有播放列表**：去掉浮窗里隐藏 `#pf-qhead/#pf-queue` 的规则；浮窗默认“队列常驻 + 声谱常驻”，
   队列最多占 36% 高度，声谱占剩余空间。新增原生队列接口 `/api/playback/queue/list` 与
   `/api/playback/queue/play`，`Player.hydrateNative()` 拉取队列，浮窗里点行按原生下标跳播，
   不再用默认目录凑队列。没有原生队列时回退到当前目录浏览列表。
3. **声谱/频谱空白**：根因是主页面切到后台时 `Spectrum.onHidden()` 调 `playbackSpectrum(false)`，
   而原生 FFT 是进程级开关，把浮窗的声谱一起关掉了。后端加 6 秒“浮窗租约”：浮窗每次取数带
   `lease=1` 续约，租约期间忽略其它页面的关闭请求；浮窗关闭时 `pagehide` 发 `release=1` 立刻释放。
   前端 `Api.playbackSpectrum()` 在浮窗模式下自动带 lease。

回归：API 50/50 + UI 38/38 = **88/88**；浮窗用例新增“队列高度 ≥40px、声谱 ≥80px、队列在声谱上方”。

构建（run `44909286542`，提交 `b4724fc`）：`Audio-CPM-0.5.9-89-dev-floatfix.apk`，22,619,089 字节，
SHA256 `0599cc624028bd80254e190f97b94e09916618fab993d0d2053fae542f6e1ab7`，
下载 https://aka.doubaocdn.com/s/fpxt4Xj3Y9 。

## 第 23 轮：浮窗接管主 App / 进度条 / 声谱直连（0.5.10/90）

真机反馈 0.5.9 仍有三个问题，本轮按“浮窗独占播放会话”处理：

1. **进度条不动**：`FloatMode.boot()` 先把 `#play-float` 的 `hidden` 去掉，再调 `App.openModule('play')`；
   `openModule` 看到窗口已显示就直接返回（它本身是 toggle），导致播放管理的 500ms tick 根本没启动，
   `#pf-seek` 永远停在初始值。改为保留 `hidden` 状态交给 `openModule`，并兜底调用
   `App.playPanel().startLive()`。新增 UI 回归用例 `float overlay progress advances`，用 mock
   `/api/playback/state` 断言进度条从 1s 走到 3s。
2. **浮窗期间主 App 继续干活**：新增 `App.freezeForFloat()`：停 `Player` 状态轮询、停频谱取数、
   收掉内嵌声谱、关闭播放管理窗口并给 `body` 加 `float-handoff`；`onPlayed` 在 handoff 期间直接返回，
   不再自动拉起播放管理和声谱。浮窗启动成功后立即冻结；浮窗关闭或切回 App 时 `thawAfterFloat()`
   恢复轮询（不自动重开播放管理）。
3. **强制后台 / 回前台关浮窗**：`MainActivity.startFloatingPlay()` 启动服务 450ms 后 `moveTaskToBack(true)`；
   `onResume()` 若浮窗仍在运行且距启动超过 2 秒，直接 `stopService` 并执行 `thawAfterFloat()`。
   浮窗 WebView 补注入 `AudioCpmNative.spectrum/setParams`，声谱走 90Hz 直连而不是 30 次/秒 HTTP；
   直连路径 2 秒一次 `lease=1` 心跳续租，关闭时 `release=1`。
4. **浮窗不再改主页面偏好**：`showFloatLayout()` 不再写 `localStorage` 的“队列收起/声谱展开”，
   避免浮窗把主页面设置改掉、回 App 时自动弹出声谱。

回归：API 50/50 + UI 40/40 = **90/90**（新增浮窗进度条用例）。

构建（run `44910965594`，提交 `da19067`）：`Audio-CPM-0.5.10-90-dev-floatfix.apk`，22,620,785 字节，
SHA256 `dcd8a3eb936ff060890c3c169b9cabc1387d6be3dfff000abb2830b678505648`，
下载 https://aka.doubaocdn.com/s/6tU02a2EIL 。

## 第 24 轮：浮窗频谱真正空白根因（0.5.11/91）

0.5.10 真机验收：进度条已正常，频谱/声谱仍然空白。用 `?float=1` + 模拟原生频谱帧在浏览器里量 DOM，
发现 `#spectrum-float` 已经是 `is-embedded`，但它的 `getBoundingClientRect()` 是 **0×0**：

- `workbench.css` 里有 `body.float-mode .spectrum-float{display:none!important}`，本意是隐藏“独立频谱浮窗”，
  但 `setEmbedded(true)` 会把同一个节点挂进播放管理的 `#pf-sf-host`，这条规则把内嵌声谱也一起
  `display:none` 了。canvas 位图还在 300×120、每帧也在画（像素非黑），只是布局为 0 高，真机看起来就是空白。
- 改为 `body.float-mode .spectrum-float:not(.is-embedded){display:none!important}`。
  修后同一探针：canvas 368×501，3 秒内绘制像素从 12k 增加到 80k，进度 0.7→3.1s 同步前进。
- UI 回归补断言：浮窗里 `#sf-canvas` 必须 ≥100×100 且父节点不能 `display:none`，防止再次被外层规则压塌。

回归：API 50/50 + UI 40/40 = **90/90**。

## 第 25 轮：从 0.5.11 重新处理三项真机问题（0.5.14/94）

按要求把代码基线回退到 0.5.11（`6663dd5`），丢弃 0.5.12/0.5.13 的改动后重新修：

1. **频谱 Y 轴不跟设置**：`drawAxes()` 原来写死 `[0,-20,-40,-60,-80]`、底边固定 -80dB；
   柱图已经由原生按 `floorDb` 归一化，所以出现“柱子变了、刻度没变”。改为读取 `cfg.db`
   （-60/-80/-100）动态生成 5 条刻度，纵向位置统一按 `-db/floor` 计算。
2. **场景快捷入口把播放管理改回默认尺寸**：`SceneStore.apply()` 原来会用场景快照里的
   `play-float` 几何覆盖窗口自己的 `ac3_geo_play-float`，旧场景快照就是默认尺寸。现在
   写入/摆放几何时都跳过 `play-float`，播放管理始终使用用户最近一次保存的大小。
   新增 UI 回归：手动把播放窗口改成 300×480，再走“听歌”场景入口，尺寸必须保持。
3. **后台播放一卡一卡**：0.5.11 的系统浮窗 WebView 加载的是完整工作台，`App.init()` 会跑
   Sources 扫描、目录浏览、目标目录树、任务预设等；这些在后台持续产生 I/O/HTTP/DOM 负载，
   和 AAudio 抢 CPU。浮窗模式新增 `initFloatOnly()`，只初始化 Layout、频谱、播放管理和
   播放状态，不再跑工作台那套。另外播放错误巡检从 2 秒/次改成 10 秒/次，页面隐藏或
   `float-handoff` 时直接跳过，避免后台周期性唤醒。

回归：API 50/50 + UI 41/41 = **91/91**（新增场景快捷入口保持播放窗口尺寸用例）。

构建（run `44930172896`，提交 `c68f34e`）：`Audio-CPM-0.5.14-94-dev-rebase.apk`，22,621,441 字节，
SHA256 `d2998279f85be9c4367a604cef8bf4cbd773c2c31d814f06e4ce987b93681140`，
下载 https://aka.doubaocdn.com/s/hajr2f9zye 。

## 第 26 轮：浮窗恢复浏览/收藏/侧滑返回（0.5.15/95）

0.5.14 为了降后台负载，把浮窗页面的 `App.init()` 换成 `initFloatOnly()`，只初始化布局、频谱和播放管理。
这等于把 `BrowseView`、数据源和 `currentPath` 一起砍了：播放管理里的目录列表、收藏入口、
左右滑返回上级全部失效（它们分别依赖 `App.directories()`、`App.openFavorite()`、
`App.currentParent()`，底层都是 `bv` 和 `browse()`）。

处理：撤掉 `initFloatOnly()`，浮窗页面恢复和主 App 相同的完整初始化；后台减负只保留
“错误巡检 2s→10s、页面隐藏/float-handoff 时跳过”这一项安全改动。
新增浮窗回归：`?float=1` 下必须能列出目录、进入子目录、拿到上级路径。

回归：API 50/50 + UI 41/41 = **91/91**。

构建（run `44989968532`，提交 `b156406`）：`Audio-CPM-0.5.15-95-dev-floatnav.apk`，22,621,357 字节，
SHA256 `dca499a1b0029bd17bffa3ad89cfd0fa7500503744baee9e002243f98b9b3d3e`，
下载 https://aka.doubaocdn.com/s/3PP1hgamdI 。

## 第 27 轮：浮窗上下首/停止后目录、窗口尺寸、通知栏浮窗（0.5.16/96）

这一轮仍以 0.5.11 为基线重做，只改四项已复现的问题：

1. **浮窗上一首/下一首没反应**：`App.playNext/playPrev` 原先按“文件浏览当前可见列表”找下一首，
   浮窗的当前目录不一定是起播目录，索引找不到就表现为没反应。浮窗模式（`?float=1`）
   且原生播放活跃时，改为直接按原生队列 `Player.remoteIndex` 步进，并取模循环。
2. **浮窗停止后目录列表不完整**：`App.playbackQueueList()` 以前只要原生队列非空就优先返回，
   而 `Player.close()` 只停播、不清原生队列，于是目录界面拿到的是起播时那一小段残留队列。
   条件收窄为“浮窗 + 有当前曲 + `hifiActive()` 为真 + 原生队列非空”；停止后自动回退到当前目录完整音频。
3. **App 内每一步操作重置窗口尺寸**：根因在 `WinMgr.apply()`——每次 refresh 都 `readGeo()`
   重新读上一次落盘的几何并覆盖刚调整的 `rect`。改为：已经量过/摆过的窗口后续 `apply()`
   沿用自己的 `rect`，只有首次打开才读存档。开过一次浮窗后问题“消失”，正是因为那时几何已落盘。
4. **通知栏播放器加浮窗按钮**：`PlaybackService` 通知新增 `action_float`（五种语言），
   `PendingIntent.getActivity` 打开 `MainActivity` 并带 `AUDIO_CPM_SHOW_FLOAT`；`MainActivity`
   增加 `onNewIntent`、`singleTop`，等页面 `onPageFinished` 后再拉起浮窗；无权限时走现有授权返回重试。

回归：API 50/50 + UI 43/43 = **93/93**（新增“浮窗上下首走原生队列 + 停止后回退完整目录”、
“普通重排不重置播放窗口尺寸”两项 UI 断言）。

构建（run `45010185540`，提交 `76282ff`）：`Audio-CPM-0.5.16-96-dev-floatqueue.apk`，
文件大小 `22,623,293 字节`，SHA256 `98f569c1879f1ec23b2bd6559139d75ea7b4514226565009faee8b13d08d30ad`，下载 `https://aka.doubaocdn.com/s/fTngVlHEHo`。
