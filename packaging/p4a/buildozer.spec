[app]
title = AC2
package.name = ac2
package.domain = com.example
source.dir = ../..
source.include_exts = py,js,css,html,json,md
source.exclude_dirs = .git,__pycache__,cache,packaging,ac2_ui_config.json,ac2_storage.json,ac2_tasks.json,ac2_presets.json,ac_web.log,ac_web.pid,local:
source.exclude_patterns = *.pyc,*.log
version = 0.1
# 两阶段：先不带 ffmpeg，验证 Python/WebView/端口/权限；壳通过后加回 `,ffmpeg`。
# 注意：p4a 的依赖图不接受 `==` 版本 pin（会报 no valid dependency graphs），
# 纯 Python 包只写名字，由 pip 解析最新版本。
requirements = python3,starlette,uvicorn,httpx,mutagen
orientation = portrait
fullscreen = 1

# p4a 参数（buildozer 只认 [app] 段下的点号键；[android] 段不会生效）
p4a.bootstrap = webview
p4a.port = 8000
p4a.branch = develop

# Android 目标（targetSdk 28：/sdcard 旧权限 + app 目录 exec 豁免）
android.api = 28
android.minapi = 24
android.permissions = READ_EXTERNAL_STORAGE,WRITE_EXTERNAL_STORAGE,INTERNET
android.archs = arm64-v8a
android.accept_sdk_license = True
android.add_src = ../android/java
