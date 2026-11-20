# 0.5.6 默认配置落地与浮窗自适应回归

- 版本：0.5.6 / versionCode 86（工作树，未重新出包）
- 分支：`feat/0.5.6-ui-defaults`
- 日期：2026-11-21
- 结论：**通过。API 50/50，UI 28/28，合计 78/78；44.65 秒；无控制台错误、无页面异常、无截图。**

## 本版改动

1. **真实默认配置落地**
   - `frontend/defaults.json` 替换为用户用主干包名 debug APK 导出的真实 JSON（3 个内置场景、30 项偏好）。
   - 顶层补充 `viewport={w:530,h:1211,dpr:1}`，供换手机/转屏时按源视口等比适配。
   - `Defaults.snapshot()` 新导出也写入源视口；`SceneStore.applyDefaults()` 把视口记到场景 override 上。
2. **文件浏览**
   - 删除列表行前播放按钮与 `pb-lead` 占位，首列不再留 26px 空白。
   - `.item .col` 最小宽度 56px → 32px；`Columns.setWidth()` 下限 44 → 32；name 无显式宽度时基准 200 → 120。
   - 新增 `GET /api/folder_cover?path=...`：优先目录内第一张图片；没有图片回落到第一个音频内嵌封面；再没有返回 404。列表和网格目录图标都接入缩略图，失败自动回退 📁。
3. **保存场景**
   - 删除“覆盖”按钮、行点击覆盖逻辑和覆盖确认；已有场景只读展示。新建同名场景提示改为“请换一个名称”。
4. **日志**
   - 日志标题栏的“工作台”标签保持移除，仅显示“日志”。
5. **播放管理背景**
   - `.pf-bg` 改为 `inset:0`、`opacity:1`、`filter:saturate(1.04) brightness(.90)`，不再用 24px 强模糊与 0.58 低透明度；压暗交给底部渐变，避免工作台底色透上来。
6. **跨屏自适应**
   - 新增 `frontend/js/adaptive.js`：按源视口等比缩放；竖屏缩放后仍重叠或窗口过矮时等高堆叠；横屏把文件浏览放左列、其余模块右列堆叠。
   - `SceneStore.apply()` 在源视口与目标不匹配时适配；`fitCurrent()` 在横竖屏切换时重排当前所有浮窗（含用户额外打开的模块）。
   - `WinMgr.place(..., loose)` 允许自适应布局突破模块常规 minH，避免横屏右列两窗被 minH 撑开互相重叠。
   - CSS 增加 430px/360px 窄屏与横屏低高度规则：字号、行高、按钮、浮窗最大宽高随视口收紧。

## 验证命令

```bash
python3 packaging/tests/cloud/run_cloud_suite.py --keep --report /tmp/ac2_v057i_suite.json
```

报告：`/tmp/ac2_v057i_suite.json`；夹具：`/tmp/ac2_cloud_suite_aekud6x9`。默认不生成截图。

## 关键断言

- API：目录封面有图时 302 到 `/api/image`；只有音频封面时 302 到 `/api/thumb` 且缩略图 200；空目录 404。
- UI：真实 `defaults.json` 首次启动写入 3 个场景 override、`ac2_view_mode=grid`、`ac2_columns.widths.name=167`，且场景记录源视口。
- UI：390×844 竖屏打开“文件转码”，三个浮窗都在视口内且两两不重叠。
- UI：切到 844×390 横屏后，文件浏览左列 + 批处理/日志右列，三个浮窗仍全部在视口内且不重叠。
- UI：列表不存在 `.play-btn`；保存场景弹层不存在 `.ss-overwrite`，文本不含“覆盖”。
- UI：列表和网格目录图标都引用 `/api/folder_cover`。
- UI：播放背景 `#pf-bg` 计算样式 `opacity>=0.95`，且不含 `blur(24px)`。
- 测试通过 `?defaults=0` 隔离仓库默认；真实默认由独立用例加载，避免旧断言被默认网格/列宽污染。
- `console_errors=[]`、`page_errors=[]`。

## 待办

- 尚未重新打包；若要真机验证，需要用新 APK 安装后覆盖旧 0.5.6 包，或在后续版本提升 versionCode。
- 工作树改动尚未合并 `main`、未发 tag/release。
