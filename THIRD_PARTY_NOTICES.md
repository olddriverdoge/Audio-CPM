# 第三方组件声明

Audio-CPM 源代码采用 MIT License。Android APK/AAB 中还包含或运行以下第三方组件，它们遵循各自许可证。本文件不是法律意见；正式上架前建议按实际打包内容再核对一次。

## 随 APK/AAB 分发的组件

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| AndroidX Core | 1.13.1 | Apache-2.0 | Android 基础库 |
| AndroidX Media3 ExoPlayer | 1.5.1 | Apache-2.0 | 原生播放 |
| AndroidX Media3 Session | 1.5.1 | Apache-2.0 | MediaSession / 通知栏 |
| Chaquopy | 由 Gradle 插件解析 | MIT | Python/Android 集成 |
| Python | 3.14 | PSF-2.0 | 内嵌后端运行时 |
| FFmpeg | 8.0.1 | LGPL-2.1-or-later（本构建未启用 GPL） | 音频转码/波形 |
| Starlette | `requirements.txt` 约束 | BSD-3-Clause | HTTP 路由 |
| Uvicorn | `requirements.txt` 约束 | BSD-3-Clause | ASGI 服务器 |
| HTTPX | `requirements.txt` 约束 | BSD-3-Clause | WebDAV HTTP 客户端 |
| Mutagen | `requirements.txt` 约束 | GPL-2.0-or-later | 音频标签/元数据 |

## FFmpeg 说明

`packaging/android/ffmpeg/build_ffmpeg_android.sh` 构建 FFmpeg 8.0.1 的音频专用静态可执行文件，未传 `--enable-gpl` 或 `--enable-version3`。对应源码可从以下地址获取：

- <https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz>
- 构建脚本：`packaging/android/ffmpeg/build_ffmpeg_android.sh`

分发 FFmpeg 二进制时请保留其许可证文本与源码获取方式；如后续启用 GPL 组件，需要重新评估整个分发物的许可证义务。

## Chaquopy 说明

Chaquopy 12.0.1 起为免费开源版本，许可证为 MIT：

- <https://chaquo.com/chaquopy/license/>
- <https://github.com/chaquo/chaquopy/blob/master/LICENSE.txt>

## Python 包说明

`requirements.txt`：

```text
starlette>=1.0
uvicorn>=0.30
httpx>=0.27
mutagen>=1.47
```

各包在安装时以其发行元数据中的许可证为准。Mutagen 为 GPL-2.0-or-later，发布前应确认分发方式符合其许可证；如果希望降低许可证耦合，可评估替换为 MIT/BSD 的标签库。

## 仅测试使用、不随 APK 分发

- `jsdom`（MIT）：`packaging/tests/` 的前端回归测试。
- Gradle、Android Gradle Plugin、Kotlin/Java 工具链：仅在构建时使用。

## 维护方式

- 新增依赖时同步更新本文件；
- Release 前对比 `packaging/android/app/build.gradle.kts`、`requirements.txt` 和实际 artifact；
- 不要把“MIT”误写成整个 APK 的唯一许可证；第三方组件仍按各自条款分发。
