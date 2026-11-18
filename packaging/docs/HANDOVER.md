# Audio-CPM 交接文档

- 入口文件：[ac_web.py](../../ac_web.py)（12 行，只负责启动）
- 后端：[backend/](../../backend/)（配置 / ffmpeg / 任务 / 路由 / 波形，按职责分模块）
- 前端：[frontend/](../../frontend/)（`index.html` + `css/` 6 个 + `js/` 16 个，无构建）
- 文档更新时间：2026-11-15
- 运行形态：Termux / Android 本地 FastAPI 服务 + 浏览器单页应用
- 分发形态：整个目录（后端包 + 静态前端），启动命令不变

---

## 1. 项目是做什么的

Audio-CPM 是给本地音乐库用的音频工具，两个页面：

**文件处理**
- 目录浏览（列表 / 网格、封面缩略图、排序、搜索、最近播放筛选）
- 批量任务：格式转换、整理标签、替换封面、检查标签
- SSE 实时进度 + 日志 + 元数据查看/编辑（处理页只保留浏览与任务两个 panel）

**文件整理**
- 左侧：元数据面板（封面、音频参数、可编辑标签）
- 右上：源文件选择（文件夹 + 文件、搜索、排序、最近播放、勾选、播放）
- 右下：目标目录树（惰性加载、长按菜单：新建/重命名/删除空目录）
- 底部：移动条（skip / rename / overwrite）+ 单级撤销

**全局**
- 底部网页播放条（后端流式 + 浏览器解码，可拖进度）
- ⚙ 播放设置（网页内播放 / 系统播放器 + 包名 + Activity）

---

## 2. 运行环境与启动

### 依赖

```bash
pip install fastapi uvicorn
# 系统命令：ffmpeg、am（Termux 需安装 ffmpeg；已不再依赖 ffprobe）
```

### 启动

```bash
cd /data/user/0/com.termux/files/home/dsh/audio_manager
python3 ac_web.py                 # 默认 127.0.0.1:8000
python3 ac_web.py --port 8080
python3 ac_web.py --host 0.0.0.0  # 局域网访问（无鉴权，慎用）
```

### 当前部署方式（nohup）

```bash
nohup python3 ac_web.py > ac_web.log 2>&1 &
echo $! > ac_web.pid
tail -f ac_web.log
kill "$(cat ac_web.pid)"
```

- 访问：`http://127.0.0.1:8000`
- 日志：`ac_web.log`；PID：`ac_web.pid`
- 运行时文件：首次保存预设会生成 `ac2_presets.json`
- 封面临时缓存：`$TMPDIR/ac2web_covers`（默认在 Termux tmp 下）

### 文件位置约定

| 项 | 路径 |
|---|---|
| 脚本目录 | `SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))` |
| 预设文件 | `SCRIPT_DIR/ac2_presets.json` |
| 默认根目录 | `/sdcard/ADM`，不存在则 `~` |
| 缩略图缓存 | `tempfile.gettempdir()/ac2web_covers` |

---

## 3. 代码结构（前后端分离）

```
ac_web.py                 启动入口：from backend.cli import main
backend/
  config.py               路径/缓存/二进制常量（AC2_DATA_DIR / AC2_ROOT / AC2_FFMPEG_BIN）
  meta.py                 元数据/封面：全部走 mutagen；支持本地路径与 Range 流
  ffmpeg.py               execute（env 透传）、进度解析、递归收集
  ffbin.py                ffmpeg 定位：Termux 用 PATH，app 内从 nativeLibraryDir 复制+LD_LIBRARY_PATH
  aiff.py                 AIFF/AIFF-C → WAV 纯 Python 重封装（播放用，无 FFmpeg 兜底）
  jobs_core.py            转换 / 标签 / 封面 / 检查 + edit_tags_file
  presets.py              预设读写（PRESETS_FILE 在 DATA_DIR）
  jobs.py                 tasks 字典 + create_task（线程 + 队列 + SSE + 取消 + 并发信号量 + 持久化）
  waveform.py             波形包络：provider（ffmpeg / WAV 纯 Python / 预留 native 桥）+ 缓存
  simple.py               Starlette 工具：JSON 响应、query/body 读取
  storage/                存储抽象：ref（URI）/ 本地 / WebDAV（PROPFIND、Range、MOVE）
  app.py                  Starlette 装配：API 路由 + StaticFiles(frontend)
  cli.py                  argparse + uvicorn.run（支持 AC2_HOST/AC2_PORT）
  routers/                browse_api / tags_api / tasks_api / media_api / fs_api / ui_api / storage_api
frontend/
  index.html              纯结构，外链 css/js
  css/                    base / controls / layout / process / organize / overlays
  js/                     keys→store→utils→api→uicfg→wave→settings→player→playmgr→
                          thumbmgr→browse→taskrunner→metaview→treeview→
                          movemgr→layout→spectrum→app（经典脚本按序加载，共享全局词法作用域）
```

- 前端不引入构建：`index.html` 里按依赖顺序 `<script src>`，模块仍是 IIFE 命名空间（`const App = (() => {…})()`），只是拆到独立文件，语义与单文件版一致。
- 静态前端由 `app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True))` 提供，挂载顺序在所有路由之后；`GET /` 即 `frontend/index.html`。
- `GET /api/*` 行为、请求体、返回结构均未变。


---

## 4. 后端接口

### 原有接口（保留）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/browse?path=` | 目录列表；非法路径回退默认根；返回 dirs/files/cover |
| GET | `/api/image?path=` | 返回图片文件 |
| GET | `/api/cover?path=` | 提取内嵌封面为 jpg（缓存 `md5(path+mtime)`） |
| GET | `/api/probe_file?path=` | mutagen 详情（格式/音频流/封面/标签；无 ffprobe） |
| POST | `/api/edit_tags` | 写回标签（ffmpeg 重写临时文件后替换） |
| GET/POST | `/api/presets` | 读写预设 |
| POST | `/api/start` | 启动任务，返回 `task_id` |
| GET | `/api/task/{id}/status` | 任务状态/结果 |
| GET | `/api/task/{id}/stream` | SSE 进度流 |
| POST | `/api/task/{id}/cancel` | 取消任务（queued 立即取消；running 置取消标志，ffmpeg 被 terminate/kill） |
| GET | `/api/tasks` | 任务列表（含重启后 `interrupted` 的未完成任务） |

