# 0.5.5 语言链接与后台保活测试记录

日期：2026-11-20

## 改动范围

- 设置页英文语言提示中的 `http://127.0.0.1:8765/` 改为可点击链接；Android WebView 中通过 `AudioCpmNative.openExternalUrl()` 交给系统浏览器，浏览器环境保留 `target="_blank"`。
- 新增 `ServerRuntime` 和 `ServerKeepAliveService`：Activity 启动本地 Python 服务后启动前台通知服务；进程重建时由服务从 `ac2_boot.json` 重新拉起服务。
- Manifest 增加 `FOREGROUND_SERVICE_SPECIAL_USE`、`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`，服务类型为 `specialUse`，子类型 `local_http_server`。
- 设置页增加“后台运行”区块：显示电池优化状态，提供“允许后台运行 / 应用设置 / 电池设置”入口。
- 云端 UI 回归默认不截图，只有设置 `AC2_UI_SCREENSHOTS=1` 才生成截图。

## 云端回归

命令：

```bash
python3 packaging/tests/cloud/run_cloud_suite.py --keep --report /tmp/ac2_v055_suite.json
```

结果：

- API：48/48 通过。
- UI：20/20 通过。
- 合计 68/68，耗时 38.0 秒。
- `console_errors=[]`、`page_errors=[]`。
- `screenshots/` 为空，符合本轮“不截图”的要求。
- 新增断言覆盖：语言链接的 href/target、Android 桥调用 `openExternalUrl`、无桥时后台状态占位与按钮禁用、模拟 Android 桥后的电池优化状态与按钮可用。

## Android 构建

- GitHub Actions：run `44760074494`，提交 `782c8d2`，`build` 任务成功。
- 测试通道资产：`Audio-CPM-0.5.5-85-debug.apk`，22,580,969 字节。
- SHA256：`01bbcd4ae9b00a7720d29d70cbf671acf2a7f506a7a10e8dae82e2b70ed70e7d`。
- APK 清单核验：包名 `com.github.olddriverdoge.audiocpm.dev`，`versionName 0.5.5`，`versionCode 85`，`targetSdk 35`；`ServerKeepAliveService` 不导出，`foregroundServiceType=specialUse`，属性 `PROPERTY_SPECIAL_USE_FGS_SUBTYPE=local_http_server`。

## 未覆盖项

云端回归只覆盖浏览器/HTTP 与模拟原生桥逻辑，不覆盖真实 Android 通知栏、前台服务生命周期、电池优化 Intent 及各厂商自启动策略。这些需要在真机上验收；如果系统仍然限制后台，按设置页入口将应用加入“不优化电池”并允许自启动/后台无限制。
