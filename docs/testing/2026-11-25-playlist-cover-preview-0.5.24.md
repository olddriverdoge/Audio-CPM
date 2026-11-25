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

待 CI 构建后补充 APK 文件名、大小、SHA256、run id 与包名。
