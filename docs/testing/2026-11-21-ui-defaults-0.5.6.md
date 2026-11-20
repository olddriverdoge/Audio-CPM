# 0.5.6 界面默认配置与播放面板回归

- 版本：0.5.6 / versionCode 86
- 分支：`feat/0.5.6-ui-defaults`
- 日期：2026-11-21
- 结论：**通过。API 49/49，UI 22/22，合计 71/71；36.49 秒；无控制台错误、无页面异常、无截图。**

## 本版改动

1. **界面默认配置导出**
   - `frontend/js/defaults.js` 从本机 `localStorage` 收集 3 个内置场景、场景几何、频谱/声谱参数、文件列表表头、播放与界面偏好。
   - `POST /api/ui/defaults/export` 写入 `DATA_DIR/ac2_ui_defaults_export.json`，`GET` 同一路径下载 JSON。
   - 设置页提供“导出当前配置”，控制台可使用 `window.AC2ExportDefaults()`。
   - 构建时 `frontend/defaults.json` 被打进 APK；仅供**全新安装**首次启动注入缺失项，不覆盖已有本机配置。
2. **播放管理**
   - 当前曲目封面作为面板虚化背景，无封面时回退纯色渐变。
   - 播放列表标题行改为按钮，支持收起/展开，状态持久化在 `ac3_play_queue_collapsed`。

## 验证命令

```bash
python3 packaging/tests/cloud/run_cloud_suite.py --keep --report /tmp/ac2_v056_suite.json
```

报告：`/tmp/ac2_v056_suite.json`；夹具：`/tmp/ac2_cloud_suite_z_0oc2rm`。默认不生成截图。

## 关键断言

- API：导出 POST 落盘，GET 回读 JSON；`schema=audio-cpm-ui-defaults`，3 个场景、下载路径、场景/设置计数一致。
- UI 设置页：点击 `#cfg-export` 后 `#cfg-export-link` 可见，状态含“已导出”，链接以 `/api/ui/defaults/export` 结尾。
- UI 播放页：加载 `Album B/Track With Cover.flac` 后 `#play-float.has-cover`、`#pf-cover.on`，`#pf-bg` 背景含 `api/cover`；点击 `#pf-q-toggle` 后队列隐藏、`aria-expanded=false`、localStorage 为 `true`，再次点击恢复。
- 默认配置注入：模拟全新安装，场景几何和偏好写入后再次 `Defaults.apply()` 返回 0，不会重复注入。
- `console_errors=[]`、`page_errors=[]`。

## 待办

- `frontend/defaults.json` 当前仍是空占位；需用户在本机 0.5.6 测试包导出真实 JSON 后替换，再重新打包，才能让生产包/测试包带上人工调好的默认场景。

## 主干包名迁移包

为了读取用户正式版（`com.github.olddriverdoge.audiocpm`）里已经调好的 3 个场景，CI 增加 `workflow_dispatch` 输入 `main_package=true`：用主干包名构建 debug APK，签名仍为固定 `ac2-debug.keystore`，versionCode 86 可覆盖 0.5.5（85），且不写入 `debug-latest`。

- 构建 run：`44770313754`
- APK：`Audio-CPM-0.5.6-86-main-debug.apk`，包名 `com.github.olddriverdoge.audiocpm`，versionName 0.5.6 / code 86，debuggable true
- SHA256：`cae5e47cabcf46849d71597282c0a340c9118f775a1e9c0156b7910916e6d6b9`
- 证书 SHA256：`BB A5 DC 52 43 8B AE E4 C3 AF 9B 7F D9 F5 D4 C3 A4 64 E1 4D 95 BC A8 11 EA 18 42 23 BF 92 0D F9`（与 0.5.5 release 一致）
