# Audio-CPM 云端回归测试

这套测试在 Linux 云端直接启动真实的 `ac_web.py` Starlette 后端，并用 Playwright + Chromium 打开真实前端。它不是只测 mock，也不是只截一张首页图。

测试全程使用临时目录：`AC2_ROOT`、`AC2_DATA_DIR` 都指向 `mkdtemp` 生成的隔离夹具，不会读写用户真实的音乐目录。

## 依赖

- Python 3.10+（当前云端为 3.12）
- `starlette`、`uvicorn`、`httpx`、`mutagen`
- `ffmpeg`（用于生成 FLAC/WAV 和封面；云端 4.4.2 已验证）
- Playwright Python 包和 Chromium

```bash
python3 -m pip install -r packaging/tests/cloud/requirements.txt
python3 -m playwright install chromium
```

## 一键运行

```bash
# 完整 API + UI 回归
python3 packaging/tests/cloud/run_cloud_suite.py

# 只跑 API，适合提交前快速回归
python3 packaging/tests/cloud/run_cloud_suite.py --no-ui

# 只跑 UI，保留夹具和截图
python3 packaging/tests/cloud/run_cloud_suite.py --no-api --keep

# 保留现场：夹具、server.log、data/ac2.log、screenshots、report.json
python3 packaging/tests/cloud/run_cloud_suite.py --keep

# 指定端口（默认自动挑选空闲端口）
python3 packaging/tests/cloud/run_cloud_suite.py --port 8773

# 输出完整 JSON 报告
python3 packaging/tests/cloud/run_cloud_suite.py --keep --report /tmp/ac2-report.json
```

退出码 `0` 表示全部通过；`1` 表示有断言、页面异常或控制台错误；`2` 表示夹具/启动失败。

## 覆盖范围

`api_regression.py`（48 项）：

- 静态页面、`capabilities`、`roots`、存储源列表/保存/测试/删除
- 浏览、目录树、音频/图片元数据、缺失目录回退、缺失文件 404
- 标签读取/写入、内嵌封面、封面图、缩略图、波形、整段流和 HTTP Range
- 外部播放器的缺失文件和非公开路径拦截
- `mkdir`/`rmdir`/`rename_dir`/`copy`/`move`/`delete` 及冲突策略
- 任务：重命名预览、转换、标签整理、无 composer 重命名、检查标签、替换封面
- 任务预设持久化、启动参数校验、任务列表、状态、取消不存在任务的 404、SSE
- 更新检查：release 通道同版本不更新、test 通道按带 versionCode 的 debug 资产判断更新
- 原生音频/播放接口在云端全部降级路径（不返回 500，不伪装成功）

`ui_regression.py`（20 项）：

- 首页三张内置场景卡、设置弹层、语言提示、切换语言后整页重载提示仍正确
- 转换场景模块、任务类型切换、列设置面板
- 目录逐级浏览、点击音频播放、网格视图与底部播放条
- 元数据浮窗、频谱浮窗
- 长按进入选择模式、选择计数、确认删除
- UI 发起的转换任务真实完成，并检查磁盘输出文件
- 音频输出面板、保存场景、390×844 移动端布局
- 更新设置卡显示当前版本/通道/已是最新，更新横幅渲染与关闭

## 测试结构

- `fixtures.py`：用 ffmpeg 合成确定性音频/封面，建立 `api` 与 `ui` 两套互不干扰的目录。
- `api_regression.py`：用 `httpx` 直接打真实 HTTP 路由；每个任务都通过 SSE/轮询等待完成。
- `ui_regression.py`：Playwright 真实浏览器操作；失败时自动截图，成功时保留关键步骤截图。
- `run_cloud_suite.py`：分配空闲端口、启动本地假 GitHub 更新 feed、设置隔离环境变量、启动/关闭后端、汇总结果、写 JSON 报告。

## 已知边界

云端浏览器能证明 HTTP、文件操作、前端交互和任务链路；不能替代以下真机项目：

- Android WebView 的渲染/权限行为
- 系统文件选择器（SAF）和真实 `content://` URI
- Media3/ExoPlayer、HiFi 原生输出、音频设备枚举
- 正式包与 `.dev` 包同时启动时的 8765 端口冲突
- Android 侧 FFmpeg 8.0.1 静态二进制的实际行为（云端用系统 ffmpeg 4.4.2 验证命令链路）

这些仍需要安装 APK 后在真机做一轮回归。

## 加测试的约定

- 新 API 用例放进 `api_regression.py`，用 `self.check("行为描述", fn)`；成功返回可读的细节字符串。
- 新 UI 用例放进 `ui_regression.py`，优先等待真实状态（元素/文本），不要用固定 `sleep` 猜时序。
- 任何会改文件的用例都必须在 `fixtures` 的隔离目录内操作，不能指向 `/sdcard` 或用户真实目录。
- 产品缺陷导致的失败不要改断言迁就；先确认是产品行为还是测试预期，再决定修哪边。
