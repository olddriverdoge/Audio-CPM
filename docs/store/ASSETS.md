# 商店素材清单

当前仓库只有 128×128 的 `frontend/img/logo.png`，还需要生成商店专用位图。以下尺寸按 Google Play 的要求准备；国内商店通常也接受同规格素材。

## 必需素材

| 素材 | 规格 | 文件 | 状态 |
|---|---|---|---|
| App icon | 512×512 PNG，32-bit，无透明 | `store/icon-512.png` | 待生成 |
| Feature graphic | 1024×500 PNG/JPEG，无透明 | `store/feature-1024x500.png` | 待设计 |
| Phone screenshots | 2–8 张，16:9 或 9:16，320–3840 px | `store/phone-01.png` … | 待截取 |
| Tablet screenshots | 可选，7"/10" | `store/tablet-*.png` | 可选 |
| Promo video | 可选，YouTube 链接 | — | 可选 |

Google Play 还要求商店素材中不能出现：

- 设备外框、虚假评分、虚假“Editor's Choice”等标识；
- 其他商店的 logo；
- 真实用户数据、WebDAV 凭据、私人路径；
- 与实际功能不符的界面或承诺。

## Fastlane 目录

文案已经放入：

```text
fastlane/metadata/android/zh-CN/
fastlane/metadata/android/en-US/
```

图片补齐后按 Fastlane 约定放置：

```text
fastlane/metadata/android/zh-CN/images/icon.png
fastlane/metadata/android/zh-CN/images/featureGraphic.png
fastlane/metadata/android/zh-CN/images/phoneScreenshots/1.png
fastlane/metadata/android/en-US/images/icon.png
fastlane/metadata/android/en-US/images/featureGraphic.png
fastlane/metadata/android/en-US/images/phoneScreenshots/1.png
```

## 建议制作顺序

1. 用现有 logo 重绘 512×512 图标，保证小尺寸下仍可辨认；
2. 用真实 App 截图 5 张，优先展示工作台、文件浏览、播放/EQ、元数据整理、批处理；
3. 功能图只放品牌名 + 一句定位，不堆功能列表；
4. 全量检查是否泄露路径、IP、WebDAV 账号或密码；
5. 最后再上传商店，避免反复替换素材。