### v3 新增接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/play` | 系统播放器 intent：`{path, player?, activity?}`；白名单 `/sdcard`、`/storage/emulated/0` |
| GET | `/api/stream?path=` | 网页播放流；`FileResponse`，支持 Range（206） |
| GET | `/api/thumb?path=&size=` | 缩略图；size 48/96/128/192，其余按 96；缓存 `md5(path|mtime|size)` |
| GET | `/api/waveform?path=&buckets=` | 波形包络（32~400 桶，0~1）；ffmpeg 解码 4kHz 单声道 PCM 取峰值，20% 分位做对比度拉伸；缓存 `md5(v2|path|mtime|size|buckets)` 到 `$TMPDIR/ac2web_wave`，内存最多 60 条 |
| GET | `/api/tree?path=` | 仅直接子目录 + `has_children` |
| POST | `/api/move` | `{sources[], target, conflict}`；源可以是文件或整个目录（目录不参与 overwrite）；返回 results/moved/skipped/failed |
| POST | `/api/mkdir` | `{parent, name}`；非法名/已存在有明确错误 |
| POST | `/api/rmdir` | 只删空目录；非空返回「目录非空」 |
| POST | `/api/rename_dir` | `{path, new_name}`；目标存在则报错 |
| POST | `/api/delete` | `{paths:[...]}`；文件删除 / 目录递归删除；仅 `/sdcard`、`/storage/emulated/0`，拒绝根目录 |

### 存储源接口（v4.0，`backend/routers/storage_api.py` + `backend/storage/`）

路径统一用引用 URI：`local:/sdcard/x`、`dav:<源id>/Music/x`；旧裸路径 `/sdcard/...` 按本地处理。
所有现有接口的 `path` 参数都接受引用 URI，前端无需区分两种源。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/roots` | 数据源列表 + 每个源的能力 caps（local：全量；dav：browse/meta/play/move/delete/mkdir） |
| GET | `/api/storage/sources` | 存储源配置（密码脱敏） |
| POST | `/api/storage/sources` | 新增/更新源：`{id, kind:'local'|'dav', name, url, username, password, readonly, root}` |
| POST | `/api/storage/sources/delete` | 删除源（local 不可删） |
| POST | `/api/storage/test` | 测试连接（PROPFIND + privilege 判断可写） |

配置文件：`ac2_storage.json`（DATA_DIR）。WebDAV 只做只读优先：浏览 / Range 播放 / Range 元数据 / 封面 / 下载；
远端内部移动、删除、新建目录走 WebDAV 原生 `MOVE/DELETE/MKCOL`；**跨源搬运不做**（`cross_source_not_supported`）；
标签写入仅本地（dav 返回 `readonly_source`）；波形 dav 返回 `501`。

### 界面配置接口（v3.16，`backend/routers/ui_api.py`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ui_config` | 返回 `{config, presets, active, file}`；文件不存在时为空对象 |
| POST | `/api/ui_config` | 保存当前配置 `{config:{...}}`；内容与已有相同则跳过写盘 |
| POST | `/api/ui_config/preset` | 保存命名预设 `{name, config}`，同时设为当前配置 |
| POST | `/api/ui_config/preset/load` | 加载预设 `{name}`，返回 `{config}` 供前端应用 |
| POST | `/api/ui_config/preset/delete` | 删除预设 `{name}` |

- 文件：项目根 `ac2_ui_config.json`（`UI_CONFIG_FILE`，`indent=1`，限制 512KB，tmp + `os.replace` 原子写）。
- 前端 `uicfg.js`：启动时 `GET` 并用文件里的 `config` 覆盖 localStorage（服务器优先）；之后包装 `Store.set/remove`，800ms 防抖把 `K` 全量键回写。设置面板可保存/加载/删除预设，并支持导出/导入 JSON。
- 首次启动（文件为空）会把浏览器现有 localStorage 配置推上去，因此"发版/换浏览器/清缓存"后配置不丢。

### 关键行为

- `/api/move` 用 `shutil.move`，跨文件系统自动 fallback；同名时按 `conflict` 处理；`samefile` 返回 skip。目录：`skip`/`rename` 可用，`overwrite` 返回 `target_exists`，移入自身/子目录返回 `into_self`。
- `/api/play` 校验包名 `^[A-Za-z0-9._]+$`、Activity `包名/Activity`；命令：
  `am start -a android.intent.action.VIEW -d file://... -t audio/* [-p pkg | -n act]`
- `/api/stream` 只允许 `MEDIA_EXTS`；前端 `<audio>` 依赖 Range 拖动进度。

---

## 5. 播放设计（重点）

### 两条通道

| 模式 | 存储值 | 行为 |
|---|---|---|
| 网页内（默认） | `ac2_play_mode = "web"` | `Player.open()` 设置 `<audio src="/api/stream?...">`，进度/暂停/音量在页面控制，不拉起任何 App |
| 系统播放器 | `"system"` | 调 `/api/play`，`am start` 拉起指定包名（默认 Poweramp），可弹选择框/切前台 |

- 播放条按钮：播放/暂停、进度条、当前/总时长、音量、`↗`（本次用系统播放器）、`✕`。
- 播放条出现时 `body.has-player`，`.app` 高度减去 58px，避免遮挡移动条。
- 网页播放仍会触发 `App.onPlayed()`：自动勾选 + 整理页元数据联动 + 🔊/圆点标记。
- 浏览器的 `MediaSession` 已接播放/暂停/seekto（锁屏控制）。

### 已知限制

- 浏览器能解：flac / mp3 / m4a / wav / ogg / opus；**ape / dsf / wv 不支持**，会 toast 失败，需点 `↗` 用系统播放器。
- 本机没有 mpv/ffplay，`termux-media-player` 也不支持 seek，所以**没有做“后端进程自己出声”的播放器**。当前“网页播放”是后端流式 + 浏览器解码，关掉浏览器即停止。
- 若要“关掉浏览器仍继续播放”，需要引入 mpv（IPC 控制）或改造 Termux:API 播放器，属于新功能。

---

## 6. 前端模块职责

| 模块 | 职责 |
|---|---|
| `Store` | localStorage 读写（JSON 序列化） |
| `Utils` | Collator、大小/时间格式化、转义、toast、日志、modal、hash |
| `Api` | 所有 fetch 封装；非 2xx 抛 Error |
| `Settings` | 播放器包名/Activity/播放方式，打开/保存设置面板 |
| `Player` | `<audio>` 控制、进度、音量、MediaSession、播放条显隐（仅网格视图弹出） |
| `Wave` | 波形预览：`/api/waveform` → 竖条 canvas → dataURL，播放条与列表行复用；模糊交给 CSS `filter:blur()` |
| `PlayMgr` | 播放入口（web/system 分流）、已播放集合、自动勾选；同一首再点 ▶ 为播放/暂停 |
| `ThumbMgr` | IntersectionObserver 懒加载缩略图 |
| `Columns` | 列表表头自定义（缓存 `ac2_columns`）+ 标签列懒加载（`/api/probe_file`，并发 3，按 path+mtime 缓存） |
| `BrowseView` | 列表/网格渲染、排序、筛选、选择、长按菜单（多选/删除）、超宽跑马灯；两个页面共用同一份实现与行为配置 |
| `TaskRunner` | 任务启动、SSE、进度条、日志、预设 |
| `MetaView` | probe 渲染、标签编辑/保存、封面预览；工厂函数，两页各一个实例 |
| `TreeView` | 目标树惰性加载、展开记忆、长按菜单、新建/重命名/删除 |
| `MoveMgr` | 移动、冲突策略、单级撤销 |
| `Layout` | split2/split3 拖动与 localStorage |
| `Spectrum` | 实时频谱：共享分析核心 + `Spectrum.create(选择器)` 多视图，两页各挂一个视图（XY 坐标轴、后台恢复） |
| `Sources` | 数据源（本地/WebDAV）：下拉切换、存储源增删、按 caps 禁用本地处理入口 |
| `App` | 页面切换、路径浏览、联动、初始化编排 |

