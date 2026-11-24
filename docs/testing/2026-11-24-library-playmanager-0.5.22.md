# 曲库标题布局与播放管理曲库目录（0.5.22/102）

## 本轮改动

1. 曲库扫描结果行：
   - 标题最多显示两行，不再单行省略；
   - artist 与 album 分别占一行，缺少时回退到 folder/dir；
   - 保留右侧音轨号、年份、时长。
2. 新增 `GET /api/library/browse?path=`：
   - 空 path 返回勾选曲库根目录列表与曲目数；
   - 非空 path 只允许曲库根目录内的路径；
   - 返回直属子目录（含递归曲目数）与当前目录已索引曲目；
   - 未配置/越界返回 `ok:false`，HTTP 仍为 200，前端软提示。
3. 播放管理“目录”页改为曲库数据：
   - 文件夹与音频全部来自 `/api/library/browse`；
   - 多个曲库根目录时先显示根目录列表，单根目录直接进入；
   - 从根目录右滑/左滑返回虚拟根目录列表；
   - 停止播放回到曲库目录顶层；
   - 曲库目录页不再借用文件浏览的 `App.path`/`App.directories()` 作为数据源；
   - 进入曲库目录或点曲目时同步文件浏览上下文，保留下一首/上一首的目录顺序。
4. 播放管理“专辑”不再是与“目录”平级的页签：
   - 移除 `data-qview="browse|album"` 双页签；
   - 标题区保留“目录”标签，新增“专辑 ›”详情入口；
   - 点击后调用 `/api/library/album` 展示当前播放曲目的专辑内其他曲目；
   - 再点“返回目录 ‹”或左右滑回到曲库目录。
5. 收藏栏只展示曲库根目录内的收藏；“+”收藏当前曲库目录。

## 测试

- 命令：`python3 packaging/tests/cloud/run_cloud_suite.py --report /tmp/ac2_lib_play_round2.json`
- 结果：**API 60/60，UI 47/47，pass=true，console errors 0，page errors 0**，耗时 122.43 秒。
- 新增覆盖：
  - 曲库行标题允许换行，artist/album 各自一行；
  - `/api/library/browse` 根列表、根内曲目、越界路径软失败；
  - 播放管理目录只显示曲库根目录，点击目录后出现曲库音频；
  - 专辑详情入口打开/返回，不再存在目录/专辑平级页签；
  - 停止回到曲库根目录，左右滑返回根目录列表；
  - 收藏只从曲库目录添加并显示。

## 构建

- CI run `45370828048`，提交 `f7b2521`，`main_package=false`，`.dev` 测试包 `com.github.olddriverdoge.audiocpm.dev`，版本 0.5.22/102。
- 产物 `Audio-CPM-0.5.22-102-dev-library-play.apk`：22,672,501 字节，SHA256 `9807fa447d0b523b5fe8feaac59eee7b999173a4788910a3299ef7155ccb90b4`。
- 仅含 `arm64-v8a`。
