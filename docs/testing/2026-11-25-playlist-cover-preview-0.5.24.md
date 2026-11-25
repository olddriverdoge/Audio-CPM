# 播放列表目录视图封面预览（0.5.24/104）

## 本轮改动

1. 播放管理的目录视图左侧增加封面预览：
   - 音频行左侧显示 30×30 圆角缩略图，来源与文件浏览相同：`/api/thumb?path=&size=48`；
   - 文件夹行左侧显示目录封面，来源 `/api/folder_cover?path=`；
   - 使用 `ThumbMgr` 的 `IntersectionObserver` 懒加载，滚动到可视区域才真正请求；
   - 缩略图加载失败时回退到音符/文件夹占位图标；
   - 当前播放曲目的封面区保留 ▶ 占位，缩略图加载成功后覆盖。
2. 专辑详情视图不显示封面预览：
   - 专辑行继续使用序号/音符图标；
   - 切到专辑视图时主动断开 `ThumbMgr` 的观察器，不加载封面缩略图；
   - 回到目录视图时重新挂载并加载。

## 测试

- 命令：`python3 packaging/tests/cloud/run_cloud_suite.py --report /tmp/ac2_playcover_round2.json`
- 结果：**API 60/60，UI 47/47，pass=true，console errors 0，page errors 0**，耗时 120.71 秒。
- 新增覆盖：
  - 曲库根目录行的文件夹封面元素数量与文件夹行一致；
  - 文件夹封面缩略图实际加载出非零 `naturalWidth`；
  - 音频行封面元素是整行第一个元素（左侧）；
  - 曲库目录内至少有封面缩略图实际加载成功；
  - 专辑视图不存在 `.pf-q-cover`，也不存在封面 `img`。

## 构建

- CI run `45526526743`，提交 `8c07e49`，`main_package=false`，`.dev` 测试包 `com.github.olddriverdoge.audiocpm.dev`，版本 0.5.24/104。
- 产物 `Audio-CPM-0.5.24-104-dev-playcover.apk`：22,671,173 字节，SHA256 `1aea959fc53d5bfb835a520a764733890c965462fa4983c2cada739794c21e88`。
- 仅含 `arm64-v8a`。

## 生产构建

- `main` 快进合并到 `a4d70b9`，推送后创建 annotated tag `v0.5.24`。
- tag 发布构建 CI run `45527901596`，结论 `success`；artifact `audio-cpm-release`。
- 稳定包名 `com.github.olddriverdoge.audiocpm`，版本 `0.5.24` / `versionCode 104`，`minSdk 24`、`targetSdk 35`，仅 `arm64-v8a`。
- 生产 APK `Audio-CPM-0.5.24.apk`：20,917,715 字节，SHA256 `03892f803a74824b0ab38de717e06cb132ec20d94906ded63a02cf244d68bee8`。
- 生产 AAB `Audio-CPM-0.5.24.aab`：20,804,853 字节，SHA256 `ad68b8c14f97ae3be8d7e2fb51eab4ae4583574500f73f8edc7cff76965f80a0`。
- 签名证书 `CN=AC2 Debug, O=AudioCPM, C=CN`，SHA-256 `bba5dc52438baee4c3af9b7fd9f5d4c3a464e14d95bca811ea184223bf920df9`，与 0.5.17 相同，可覆盖升级；不是应用商店发布签名。
- GitHub Release：https://github.com/olddriverdoge/Audio-CPM/releases/tag/v0.5.24
- APK 下载：https://aka.doubaocdn.com/s/jdZlWqeVxO