### 页面与布局

- Header：`文件处理 | 文件整理`、列表/网格、封面 S/M/L、⛶ 全屏、⏭ 顺序、⚙ 设置。
- 处理页：左侧 `#p1-main`（文件列表 + 任务配置/日志），右侧 `#p1-side` 元数据 + 频谱（默认收起贴边）。
- 整理页：
  - 左：元数据，**固定内容宽度 `--meta-w: 340px`**；拖分隔条只改变可见区域（`overflow-x:auto` 遮挡），内部不重排。
  - 右上：源文件选择（compact）：文件夹 + `.. 上级目录` + 文件；文件名省略号、大小列固定 58px、时间列隐藏。
  - 右下：目标树，行宽 `max-content`，可横向滑动看完整深层目录。
  - 底部：已选数量 → 目标 → 冲突策略 → 移动 / 撤销。

---

## 7. localStorage 键

| 键 | 含义 |
|---|---|
| `ac2_last_path` | 处理页最后路径 |
| `ac2_s2_last_path` | 整理页最后所在目录 |
| `ac2_page` | 当前页面 `process` / `organize` |
| `ac2_view_mode` | `list` / `grid` |
| `ac2_grid_size` | 96 / 128 / 192 |
| `ac2_sort_by` / `ac2_sort_order` / `ac2_folder_order` | 排序字段/方向/文件夹三态 |
| `ac2_s2_sort_by` / `ac2_s2_sort_order` | 整理页源列表排序 |
| `ac2_autocheck_on_play` | 播放自动勾选（默认 true） |
| `ac2_conflict_mode` | skip / rename / overwrite |
| `ac2_recent_paths` | 最近 15 个路径 |
| `ac2_played` | 最近 200 条已播放路径 |
| `ac2_layout_split2` / `ac2_layout_split3` | 左右、右侧上下比例 |
| `ac2_target_path` | 目标树根路径 |
| `ac2_tree_expanded_<hash(root)>` | 该根下展开节点（最多 200 条） |
| `ac2_player_pkg` / `ac2_player_activity` | 系统播放器包名/Activity |
| `ac2_play_mode` | `web` / `system` |
| `ac2_s2_view_mode` | 整理页文件选择区视图：`compact`（默认）/ `list` / `grid` |
| `ac2_tree_roots` / `ac2_tree_active` | 目标目录多标签的根列表与当前激活下标 |
| `ac2_columns` | 列表表头配置：`{v:3, ids:["name","size","mtime",...], custom:[{key,label}], widths:{列:px}}`；ids 顺序即勾选顺序，自定义列以 `c:<key>` 参与勾选与排序 |
| `ac2_movebar_collapsed` | 底部移动条是否收起（横屏省空间） |
| `ac2_autoplay` | 顺序自动播放开关（播完自动下一首） |
| `ac2_meta1_collapsed` | 处理页右侧元数据栏是否收起（默认收起） |
| `ac2_spectrum_size` | 全局频谱浮窗尺寸 `{w,h}` |
| `ac2_spectrum_pos` | 全局频谱浮窗停靠边与高度 `{side:'left'|'right', top}` |

---

## 8. 关键实现细节 / 容易踩的坑

1. **请求竞态**：`browse` / `srcBrowse` / `tree.setRoot` 都有序号守卫，后发起的请求优先，过期响应丢弃。
2. **排序**：文件和文件夹共用 `itemComparator()`；`mtime` 排序用名称做 tiebreak；文件夹三态（优先/混合/后置）。
3. **元数据固定宽**：`#meta2` 和左栏标题都 `width:var(--meta-w)`；左栏 `overflow-x:auto; overflow-y:hidden`，拖分隔条只遮挡。
4. **文件列表固定列**：行宽 100%，文件名 `ellipsis`；compact 显示大小、隐藏时间；避免列随文件名漂移。
5. **目录树横向滚动**：`.tree-node{min-width:max-content}` + `.tree-row{width:max-content}`，名称不截断。
6. **撤销**：`MoveMgr` 只保留上一批 `{src,dst}`，反向时逐对 `Api.move([dst], dirname(src), 'skip')`；移动后刷新源列表时不能清空撤销记录（`srcBrowse(..., {clearUndo:false})`）。
7. **长按菜单**：500ms 定时 + 位移 >10px 取消；同时支持右键（桌面）。
8. **封面缓存**：缩略图 `md5(path|mtime|size)`，原图 `/api/cover` 用 `md5(path+mtime)`；目前没有容量清理（P1）。
9. **播放条**：`<audio>` 必须由用户手势触发 `play()`；失败时提示改用 `↗`。
10. **拖拽分隔条**：pointer 事件 + `touch-action:none`；move/up 挂在 `window`，避免手机触摸丢事件。
11. **表头列**：`Columns.cellsHtml()` 先渲染空单元格，`hydrate()` 再按 `path+mtime` 懒取 `/api/probe_file` 回填；`fill()` 只改 DOM 不整表重渲染，避免滚动位置丢失。改表头走 `App.refreshColumns()`。
12. **整理页点击**：`clickPlays` 模式下一律播放；点任意行按 `clientX` 比例，新曲目走 `Player.open(path, ratio)`（一次点击即播放并落到点击位置），当前曲目走 `Player.seekRatio()`。`Player` 的行内 seek 监听跳过 `#view2`，避免双重跳转。
13. **表头排序**：`BrowseView.st.sorts` 是 `[{key,dir}]`，点表头按 升→降→取消 三态循环，条件按点击先后生效；`size/mtime/标题/元数据列` 都可排，元数据列依赖 `Columns.tagValue()` 的缓存。
14. **波形**：`/api/waveform` 冷启动要解码整首（5 分钟曲约 0.7s），之后走磁盘/内存缓存；播放条与行内共用同一 dataURL，`Player.paintRows()` 必须在每次 `render()` 后重贴，否则列表重渲染会丢背景。

---

## 9. 已知限制 / 风险

- **无鉴权**：`--host 0.0.0.0` 会把浏览、移动、删除、标签编辑、流播放全部暴露给局域网；仅在可信网络使用。
- **路径不受限**：`/api/stream`、`/api/image` 等可读取进程有权限的任意路径；`/api/move` 等可改文件。不要暴露公网。
- **浏览器格式限制**：ape/dsf/wv 网页播不了。
- **没有后端进程播放**（见第 5 节）。
- **P1 未做**：缩略图缓存 200MB 清理、网格 300 条渲染上限。
- **单用户假设**：`tasks` 是进程内字典，多客户端共用；没有用户隔离。
- **`am` 的 `file://` intent** 在部分 ROM 上不记忆默认应用；系统播放器模式才需要包名锁定，网页内播放不受影响。

---

## 10. 测试与验收

