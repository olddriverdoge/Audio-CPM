# 商店上架准备

本目录是零成本阶段能完成的商店材料。正式提交仍需对应商店账号、签名密钥和资质。

## 已完成

- [x] Release 签名配置与 AAB 构建入口
- [x] 隐私政策源文件与公开 HTML 页
- [x] 数据安全 / 权限底稿
- [x] 中英文商店文案与 Fastlane 文本
- [x] 第三方组件声明
- [x] Dependabot

## 仍需人工准备

- [ ] 生成离线 release keystore，并写入 4 个 GitHub Secrets
- [ ] 生成 512×512 图标、1024×500 功能图和 5 张真实截图
- [ ] 合并到 `main` 后启用 GitHub Pages，确认隐私政策 URL 可访问
- [ ] Google Play Console 账号（US$25，企业需 D-U-N-S）
- [ ] 国内商店：企业开发者账号、软件著作权、App 备案
- [ ] 评估 `MANAGE_EXTERNAL_STORAGE`：补齐 SAF 目录授权模式，或准备 All files access 声明
- [ ] 收敛明文 HTTP，明确仅用于用户自建局域网 WebDAV

## 文档索引

- [RELEASE_SIGNING.md](RELEASE_SIGNING.md)：密钥、Secrets、APK/AAB 构建
- [DATA_SAFETY.md](DATA_SAFETY.md)：权限、数据流、Play Data safety 草稿
- [LISTING.md](LISTING.md)：中英文商店文案、分类、截图建议
- [ASSETS.md](ASSETS.md)：图标、功能图、截图规格
- [../../PRIVACY.md](../../PRIVACY.md)：隐私政策源文件
- [../../THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)：第三方许可证

## 重要边界

签名和材料只能让项目“具备提交条件”，不能替代账号和资质：

- Google Play：开发者账号、身份/企业验证、新个人账号的封闭测试要求；
- 国内商店：各渠道开发者账号、营业执照、软著、App 备案、隐私检测；
- 当前 `MANAGE_EXTERNAL_STORAGE` 仍是最大审核风险，不建议直接提交。
