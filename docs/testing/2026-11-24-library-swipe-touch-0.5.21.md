# 曲库目录触摸滑动修复（0.5.21/101）

## 问题

0.5.20 的目录选择器在桌面鼠标拖拽/模拟指针下可以左右滑动返回上级，但真机触摸滑动无效。原因是 `.lib-picker-list` 仍是 `touch-action:auto`，Android WebView 会先把横向触摸识别为浏览器滚动/手势，直接发出 `pointercancel`，JS 收不到完整的 `pointerup`，因此不会返回上级。

## 修复

- `.lib-picker-list` 增加 `touch-action: pan-y`：纵向滚动继续交给浏览器，横向手势交给曲库脚本处理。
- 保留原来的滑动阈值：横向位移超过 56px 且明显大于纵向位移才触发返回上级；滑动后 450ms 抑制误点击。
- 目录选择器仍不显示“↑ 上级”按钮，标题下方保留“左右滑动返回上级”提示。

## 验证

- Chromium 移动触摸模拟（`has_touch=true` + CDP `Input.dispatchTouchEvent`）从列表右侧滑到左侧，目录从 `/home/user` 返回 `/home`。
- 云端完整回归：API **59/59** + UI **47/47** = **106/106**，控制台 0 报错。
- UI 回归新增断言：目录列表的 `touch-action` 必须为 `pan-y`，防止以后又被浏览器手势吞掉。

## 构建

- CI run `45340505080`，提交 `9c545d3`，`main_package=false`，`.dev` 测试包 `com.github.olddriverdoge.audiocpm.dev`，版本 0.5.21/101。
- 产物 `Audio-CPM-0.5.21-101-dev-library-touch.apk`：22,668,149 字节。
- SHA256 `2818759a3c791c750f80f0341455f9569dea9cf445a171a0aca51704fd1be5ec`。
- 下载 https://aka.doubaocdn.com/s/UIejwyOq3U 。