项目没有入库测试代码，回归用临时 jsdom 脚本（`$TMPDIR/ac2js/smoke2.mjs`，直接加载 `http://127.0.0.1:8000/`，可覆盖静态资源与接口）。复现方式：

```bash
mkdir -p "$TMPDIR/ac2js" && cd "$TMPDIR/ac2js"   # Termux 的 /tmp 不可写
npm init -y && npm install jsdom
# 启动服务后，用 jsdom 加载 http://127.0.0.1:8000/
```

jsdom 里必须补的桩：

- `IntersectionObserver`（懒加载）
- `EventSource`（SSE）
- `HTMLMediaElement.prototype.play/pause/load/paused`（网页播放）
- `alert/confirm/prompt`、`navigator.vibrate`
- `HTMLCanvasElement.getContext/toDataURL`（波形渲染，返回空上下文/假 dataURL 即可）
- 回归脚本（都在 `$TMPDIR/ac2js`，从 HTTP 加载真实页面）：
  - `node smoke2.mjs`：总流程 42 项（浏览、播放条、波形、视图切换、收起态、长按选择）
  - `node pause.mjs`：播放/暂停与按钮状态 15 项（列表/网格、图标同步、收起栏尺寸）
  - `node ui9.mjs`：面包屑/全屏/缩略图/修改时间列/选择工具条/拖动换序/行首播放/多标签/目录选择/目标目录收起 33 项
  - `node cols.mjs`：表头与整理页点击 31 项（缓存、懒加载、自定义列、列宽/换序、三态排序、一次点击落到进度）
- `window.fetch` 拦截 `/api/play`（避免真的拉起播放器）

已覆盖的验收点：

- 页面拆分 / 默认页 / 处理页两个 panel
- mtime 排序 + 文件夹三态 + 名称 tiebreak
- 列表固定列、compact 显示大小
- 元数据固定 340px 不随拖动重排
- 分隔条拖动（左右 / 右侧上下）与 localStorage
- 整理页文件夹导航 + `.. 上级目录`
- 网页播放：`/api/stream`、进度拖动、暂停、时长、模式切换
- 移动 / 撤销、长按菜单新建/重命名/删除
- 标签编辑保存、预设保存/删除

### 后端手测

```bash
curl -s "http://127.0.0.1:8000/api/tree?path=/sdcard/ADM"
curl -s -H 'Range: bytes=0-99' -D - "http://127.0.0.1:8000/api/stream?path=<urlencoded>" | head
curl -s -X POST http://127.0.0.1:8000/api/move \
  -H 'Content-Type: application/json' \
  -d '{"sources":["/sdcard/a.flac"],"target":"/sdcard/dst","conflict":"skip"}'
```

---

## 打包交接

- App 打包（p4a + FFmpeg 转码）的完整交接清单见 [APP_PACKAGING_HANDOFF.md](APP_PACKAGING_HANDOFF.md)

---

## 11. 排障

| 现象 | 处理 |
|---|---|
| 页面打不开 | `tail -f ac_web.log`；确认端口未被占用；`pgrep -af ac_web.py` |
| 端口占用 | `--port 8080` 或先 kill 旧进程 |
| 浏览报无权限 | `termux-setup-storage`；确认 `/sdcard` 可读 |
| 播放没声音 | 网页模式看浏览器是否拦截自动播放；flac 是否被支持；系统模式检查包名 |
| 点播放弹选择框 | 设置里切「系统播放器」并填包名；或直接用默认网页内播放 |
| 缩略图不显示 | 文件是否真的有内嵌封面；`ffmpeg` 是否可用 |
| 移动失败 | 目标是否存在、是否同名、源是否被外部删除 |
| 分类/标签任务失败 | 查看日志里的 ffmpeg stderr；确认文件未被占用 |

---

## 12. 后续可做（按优先级）

1. 缩略图缓存清理（>200MB 删最旧 20%）
2. 网格模式默认渲染上限 + 「加载更多」
3. 把前端从 Python raw string 拆成 `ac2_ui.html` + 构建内联（降低维护成本）
4. 后端播放器（mpv IPC）支持关页面继续播放
5. 简单鉴权 / 只监听 127.0.0.1 的启动提醒
6. 单元测试入库（pytest + jsdom）

---

## 13. 变更记录（本轮）

- 单文件 Audio-CPM 从 v2 升级到分页版：
  - 新增 `/api/play`、`/api/stream`、`/api/thumb`、`/api/tree`、`/api/move`、`/api/mkdir`、`/api/rmdir`、`/api/rename_dir`
  - 前端拆成两个页面；整理页左右分屏 + 可拖分隔
  - 播放：网页内流播放（默认）+ 系统播放器模式
  - 修复：文件夹 mtime 排序、快速跳转竞态、移动撤销被清空、紧凑列表缺大小列、整理页文件夹丢失
  - 布局：元数据固定 340px、列表固定列、目录树横向滚动、窄屏保持左右分屏
- 后续小改（v3.1）：
  - 播放条新增 40px 封面位 `#pb-cover`：有内嵌封面走 `/api/thumb?size=96`，无封面保留 ♪ 占位图（`error` 回退）
  - 移动条新增「收起 / 展开」`#mv-toggle`：收起只留计数行，状态存 `ac2_movebar_collapsed`
  - 整理页源文件区新增视图切换按钮（紧凑→列表→网格循环，`#s2-view-btn`，存 `ac2_s2_view_mode`），仅作用于源文件列表，目标目录树仍为树状；网格模式补「.. 上级目录」磁贴
- 波形进度（v3.2）：
  - 新增 `GET /api/waveform`（`compute_wave_peaks`：ffmpeg→4kHz 单声道 PCM→160 桶峰值→20% 分位拉伸），磁盘+内存双缓存
  - 新增 `Wave` 模块：峰值画成 900×64 竖条 canvas（暖色渐变 `#fed7aa→#fb923c→#ea580c`），`toDataURL` 后复用；「虚化」只用透明度分层，不加 blur，保证棱角清楚
  - 播放条进度条换成波形：底层暗波形 + 上层高亮同图按 `clip-path: inset(0 X% 0 0)` 裁剪，拖动仍走透明 `input[type=range]`
  - **播放条只在网格视图弹出**（`App.isGridView()` 看当前页签：处理页 `viewMode`，整理页 `s2ViewMode`）；列表/紧凑视图改为在正在播放的行铺 `.row-wave` 背景，点行内空白按比例跳转
  - `PlayMgr.play` 同一首再点 ▶ 改为播放/暂停
  - 回归脚本：`$TMPDIR/ac2js/smoke2.mjs`（jsdom + HTTP，42 项：条显隐、波形挂载、裁剪同步、行内波形重贴、反复切换不重复、视图循环、收起态、长按选择）
- 交互细化（v3.2.1）：
  - 播放中行：文件名隐藏、让位给波形；点行内空白按比例 seek，名称不再触发元数据
  - 复选框默认隐藏，长按文件（500ms，位移 >10px 取消）才进入选择模式并勾选；`清空` 退出选择模式
  - 列表行去掉「播放记录」🔊 列（网格角标保留）
  - 移动条收起后 `position:fixed` 贴右边，脱离文档流，把高度让给树/列表
  - 元数据面板默认贴左收起成 26px 竖排标签（`ac2_meta_collapsed`），点头部展开/收起；点右侧文件名会自动展开
