# 曲库索引、专辑页与音频焦点（0.5.19/99）

## 曲库模块（独立验证）

曲库先作为独立浮窗模块（模块坞“曲库”）存在，**不替换**现有文件浏览和播放管理。是否最终用曲库统一“目录/列表”，由后续使用反馈决定。

- **只索引勾选目录**：首次进入弹目录引导；可从当前浏览目录添加，也可用内置目录选择器。`/`、`/sdcard`、`/storage/emulated/0` 会提示不要选整个存储根。WebDAV 目录不接受。
- **触发方式**：打开模块时超过 30 分钟自动增量扫描；也可手动“扫描”。扫描在后台线程，不阻塞播放/浏览，支持取消与进度统计。
- **SQLite**：`DATA_DIR/ac2_library.db`，表 `meta`、`tracks`。唯一键 `(dir, name, size)`；未变化文件按 mtime 跳过，大小变化会先删除同目录同名旧行再重建。记录标题、艺术家、专辑、专辑艺术家、流派、年份、作曲家、音轨号、碟号、时长、格式、码率、采样率、声道、文件夹、封面状态。
- **搜索**：搜索框全局模糊搜索，下方 7 个字段标签多选：标题、艺术家、专辑、流派、年份、作曲家、文件夹；至少保留一个字段。多关键词按空格拆分，字段内 AND、字段间 OR。
- **清理安全**：只删除本次实际遍历到的目录里已经消失的文件；目录不可读时不会因权限失败清空整个曲库。

接口：`GET /api/library/state`、`POST /api/library/config`、`POST /api/library/scan`、`POST /api/library/scan/cancel`、`GET /api/library/search`、`GET /api/library/album`。

## 播放管理“专辑”页

- 原“目录 / 队列”页签改为“目录 / 专辑”；队列页签移除，专辑页承担当前播放上下文。
- 已索引曲目按 `album + album_artist` 聚合，并并入同目录曲目，避免同一专辑里 WAV 标签不完整导致缺歌；无专辑标签时按目录聚合。
- 未索引曲目回退到所在目录的音频列表（`indexed:false`），不再因为“曲目不在曲库”返回 HTTP 400。
- 专辑头显示专辑名、艺术家/年份/曲目数；行显示音轨号、标题、时长；点行播放。
- 专辑页左右滑返回“目录”，目录页左右滑仍返回上级目录。
- 浮窗模式默认打开专辑页（原 `queueView='queue'` 遗留已清除）。

## 音频焦点

- 音频输出面板新增“接管音频焦点”开关，默认关闭以保持旧行为。
- `PlaybackService` 持久化键 `ac2_audio_state/audio_focus`；打开后 `ExoPlayer.setAudioAttributes(..., true)`，由 ExoPlayer 处理焦点丢失与短暂 duck。
- 原生桥 `AudioCpmBridge.setAudioFocus(boolean)`、`audioInfo()` 返回 `audioFocus`；后端 `POST /api/audio/focus`。
- 切换失败时前端回滚开关并提示。

## 验证

- 云端完整回归：API **59/59** + UI **46/46** = **105/105**，控制台 0 报错。
- API 覆盖：目录配置/扫描 2 首、5 个字段搜索、专辑聚合与排序、二次增量不重复新增、未索引曲目目录回退、非法目录拒绝。
- UI 覆盖：首次目录引导、当前目录添加、保存并扫描 4 首、7 个字段 chips、模糊搜索、专辑页替换队列页签并列出曲目、浮窗专辑页、音频焦点开关存在且默认关闭。
- 修复两处浮窗遗留：`queueView='queue'` 导致无激活页签与无效专辑请求；`/api/library/album` 对未索引曲目返回 400 导致控制台红字。

## 构建

- CI run `45214446582`，提交 `0a2675a`，`main_package=false`，`.dev` 测试包 `com.github.olddriverdoge.audiocpm.dev`，版本 0.5.19/99。
- 产物 `Audio-CPM-0.5.19-99-dev-library.apk`：22,666,973 字节。
- SHA256 `6a47305367795d5d48e0233d70bd5d7932adadd43fb4361afb1d882f88cb9cf0`。
- 下载 https://aka.doubaocdn.com/s/bMfPvfXfB4 。
- 音频焦点切换通过主线程 Handler 应用到 ExoPlayer，避免 Python 工作线程直接访问播放器触发线程校验异常。
