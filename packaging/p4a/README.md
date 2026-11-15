# p4a 构建说明

- `main.py`：启动器，设置 `AC2_DATA_DIR/ROOT/HOST/PORT/ANDROID/NATIVE_LIB_DIR`，请求存储权限，再启动服务。
- `buildozer.spec`：
  - `requirements` 里的 `ffmpeg` 是 **p4a recipe**，产出 `libffmpegbin.so` + `libav*.so`（无 ffprobe，本项目已不需要）。
  - `android.add_src` 指向 `packaging/android/java`（原生桥）。
  - `android.port=8000` 必须与 `main.py` 的 `AC2_PORT` 一致，否则 WebView 白屏。
  - `api = 28`：可直接用文件路径访问 `/sdcard`；若升到 34+ 需要 MANAGE_EXTERNAL_STORAGE 或 SAF（会改路径模型）。
- 构建产物：`bin/ac2-0.1-*-debug.apk`。
- 首次构建会连带编译 SDL2/SDL3（ffmpeg recipe 的依赖），耗时 30~60 分钟。