- 结构重构（v3.3）：
  - 前后端分离：`ac_web.py` 只剩 12 行启动入口；后端拆 `backend/`（config / ffmpeg / jobs_core / jobs / presets / waveform / models / app / cli / routers×5），前端拆 `frontend/`（index.html + 6 css + 16 js）
  - 前端仍是经典脚本按序加载、IIFE 命名空间，零构建；`GET /` 改由 `StaticFiles(html=True)` 提供
  - 接口路径、请求体、SSE 行为不变；拆分后全量回归 42/42 通过
- 整理页交互与表头（v3.4）：
  - 整理页取消「点文件名开元数据」（播放已自动联动 `meta2`），点击一律播放；长按仍是选择
  - 点当前曲目所在行 = 按点击横向比例直接 seek（`Player.seekRatio()`，列表按行宽、网格按磁贴宽），不用拖
  - 播放行波形改为半透明（`rw-base .22` / `rw-hi .58`），文件名恢复显示并加描边；网格磁贴按钮同步 ▶/⏸
  - 列表表头可自定义：文件名 / 编号(track) / 作曲家(composer) / 专辑(album) / 作家(artist) + 自定义 key+显示名；选择存 `ac2_columns`；缺省表头补上「文件名」；大小 / 修改时间固定保留
- 路径栏极简 + 去紧凑（v3.15）：
  - 两个页面的路径选择改为面包屑：点某一段跳到该级（上 N 级），长按整行弹输入框编辑路径；删掉输入框/跳转/上级/最近/展开体
  - 目标目录同样用面包屑（在标签页下方），保留 ⟳ 刷新；长按可改当前标签根
  - 整理页源列表只剩 列表 / 网格 两态，`ac2_s2_view_mode` 里的旧 `compact` 自动当 `list`
- 目标目录默认收起（v3.14）：
  - 整个目标目录模块默认折叠成一行标题（`#tree-head`，显示当前根路径），点击展开/收起；状态存 `ac2_tree_collapsed`
  - 收起时隐藏标签/路径/树与分隔条，源文件列表用 `!important` 抢回高度（`flex:1 1 auto`）
- 目录也可选中（v3.13）：
  - 整理页长按文件夹同样进入选择模式并勾选（列表与网格都有 `.dir-chk`）；移动条计数改为“已选 N 项”
  - `/api/move` 接受目录源：skip/rename 生效，overwrite 对目录拒绝（`target_exists`），移入自己是 `into_self`
- 行首播放与多目标目录（v3.12）：
  - 列表行的播放按钮移到最前（行首），表头加同宽占位保持列对齐；目录行同样留位
  - 目标目录支持多标签：`.tree-tabs` 点切换、`＋` 新增（prompt 输入路径）、长按标签移除；状态存 `ac2_tree_roots` / `ac2_tree_active`，手动输入路径会替换当前标签
- 列宽手感优化（v3.11）：
  - 列宽拖拽热区 22px、向两侧溢出 6px，可见 2px 分隔线，hover/拖动时高亮为强调色
  - 未点中手柄时，落在列名右缘 12px 内也按拖宽处理（触屏手指容错）
- 选择与播放解耦（v3.10）：
  - 播放（含点击文件、自动播放）不再产生任何勾选；去掉头部「播放自动勾选」开关（`ac2_autocheck_on_play` 弃用）
  - 选中只由长按进入选择模式触发；点击文件只负责播放/定位
- 修改时间列修复（v3.9）：
  - 去掉 `#view2 .item .mtime{display:none}`：这条例外规则让整理页表头有“修改时间”列却没有值
  - 表头单元格去掉右侧 padding，列宽与数据行严格对齐，修改时间不再被挤
- 列名修正（v3.8）：
  - 原「标题」列恢复为「文件名」；新增「标题」预设 = 音频 `title` 元数据（懒加载填充，可排序/调宽）
- 选择模式修正（v3.7）：
  - 默认不进入选择模式：复选框隐藏（`.view-wrap .chk{opacity:0}`），长按文件才进入 `sel-mode` 并勾选
  - 「清空」会清空勾选、退出选择模式并隐藏复选框；逐个取消到 0 个、或切换目录时同样自动退出
  - 选择工具条（已选/全选/清空）仍只在有勾选时出现
- 手势与缓存修正（v3.6）：
  - 表头交互改为 pointer 事件：轻点列名（<800ms 且未移动）三态排序；拖右缘手柄改列宽；按住拖动（>6px）换列顺序——不再依赖 350ms 长按，修掉"拖不动/长按拖不动/点了不排序"
  - 表头与手柄加 `touch-action:none`，拖拽用 `setPointerCapture`，触屏不再被列表滚动抢走
  - 「修改时间」加入列预设（可勾选/排序/调宽）；配置加 `v:2`，旧配置自动迁入 mtime
  - 静态前端加 `Cache-Control: no-cache, must-revalidate`（`backend/app.py` 中间件），避免旧 js/css 缓存造成"改了没生效"
- 列表与交互重构（v3.5）：
  - 一次点击即播放并落到点击位置（`Player.open(path, ratio)`），整理页不再需要二次点击
  - 复选框默认可见；「已选 / 全选 / 清空」只在有选择时出现
  - 列表行用 48px 预览图替代 🎶 图标（`ThumbMgr` 懒加载，失败自动隐藏）
  - 表头：文件名/大小/标题(title)/编号/作曲家/专辑/作家/修改时间 + 自定义列；点列名三态排序、拖右缘改列宽、按住拖动换列顺序；「▦」列编辑入口在预览图列表头
  - 播放行文件名降到 55% 亮度、波形垫底半透明，避免遮挡
  - 移除「全部/最近播放」计数与工具排序下拉框（排序改表头）
  - 三个路径栏（处理页路径、源目录、目标树根）默认贴边收起成一行摘要，点击展开，不再占高度
  - 顶部新增全屏按钮（浏览器支持时显示）
- 播放控制修正（v3.3.1）：
  - 行内 / 磁贴播放按钮跟随状态显示 ▶ / ⏸（`Player.paintButtons()` 在 play·pause·ended·render 时同步），点同一首即为暂停/继续
  - 网格视图：点正在播放的磁贴封面或空白处也是暂停/继续；其它磁贴仍打开封面大图，磁贴名字仍走元数据探测
  - 播放按钮尺寸加大（行按钮最小 26px 宽、磁贴按钮 12px 字号）
  - 元数据收起栏 26px → 38px，展开按钮做成 24px 方块并加 hover 高亮，避免点不到
