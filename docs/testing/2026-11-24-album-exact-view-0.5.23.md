# 专辑按 album+artist 精确查询与视图切换折叠（0.5.23/103）

## 本轮改动

1. 专辑查询改为曲库 `album + artist` 组合：
   - `LibraryStore.album()` 先按当前曲目路径定位曲库记录；
   - 使用 `WHERE album=? AND artist=?` 精确查询，不再合并同目录音频；
   - 当前曲目未索引时返回 `ok:false`，不再回退到“同目录全部音频”，避免把不同专辑混在一起；
   - 删除已不再使用的 `_album_from_dir` 回退。
2. 播放管理视图切换：
   - 点击“专辑 ›”或“目录”标签时，自动收起频谱/声谱区、展开播放列表区；
   - 进入专辑详情和返回曲库目录都保持这个状态；
   - “目录”标签可点击，从专辑详情或声谱状态回到曲库目录；
   - 折叠状态写入原播放管理偏好键。

## 测试

- 命令：`python3 packaging/tests/cloud/run_cloud_suite.py --report /tmp/ac2_album_exact_round2.json`
- 结果：**API 60/60，UI 47/47，pass=true，console errors 0，page errors 0**，耗时 123.14 秒。
- 覆盖：
  - 专辑接口只返回 album+artist 完全匹配的曲目，同目录无标签音频不混入；
  - 未索引曲目专辑查询软失败；
  - 点专辑自动收起声谱、展开播放列表；
  - 点目录标签回到目录，声谱保持收起；
  - 原有曲库布局、目录浏览、滑动返回、收藏与播放控制回归。

## 构建

- CI run `45380508568`，提交 `1c18b6e`，`main_package=false`，`.dev` 测试包 `com.github.olddriverdoge.audiocpm.dev`，版本 0.5.23/103。
- 产物 `Audio-CPM-0.5.23-103-dev-album-exact.apk`：22,670,789 字节，SHA256 `25bf1f823ecbde8eda9fd0fa5ccc3227c73d785d346dffd90445c84649cc831e`。
- 仅含 `arm64-v8a`。

## 备注

测试素材中的 Track Two.wav 由 ffmpeg 写入 RIFF INFO，但当前 mutagen 扫描不到这些标签，曲库里 album/artist 为空。按本轮要求的 album+artist 精确查询，它不会进入 Test Album；这避免了旧实现把同目录无标签音频混进专辑的问题。
