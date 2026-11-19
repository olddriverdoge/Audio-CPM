# Audio-CPM 隐私政策

生效日期：2026-11-19

Audio-CPM 是一个本地优先的 Android 音乐库管理与播放工具。本政策说明 App 会访问哪些数据、数据存放在哪里，以及你可以如何删除。

## 1. 我们不收集的数据

Audio-CPM 不要求注册账号，不包含广告 SDK、统计分析 SDK 或崩溃上报服务，不会把音乐文件、文件列表、播放记录、搜索记录或 WebDAV 凭据上传到开发者服务器。

## 2. App 会在本机处理的数据

- **音乐文件与目录**：为了浏览、播放、查看元数据、格式转换、移动、复制、删除和封面处理，App 会读取你授权的本地目录或你配置的 WebDAV 服务器。
- **音频元数据与封面**：在设备本地读取和编辑；只有在你主动执行批处理或整理操作时，才会写入你选择的目录。
- **WebDAV 连接配置**：地址、用户名、密码和只读设置保存在 App 私有数据目录中的 `ac2_storage.json`；它们只用于直接连接你配置的 WebDAV 服务器，不经过开发者服务器。当前版本未对这份配置做额外的应用层加密，依赖 Android 应用沙箱和设备锁屏保护。
- **界面与场景配置**：浮窗位置、大小、缩放、语言、收藏和目标目录快捷入口等保存在本机 WebView/App 数据目录。
- **日志**：运行日志保存在本机，可能包含文件路径、错误信息和操作结果；你可以在日志浮窗中查看、复制和清空。

## 3. 网络访问

- **WebDAV**：App 直接连接你填写的 WebDAV 地址。请优先使用 HTTPS；如果使用 HTTP，流量可能被同一网络中的第三方读取。
- **本地服务**：Android App 内部的 Python 后端通过回环地址 `127.0.0.1` 为 WebView 提供 `/api/*` 接口，不对外网开放。
- **外部播放器模式**：如果你选择“系统播放器”，App 会把当前文件的访问 URI 交给系统或你指定的播放器 App；该播放器如何处理数据，受其自身隐私政策约束。
- **无远程遥测**：本版本没有自动上传日志、设备标识或使用统计的功能。

## 4. 权限用途

| 权限 | 用途 |
|---|---|
| `INTERNET` | 连接你配置的 WebDAV 服务器；本地 WebView 与后端通信 |
| `READ_MEDIA_AUDIO` | Android 13+ 读取媒体库中的音频 |
| `MANAGE_EXTERNAL_STORAGE` | Android 11+ 浏览和管理 `/sdcard` 下的音乐目录；可在系统设置中撤销 |
| `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` | Android 12 及以下读取/写入本地音乐目录 |
| `POST_NOTIFICATIONS` | 显示播放控制与任务状态通知 |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | 后台播放与通知栏媒体控制 |
| `WAKE_LOCK` | 播放期间保持设备唤醒 |

拒绝某项权限时，对应功能可能不可用，但不会影响不依赖该权限的其他功能。

## 5. 数据共享与第三方组件

App 不向开发者出售或共享你的数据。打包产物包含以下第三方组件，它们按各自许可证在设备本地运行：

- AndroidX / Media3（Apache-2.0）
- Chaquopy 与 Python 运行时
- FFmpeg（构建脚本未启用 GPL 组件，按其许可证分发）
- Starlette、Uvicorn、HTTPX、Mutagen 等 Python 包

第三方组件不会向开发者服务器回传你的音乐库内容。完整声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 6. 数据保留与删除

- 卸载 App 或清除 App 数据会删除本机保存的界面配置、日志和 WebDAV 连接配置。
- 你在 WebDAV 服务器上的文件不会因为卸载 App 而被删除；需要到对应服务器上自行管理。
- 你可以在设置中删除 WebDAV 数据源，只删除连接配置，不会删除服务器文件。
- 日志可在日志浮窗内清空；复制的日志由你自行保管。

## 7. 儿童隐私

Audio-CPM 不是面向儿童设计的产品，不主动收集儿童个人信息。

## 8. 安全

- 建议为 WebDAV 使用独立账号、强密码和 HTTPS。
- 桌面/源码模式默认只监听 `127.0.0.1` 且没有鉴权，不要绑定到 `0.0.0.0` 或暴露到公网。
- 安全问题请按 [SECURITY.md](SECURITY.md) 私密报告，不要在公开 Issue 中披露凭据或可利用细节。

## 9. 政策更新

功能或数据处理方式发生实质变化时，会更新本页并修改生效日期。继续使用更新后的版本表示你了解更新内容。

## 10. 联系方式

- 一般问题：<https://github.com/olddriverdoge/Audio-CPM/issues>
- 安全漏洞：<https://github.com/olddriverdoge/Audio-CPM/security/advisories/new>

本政策适用于 Audio-CPM Android App 及其源码运行模式。