- 界面配置持久化（v3.16）：
  - 新增 `backend/routers/ui_api.py` + `UI_CONFIG_FILE`（`ac2_ui_config.json`）：`GET/POST /api/ui_config` 与 `/api/ui_config/preset[.load|.delete]`
  - 新增 `frontend/js/uicfg.js`：启动先 `await UiCfg.load()` 恢复文件配置，再初始化布局；包装 `Store.set/remove` 把 `K` 全量键防抖 800ms 回写
  - 设置面板（`#player-sheet`）新增「界面配置（存本地 JSON）」：预设下拉 + 加载/删除、保存预设、导出/导入 JSON；`.sheet` 加 `max-height:88vh;overflow:auto`
  - 目标目录面板与移动条去掉路径显示/返回上级（只留 tab），与本轮配置持久化无关但同批改动
  - 回归：`smoke2.mjs` 42/42 PASS；新增 `$TMPDIR/ac2js/uicfg.mjs`（设置面板打开、预设保存/删除、配置落盘）全 PASS
- 文件整理交互增强（v3.17）：
  - 列表长按改为弹出上下文菜单：`多选`（进入原选择模式）/ `删除文件`·`删除文件夹`（`confirm` 确认后调 `POST /api/delete`，目录递归删除；仅白名单路径）；两个列表共用 `#ctx-menu`，用 `data-owner` 区分发起方
  - 列表内容超宽可横向滑动查看：`.item .name` / `.item .col` / `.tile-name` 改 `overflow-x:auto`（隐藏滚动条），不再省略号截断
  - 自定义表头列并入勾选列表（`ac2_columns` v3 迁移）：与预设共用 `cfg.ids`，可勾选/取消/拖动排序；`✕` 才是彻底删除；排序键改用元数据 key
  - 切换目录 / 返回上级后列表自动回顶（`BrowseView.setData` 里 `scrollTop=0`）
  - 整理页记住最后所在目录：新增 `ac2_s2_last_path`，`srcBrowse` 每次写入、启动优先恢复
  - 元数据栏底部新增实时频谱（`frontend/js/spectrum.js`）：默认贴底收起，点开用 WebAudio `AnalyserNode` 画柱状频谱；只在点击（手势）时创建节点，避免 `MediaElementSource` 建在 suspended 上下文导致无声
  - 回归：`smoke2.mjs` 42 项 PASS（长按两断言改为「菜单」语义）；新增 `organize2.mjs`（回顶/路径记忆/自定义列勾选/频谱）与 `delete_test.mjs`（端到端长按删除）全 PASS
- 频谱坐标轴 / 旋转 / 顺序播放（v3.18）：
  - 频谱加 XY 坐标轴：X 轴频率（0/4k/8k/12k/16k/20k Hz，按实际采样率裁剪）、Y 轴 dBFS（0/-20/-40/-60/-80），带网格与单位
  - 频谱优先用 `audio.captureStream()` 取流（不接管 `<audio>` 原生输出），回退 `MediaElementSource` 时状态显示「兼容」，且 `visibilitychange` 回前台自动 `resume()` AudioContext
  - 顶栏全屏按钮旁新增「⟳」强制顺时针旋转 90°（`body.rot90`，宽高交换，状态存 `ac2_rotate90`）
  - 顶栏新增「⏭ 顺序」开关（`ac2_autoplay`）：列表播完自动接下一首音频（跳过图片等非音频），通知栏/锁屏 `nexttrack`/`previoustrack` 也走同一逻辑
  - 后台/切页签播放：`mediaSession.playbackState` 同步 + 页面回前台自动续播被系统暂停的曲目
  - 列表超宽内容改为自动跑马灯：`render` 后测量溢出并挂 `.mq`（`--mq-shift`/`--mq-dur`，26px/s，悬停暂停），父行裁剪；保留手动横滑
  - 回归：`smoke2` / `organize2` / `delete_test` / `uicfg` 全 PASS；新增 `playtest.mjs`（旋转、顺序播放开关、ended 自动下一首）PASS
- 两页文件选择统一 + 模块复用（v3.19）：
  - `app.js` 抽出 `loadDir(kind, path)`：处理页 `browse()` 与整理页 `srcBrowse()` 只是它的两种 `kind`，目录加载/面包屑/竞态/失败提示一份实现
  - 选择计数与全选工具条统一为 `paintSel()` / `paintCounts()`（两页同一文案与逻辑）
  - 两个 `BrowseView` 使用同一份行为配置（以整理页为准）：`clickPlays`、`selectDirs`、`onRowClick → playRowClick`、`onReload`、列配置；处理页列表因此也支持目录勾选、长按菜单删除、列设置、跑马灯
  - `player.js` 删除重复的「点播放行 seek」文档监听，行内点击统一走 `App.playRowClick`
  - `spectrum.js` 改为「共享分析核心 + `Spectrum.create(选择器)` 多视图」：两页各挂一个视图，共用同一个 `AudioContext/Analyser`，只维护一份绘制/坐标轴/后台恢复逻辑
  - 处理页新增右侧栏（`#p1-side`，元数据 `#meta1` + 频谱 `#spectrum1`），默认收起贴边、点标签展开；与整理页左栏复用同一套 `metaview` / `spectrum` 模块与 CSS 类
  - 播放联动：`onPlayed` 同时更新两页元数据面板（哪页有该文件就加载哪页）
  - 回归：新增 `unifytest.mjs`（侧栏展开收起、处理页频谱、目录复选框、长按菜单、点击播放、元数据联动、列配置共享）PASS；原 5 套全 PASS
- 频谱悬浮化 / 系统横屏 / 通知栏元数据（v3.20）：
  - 频谱改为全局悬浮模块：右下角贴边按钮（`#sf-fab`）→ 浮窗（`#spectrum-float`），右下角拖动调整大小，尺寸存 `ac2_spectrum_size`；两页共用同一个分析核心与视图，不再塞在元数据面板里
  - X 轴上限固定 24kHz（采样率不足时按 Nyquist），刻度 0/4k/8k/12k/16k/20k/24k，柱状图覆盖同一频段
  - 「⟳」旋转优先走系统级横屏：`requestFullscreen()` + `screen.orientation.lock('landscape')`；不支持才回退页面 CSS 旋转（`body.rot90` 用 `dvh/dvw`，减少偏移）
  - 网页播放通知栏：`player.js` 用 `probe` 标签填 `MediaMetadata`（标题/艺术家/作曲家/专辑/封面绝对 URL），播放条同步显示专辑·艺术家副行
  - 回归：6 套测试全 PASS（`organize2` 频谱断言改为全局 FAB/浮窗，`unifytest` 新增浮窗展开与拖动调大小）
- 长按 / 频谱 / 移动条修复（v3.21）：
  - 频谱分析改用 `MediaElementSource`（`captureStream` 在换歌后常失效，导致频谱不动/不实时）
  - 频谱浮窗支持拖动标题栏移动并自动吸附左/右边缘（`ac2_spectrum_pos`），右下角手柄缩放（`ac2_spectrum_size`）；标题栏显示当前曲目「标题 — 艺术家 · 专辑」
  - 列表长按修复：`.view-wrap` 禁止文本选择 / 长按呼出菜单（`user-select:none`、`-webkit-touch-callout:none`），`BrowseView` 拦截 `contextmenu`，长按不再退化成选字
  - 移动条收起按钮 `z-index` 提到 340，频谱贴边按钮上移到 `bottom:96px`（有播放条时 140px），修掉收起后按钮被频谱按钮盖住、找不到展开入口的问题
  - 回归：新增 `spectrumtest.mjs`（曲目信息、拖动吸附、缩放保存、最小化回按钮）PASS；7 套全 PASS
