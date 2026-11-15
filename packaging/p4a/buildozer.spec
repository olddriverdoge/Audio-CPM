[app]
title = AC2
package.name = ac2
package.domain = com.example
source.dir = ../..
source.include_exts = py,js,css,html,json,md
source.exclude_dirs = .git,__pycache__,cache,packaging,ac2_ui_config.json,ac2_storage.json,ac2_tasks.json,ac2_presets.json,ac_web.log,ac_web.pid,local:
source.exclude_patterns = *.pyc,*.log
version = 0.1
requirements = python3,starlette==1.10.0,uvicorn==0.54.0,httpx==0.28.1,mutagen==1.48.1,ffmpeg
orientation = portrait
fullscreen = 1

# p4a 分支/版本：develop 当前是 Python 3.14.2 + ffmpeg 8.0.1 recipe。
# 首次成功后建议把 branch 换成固定 commit，保证可复现。
p4a.branch = develop

# 原生桥：把 packaging/android/java 作为额外 Java 源编译
android.add_src = ../android/java

# 只打 arm64（本机设备），减少构建时间与体积
android.archs = arm64-v8a
android.accept_sdk_license = True

[android]
api = 28
minapi = 24
port = 8000
permissions = READ_EXTERNAL_STORAGE,WRITE_EXTERNAL_STORAGE,INTERNET
