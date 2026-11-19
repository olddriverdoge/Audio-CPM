# 商店数据安全 / 权限说明

这份文档是填写 Google Play Data safety、国内商店隐私检测和权限说明时的底稿。最终以商店最新表单和政策为准。

## 数据流概览

| 数据 | 位置 | 是否离开设备 | 说明 |
|---|---|---|---|
| 音乐文件、封面、标签 | 用户本地目录 / WebDAV | 仅当用户主动移动、复制或转换到 WebDAV 时 | 不经过开发者服务器 |
| WebDAV 地址、用户名、密码 | App 私有目录 `ac2_storage.json` | 仅发送给用户配置的 WebDAV 服务器 | 当前未做应用层加密，依赖 Android 沙箱 |
| 浮窗布局、语言、收藏、场景 | 本机 WebView/App 数据 | 否 | 不用于分析或广告 |
| 运行日志 | 本机 | 否 | 可能含文件路径；用户可复制/清空 |
| 播放记录、搜索记录 | 本机内存/界面状态 | 否 | 无开发者遥测 |
| 设备标识、广告 ID | 不采集 | 否 | 无广告/统计 SDK |

## Google Play Data safety 草稿

- **Does your app collect or share any of the required user data types?**
  - 开发者侧：不收集、不共享。
  - WebDAV 是用户自行配置的服务器，文件传输由用户主动触发；如 Play 表单将用户指定服务器视为第三方传输，需按“Files and docs / App functionality”逐项确认。
- **Is all of the user data collected by your app encrypted in transit?**
  - WebDAV 由用户选择 HTTP/HTTPS；App 不能保证用户使用 HTTPS。隐私政策已建议 HTTPS。
- **Do you provide a way for users to request that their data be deleted?**
  - 卸载/清除 App 数据；设置中删除 WebDAV 源；日志清空。WebDAV 服务器文件由用户自行删除。
- **Data types**
  - Files and docs：仅本地处理；用户主动的 WebDAV 操作除外。
  - App activity / playback history：不收集。
  - Device or other IDs：不收集。
  - Location、contacts、camera、microphone：不访问。
- **Data usage and handling**
  - App functionality；不存在广告/营销用途。
- **Third-party SDK**
  - 无广告、统计、崩溃上报 SDK。
  - AndroidX/Media3、Chaquopy、FFmpeg、Starlette/Uvicorn/HTTPX/Mutagen 为本地运行依赖。

> Play Console 对“collect/share”的定义可能随政策更新。提交前按当次表单逐项复核，必要时把 WebDAV 用户主动传输标注为 App functionality。

## 权限清单与用途

| 权限 | API | 用途 | 是否运行时申请 |
|---|---|---|---|
| `INTERNET` | all | WebDAV、回环 HTTP | 否 |
| `ACCESS_NETWORK_STATE` | all | 网络状态/依赖库 | 否 |
| `READ_MEDIA_AUDIO` | 33+ | 读取媒体库音频 | 是 |
| `MANAGE_EXTERNAL_STORAGE` | 30+ | `/sdcard` 目录浏览与整理 | 系统设置页授权 |
| `READ_EXTERNAL_STORAGE` | ≤32 | 旧系统读取音乐 | 是 |
| `WRITE_EXTERNAL_STORAGE` | ≤29 | 旧系统写入音乐 | 是 |
| `POST_NOTIFICATIONS` | 33+ | 播放/任务通知 | 是 |
| `FOREGROUND_SERVICE` | 28+ | 后台播放服务 | 否 |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | 34+ | 媒体播放前台服务类型 | 否 |
| `WAKE_LOCK` | all | 播放保持唤醒 | 否 |

## 上架前必须处理的风险

### 1. `MANAGE_EXTERNAL_STORAGE`（高）

Google Play 的 All files access 政策只允许核心功能符合条件的应用使用。音乐播放器通常需要证明“文件管理”是核心功能，否则会被要求改用：

- MediaStore 读取媒体库音频；
- Storage Access Framework 让用户选择目录；
- 仅访问 App-specific 目录。

当前后端大量使用真实文件路径，直接改 SAF 会影响浏览、移动、删除、批处理。建议先增加 SAF 目录授权入口作为合规模式，再逐步覆盖功能，不要直接删除全盘权限。

### 2. 明文 HTTP（中）

Manifest 当前设置 `android:usesCleartextTraffic="true"`，是为了支持用户自建 HTTP WebDAV。商店可能要求说明原因；长期应收敛为：

- 默认只允许 HTTPS；
- 对局域网/本机 HTTP 单独提示并允许；
- 在隐私政策和设置页明确风险。

### 3. 本地 HTTP 服务（中）

App 内 Python 后端只监听 `127.0.0.1`，不对外网开放。上架材料中应明确这一点，避免被误判为对外提供未鉴权服务。

### 4. WebDAV 凭据存储（中）

凭据位于 App 私有目录，未做应用层加密。后续可考虑 Android Keystore 加密；当前至少在隐私政策中如实披露。

## 商店隐私检测常见检查项

- [ ] 首次启动有隐私政策入口，且可关闭/拒绝非必要权限；
- [ ] 权限申请前有用途说明；
- [ ] 隐私政策公网可访问，内容和权限清单一致；
- [ ] 没有广告/统计 SDK 私自初始化；
- [ ] 没有在用户同意前读取文件或联网上传；
- [ ] 提供删除本地数据和删除 WebDAV 配置的路径；
- [ ] 日志、截图、客服材料中不包含真实凭据和个人路径。