- 移除页面旋转（v3.23）：
  - 页面旋转/横屏锁定风险高（transform/fixed 元素与点击命中容易错乱），整体剔除：删除顶栏「⟳」按钮、`setRotate` 逻辑、`body.rot90` 样式与 `ac2_rotate90` 配置键
  - 需要横屏时用系统自动旋转或浏览器全屏即可；`playtest.mjs` 断言改为「旋转按钮已移除」
- 跑马灯裁剪修复（v3.22）：
  - 文本改为包在单元格内部的 `.cell-in` 上平移，单元格 `overflow:hidden`，滚动被限制在自己列宽内，不再飘到相邻列
  - 标签列异步填充改为只更新 `.cell-in` 文本（`Columns.setCell`），避免把包装冲掉
  - 回归：新增 `marquee.mjs`（.cell-in 包装、文本保留、样式裁剪）PASS；8 套全 PASS
- 基础改造：存储抽象 / mutagen / Starlette（v4.0）：
  - 配置 env 化：`AC2_DATA_DIR`（配置/缓存可写目录）、`AC2_ROOT`、`AC2_FFMPEG_BIN`/`AC2_FFPROBE_BIN`、`AC2_HOST`/`AC2_PORT`；缓存统一到 `DATA_DIR/cache/{covers,wave}`
  - 元数据/封面改 **mutagen**（`backend/meta.py`）：本地路径与 WebDAV `HttpRangeFile` 都能读；ffprobe 作为回退
  - 波形 provider 化（`backend/waveform.py`）：ffmpeg 默认 / WAV 纯 Python / 预留 `native_provider`（app 阶段接 MediaCodec）
  - 存储抽象（`backend/storage/`）：`PathRef` URI、本地与 WebDAV 双 provider；新增 `/api/roots`、`/api/storage/*`
  - 所有接口接受 `local:` / `dav:` 引用；WebDAV 支持浏览、Range 播放、Range 元数据、封面、远端内部 MOVE/DELETE/MKCOL；跨源拒绝；标签写仅本地
  - 前端：顶部数据源下拉 + 设置面板「存储源（本地/WebDAV）」表单；面包屑按引用 URI 分段；按 caps 禁用本地任务、隐藏外部播放器
  - 框架迁移 **FastAPI → Starlette**（p4a/Chaquopy 不能装 pydantic-core）：全部路由改 `Route`，请求体手写解析，`backend/simple.py` 提供工具
  - 回归：9 套前端脚本全 PASS（新增 `sources_test.mjs`：源切换、dav 浏览、caps、面包屑前缀）；WebDAV 用本地 wsgidav 端到端验证（浏览/探测/封面/206/移动/删除/跨源拒绝）
- 数据源切换修复（v4.1）：
  - 每个源记住最后浏览路径（`ac2_src_paths`）：切换时**有记录回上次目录、无记录回根目录**；记忆路径失效（目录被删等）自动回退到该源根目录
  - 切换失败（网络/权限）保留当前目录并明确提示，不会把页面留在空白状态
  - 保存 WebDAV 源后**自动切换到该源**，下拉选中同步，保存即可看到能否浏览
  - 启动时按 `ac2_last_path` 所属源同步下拉选中，避免"路径是 dav、下拉显示本地"的错位
  - 回归：新增 `davpath_test.mjs`（首次切 dav 到根、进子目录后切回再切回记忆、记忆失效回根）与 `saveflow_test.mjs`（设置面板保存→自动切换→下拉同步）全 PASS；原 8 套全 PASS
- WebDAV 播放与整理页联动修复（v4.2）：
  - `/api/stream` dav 代理的 Range 响应头修正：之前误拼成 `ContentRange/ContentLength/AcceptRanges`（缺连字符），浏览器收不到 `Content-Range` 无法流式播放；现在正确透传 `Content-Range/Content-Length/Accept-Ranges` 并去掉误加的 `X-Audio-CPM-Range`
  - 切换数据源时**整理页源列表同步切到该源**（`srcBrowse`），目标目录也切到该源：优先该源自己的标签记忆（`ac2_tree_roots_<源id>` / `ac2_tree_active_<源id>`），没有则用源根
  - 启动时若上次的目标目录不属于当前源，自动改用当前源根
  - 回归：新增 `tabssync_test.mjs`（切 dav 后主列表/整理页/目标目录都到 dav；重复切回本地恢复）；原 8 套全 PASS
- 修复 WebDAV 卡死整个服务（v4.3）：
  - 现象：WebDAV 用一会儿后所有接口（含 `/`）无响应，只能 kill -9 重启
  - 根因：Starlette 的 `async` 端点里直接调用同步 httpx（`test/move/delete/mkdir/rename/edit_tags/play`），Alist 慢/超时时阻塞事件循环，整个服务停摆；另外 dav 流式响应未在结束时 `close()` 上游连接
  - 修复：以上端点统一改为 `run_in_threadpool` 执行同步实现；dav 流生成器 `finally` 里关闭上游 `Response`；httpx 客户端加连接池上限（8/4）与 8s 连接、20s 读取超时
  - 验证：模拟不可达 dav 源（连接超时 8s）期间，`/` 与 `/api/roots` 仍 6~16ms 响应；k20 的 Range 播放头正确（206 + Content-Range/Length）
  - 约定：新增任何含同步 IO（httpx/subprocess/大文件）的端点必须走线程池，不得在 `async` 端点上直接调用
- 打包前收尾：去 ffprobe / 全 mutagen / AIFF 纯 Python（v4.5）：
  - **读取全 mutagen**：`meta.probe_file_detail` 删除 ffprobe 回退，非音频文件直接返回「不是音频文件」；`ffmpeg.probe_file_detail` 与 `config.FFPROBE_BIN` 整体移除
  - **写入全 mutagen**：`jobs_core.edit_tags_file` 改为 copy→写临时文件→校验→`os.replace`（FLAC/MP3/MP4/OGG/OPUS，APE/WV/DSF 明确报不支持），不再有 ffmpeg 写标签路径
  - **AIFF 纯 Python**：新增 `backend/aiff.py`（80-bit extended 采样率、大端 PCM、sowt、fl32），`/api/stream` 对本地 `.aif/.aiff` 返回 `audio/wav` 缓存；不依赖 FFmpeg
  - **execute() env 透传**：`ffmpeg.execute` / `execute_ffmpeg_with_progress` 接受并默认使用 `ffbin.ENV`；`ffbin.prepare()` 在启动时定位 ffmpeg（Termux=PATH，app=复制 nativeLibraryDir 并设 LD_LIBRARY_PATH）
  - 业务代码不再判断平台；`ffmpeg.py` 只负责执行/进度，波形仍可用 ffmpeg（app 内也允许），播放不依赖 ffmpeg
  - 回归：8 套前端全 PASS；mutagen 写标签读回正确；AIFF→WAV 播放接口 200 + audio/wav；转码任务（FLAC-16-44）done
