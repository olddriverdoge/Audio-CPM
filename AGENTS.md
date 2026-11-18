# Audio-CPM 项目约定（本项目级）

入口与结构（前后端已分离）：

- `ac_web.py`：12 行启动入口，只 `from backend.cli import main`
- `backend/`：`config` / `meta`（全 mutagen，无 ffprobe）/ `aiff`（纯 Python 转 WAV）/ `ffbin`（ffmpeg 定位）/ `ffmpeg` / `jobs_core` / `jobs` / `presets` / `waveform` / `simple`（Starlette 工具）/ `storage/`（本地+WebDAV）/ `app` / `cli` + `routers/`（browse、tags、tasks、media、fs、ui、storage）；框架是 **Starlette**（不是 FastAPI）；读标签/写标签都走 mutagen，AIFF 播放走纯 Python，FFmpeg 只用于转码/波形
- `frontend/`：`index.html` + `css/`（6 个）+ `js/`（20 个），经典脚本按序加载、IIFE 命名空间、零构建；配置在 `uicfg.js`（`ac2_ui_config.json`），数据源在 `sources.js`（`ac2_storage.json`）
- 交接与接口清单见 [packaging/docs/HANDOVER.md](packaging/docs/HANDOVER.md)

改动定位：

- 改接口 → `backend/routers/*`（Starlette `Route` + `request.json()`）；**同步 IO（httpx/subprocess/大文件）必须放 `run_in_threadpool`，否则会阻塞事件循环卡死整个服务**；改存储源 → `backend/storage/*`；改元数据 → `backend/meta.py`；改任务算法 → `backend/jobs_core.py`；改 ffmpeg 封装 → `backend/ffmpeg.py`；改配置/路径 → `backend/config.py`
- 改界面 → 对应 `frontend/js/<module>.js` 与 `frontend/css/<section>.css`
- 先 `grep -n` 锚点再按行窗口 `read`；单文件都 < 500 行，不要整目录批量读
- 小步迭代：一次一个功能点，最小替换；本会话已读过的片段、已读的 HANDOVER 不重复读

最小验证（改完必做）：

- `python3 -m py_compile ac_web.py backend/*.py backend/routers/*.py`
- 重启：`kill "$(cat ac_web.pid)"; nohup python3 ac_web.py > ac_web.log 2>&1 & echo $! > ac_web.pid`
- 冒烟：`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/ http://127.0.0.1:8000/api/presets`
- 前端回归：`cd "$TMPDIR/ac2js"` 下依次跑 `smoke2.mjs`、`organize2.mjs`、`playtest.mjs`、`unifytest.mjs`、`spectrumtest.mjs`、`marquee.mjs`、`delete_test.mjs`、`uicfg.mjs`、`tasks_ui_test.mjs`、`convert_ui_test.mjs`、`spectrummode_test.mjs`、`metaorder_test.mjs`、`sources_test.mjs`（需本地 wsgidav）
- 改了静态资源要浏览器刷新；排查缓存可临时给 url 加 `?v=`

交付格式：

- 改动说明：文件 + 函数/模块 + 原因（一句话）
- 关键运行结果：py_compile / curl 状态码 / 冒烟测试汇总，便于人工核对
- 不做无谓的全量复读与整文件回传

安全边界：

- 服务无鉴权：不要随手 `--host 0.0.0.0`；新增接口继续做路径/包名校验与 `/sdcard` 白名单
