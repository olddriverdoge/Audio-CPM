# 批处理：批量编辑元数据（0.5.18/98）

## 功能

批处理新增“元数据”任务，支持两种批量写入方式：

1. **批量写入指定值**：标题、艺术家、专辑、专辑艺术家、作曲家、流派、年份、音轨号、碟号、备注。
   留空字段不修改；可勾选“仅填写空白字段”，避免覆盖已有值。
2. **从文件名提取**：不写正则，用 `{artist}`、`{title}` 等占位符照抄文件名。例如
   `01. 周杰伦 - 晴天.flac` 对应 `{track}. {artist} - {title}`。
   - 下拉框提供自动识别、艺术家-标题、音轨号.标题、音轨号-标题等常用模板。
   - “自动识别”会从内置常见格式里挑选匹配文件最多、字段最多的一条。
   - 分隔符的空格和短横线自动兼容全角/长横线。
   - 预览只读，不修改文件，日志里显示每个文件将写入的字段。

## 实现

- `backend/jobs_core.py`：新增 `compile_meta_template`、`resolve_meta_template`、
  `preview_metadata`、`edit_metadata_batch`。模板编译只用占位符和转义后的普通文字，
  用户不接触正则；写入仍走 `edit_tags_file` 的 copy → 写临时文件 → 校验 → replace。
- `backend/routers/tasks_api.py`：`POST /api/start` 支持 `task=metadata`；
  新增 `POST /api/tasks/metadata-preview`。
- `frontend/index.html` / `taskrunner.js` / `api.js`：批处理新增“元数据”页签、固定值网格、
  文件名模板选择/自定义、自动识别、预览和“仅填写空白字段”。
- `frontend/css/process.css`：窄屏单列、宽屏两列的元数据字段网格。

## 验证

- API 回归新增 3 项：自动模板预览、固定值任务写入并读回、文件名模板提取并读回。
- UI 回归扩展任务页签断言：元数据面板、两种模式切换、自动模板禁用原始输入。
- 云端完整回归：API **53/53** + UI **43/43** = **96/96**。

## 构建

- CI run `45193157231`，提交 `70579a0`，`main_package=false`。
- 产物 `Audio-CPM-0.5.18-98-dev-metadata.apk`（测试包 `com.github.olddriverdoge.audiocpm.dev`）。
- 22,632,177 字节；SHA256 `191440f325780070285d947c9ae41eca2a1442a035911bee89a9825621f99ea6`。
- 下载 https://aka.doubaocdn.com/s/3w6byeTdI1 。