- 长任务执行模型（v4.6）：
  - **取消**：`POST /api/task/{id}/cancel`；`ffmpeg.execute_ffmpeg_with_progress` 改为读取线程 + 轮询，取消时 `terminate()` → 2s → `kill()`，清理 `.ac2tmp`；`jobs_core` 每个文件循环前 `cancel.check()`；SSE 新增 `cancelled` 事件
  - **并发限制**：全局信号量（`AC2_TASK_CONCURRENCY`，默认 1），超出排队（status=`queued`）
  - **持久化**：`DATA_DIR/ac2_tasks.json`（id/描述/状态/时间/百分比/错误）；启动时 `load_tasks()` 把 running/queued 标成 `interrupted`，前端提示"上次未完成"
  - **前端**：任务面板新增「✕ 取消」按钮（运行中显示）、`cancelled` 状态处理、启动时检查未完成任务
  - 顺带修复：24bit 目标格式用 `s32` 采样格式（原来 `s24` 被 flac 编码器拒绝）
  - 回归：新增 `tasks_ui_test.mjs`（取消按钮出现/开始按钮禁用/后端 cancelled）PASS；9 套全 PASS
- 转码「选中文件夹/文件」修复（v4.7）：
  - `only_files` 现在同时支持路径引用（`local:/...`）与**目录**：`jobs_core.expand_only_files()` 把目录递归展开成音频文件；convert / tags / cover / check 四个任务统一使用
  - 之前选文件夹时 `only_files=[目录]` 被 `os.path.isfile` 过滤成 0 个文件 → 任务显示「共 0 个文件」空跑
  - 前端 dav 数据源时开始按钮禁用并显示提示（文件处理仅本地）；SSE 结束条件补充 `cancelled`
  - 实测：选中目录 → 转换 2 个文件成功；`also_tags` 阶段同源展开（convert 1 + tags 1）
- 频谱/声谱双模式 + 元数据排序（v4.8/v4.9）：
  - 全局浮窗新增「声谱」模式：滚动声谱图（时间横向、频率纵向、新数据从右侧进入、向左滚动，参考 foobar2k）；配色参考 Adobe Audition（黑→深蓝→紫→品红→红→橙→黄→白）；频率轴用对数感拉伸（GAMMA=1.6），左侧保留频率刻度
  - 浮窗顶部加「频谱 / 声谱」两个 tab，**默认频谱**；模式持久化 `ac2_spectrum_mode`
  - 浮窗贴边按钮文案改为「▤ 频谱/声谱」
  - 元数据面板排序调整：**封面 → 元数据（可编辑/只读） → 文件 → 格式 → 音频流**（封面与元数据优先）
  - 回归：新增 `spectrummode_test.mjs`（默认频谱、切声谱、持久化、切回）与 `metaorder_test.mjs`（h3 顺序、封面图）PASS；12 套全 PASS
- 频谱/声谱坐标系隔离（v4.10）：
  - 频谱模式：X 轴=频率（底部 0/4k/8k/…/24k + Hz），Y 轴=dB（左侧 0/-20/…/-80），画 dB 网格
  - 声谱模式：X 轴=时间（底部「时间 →」，右端为现在），Y 轴=频率（左侧 0/4k/…/24k + Hz），不再绘制 dB 网格与频率竖线
  - 抽出 `computeArea()` 统一绘图区，两种模式各画各的轴，互不叠加
- 打包前收尾（v4.11）：
  - 路径白名单动态化：`config.PUBLIC_PREFIXES` 追加 `AC2_ROOT`（app 内 `/sdcard` 与 `/storage/emulated/0` 别名都能用）；`fs_api`/`media_api` 不再各自硬编码
  - 前端默认根改为动态：`defaultRootUri()` 从 `/api/roots` 当前源取，去掉 `local:/sdcard/ADM`、`/sdcard` 兜底
  - 新增 `backend/native_bridge.py`：Android 注册 Java 桥（波形 `native_provider`、外部播放器 Intent），非 Android 全部 no-op；`cli.main` 启动调用 `register()`
  - `/api/play`：有原生桥走 Intent（app），否则继续 `am`（Termux），唯一平台分支集中在此
  - 新增 `packaging/`：`p4a/main.py`、`buildozer.spec`、`android/java/AudioCpmBridge.java` 骨架、`AndroidManifest.append.md`、`tests/`（17 个回归脚本 + run.sh）
  - 回归：12 套全 PASS；`/api/play` 在 Termux 仍返回 am 结果

---

## 附：本机开发环境备注

- DSH 用户级 skill：`~/.dsh/skills/efficient-file-reading/SKILL.md`（大文件分页读取约束）
- DSH 配置：`~/.dsh/profiles/web/cordis.patch.yml` 中 `readLimit: 500`，重启 dsh web 生效
- Audio-CPM 服务当前用 nohup 常驻，PID/日志见项目根目录

---

## Android 新壳补齐（2026-11-16，`fix/android-shell`）

- **FFmpeg**：CI 新增 `ffmpeg` 作业，用 NDK 27 编 8.0.1 音频专用静态单文件（2.28 MB，16 KB 页对齐），
  产物 `libffmpegbin.so` 放 `src/main/jniLibs/arm64-v8a`，与 APK 一起分发（artifact + cache，冷构建 15~25 分钟）。
- **执行链路**：`backend/ffbin.py` 从「复制到 filesDir」改为「`nativeLibraryDir` 直执行」，
  失败退 `/system/bin/linker64`，再失败标 `ffmpeg=False`；`ffbin.cmd()` 统一拼命令行（含 launcher）。
- **能力自检**：启动跑 `-version`/`-decoders`/`-encoders`，写 `ac2.log`，`GET /api/capabilities`
  下发给前端；前端按 `formats` 裁剪输出格式，`ffmpeg=false` 时禁用转换。
- **格式策略**：app 内不提供 mp3/ogg/opus 输出（未编外部编码器），转换入口返回明确错误；
  PC/Termux 走 PATH 的 ffmpeg 仍按 `has_encoder()` 判断。
- **HiFi**：`PlaybackService`（Media3 1.5.1 `MediaSessionService` + `ExoPlayer`），
  `DefaultRenderersFactory#buildAudioSink` 挂 `SpectrumProcessor`（PCM 旁路，`replaceOutputBuffer` 透传）；
  通知栏/锁屏/后台由 MediaSession 负责，`onTaskRemoved` 留空以保持后台播放。
- **爆音**：移除 `createMediaElementSource` + `connect(destination)` 对主播放链路的接管；
  频谱只在 HiFi 下可用，切歌前先暂停 WebView 那一路。
- **已知风险**：`nativeLibraryDir` 里 `.so` 的 x 位未在真机确认，首版 APK 自带自检（`ac2.log`/`/api/capabilities`）。
