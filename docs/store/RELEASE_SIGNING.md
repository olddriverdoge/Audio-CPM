# Release 签名与 AAB 构建

本仓库的发布构建使用**独立 release 密钥**，不复用仓库内公开的 `ac2-debug.keystore`。密钥只放在 GitHub Actions Secrets，不进入 Git 历史。

## 1. 生成 upload key

在安全的离线目录执行（不要放在仓库里）：

```bash
keytool -genkeypair -v \
  -keystore audiocpm-release.p12 \
  -storetype PKCS12 \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -alias audiocpm
```

建议使用密码管理器生成高强度随机密码，并立即做两份离线备份：

- 一份在密码管理器；
- 一份在离线加密介质。

密码丢失或密钥损坏会导致无法对已上架应用做正常更新。若后续启用 Google Play App Signing，这个密钥作为 **upload key**，Play 侧还有独立的 app signing key。

## 2. 写入 GitHub Secrets

```bash
# Linux
base64 -w0 audiocpm-release.p12 > audiocpm-release.p12.b64

# macOS
base64 -i audiocpm-release.p12 | tr -d '\n' > audiocpm-release.p12.b64

gh secret set AC2_RELEASE_KEYSTORE_BASE64 < audiocpm-release.p12.b64
gh secret set AC2_RELEASE_STORE_PASSWORD
gh secret set AC2_RELEASE_KEY_ALIAS --body "audiocpm"
gh secret set AC2_RELEASE_KEY_PASSWORD
```

需要配置的 4 个 Secrets：

| Secret | 内容 |
|---|---|
| `AC2_RELEASE_KEYSTORE_BASE64` | `.p12` 的 Base64，单行无换行 |
| `AC2_RELEASE_STORE_PASSWORD` | keystore 密码 |
| `AC2_RELEASE_KEY_ALIAS` | `audiocpm` |
| `AC2_RELEASE_KEY_PASSWORD` | key 密码；PKCS12 通常与 store 密码相同 |

设置完成后删除本地 `.b64` 临时文件，不要提交 `.p12`、`.jks`、`.b64` 或密码。

## 3. 构建

### GitHub Actions

`.github/workflows/build-gradle.yml` 支持两种模式：

- **普通分支**：构建 debug APK，artifact 名 `audio-cpm-apk`。
- **tag `v*` 或手动勾选 `build_release`**：构建已签名的 `Audio-CPM-release.apk` 和 `Audio-CPM-release.aab`，artifact 名 `audio-cpm-release`。

手动验证：

1. Actions → `build-audio-cpm` → Run workflow；
2. 选择分支；
3. 勾选 `build_release`；
4. 构建结束后下载 `audio-cpm-release`。

tag 发布时 workflow 会自动运行 release 构建，并要求上述 4 个 Secrets 存在。

### 本地构建

先生成临时 keystore 或使用你自己的 upload key，然后：

```bash
export AC2_RELEASE_KEYSTORE=/absolute/path/audiocpm-release.p12
export AC2_RELEASE_STORE_PASSWORD='...'
export AC2_RELEASE_KEY_ALIAS='audiocpm'
export AC2_RELEASE_KEY_PASSWORD='...'

cd packaging/android
gradle assembleRelease bundleRelease --no-daemon
```

输出：

```text
packaging/android/app/build/outputs/apk/release/Audio-CPM-release.apk
packaging/android/app/build/outputs/bundle/release/Audio-CPM-release.aab
```

## 4. 发布前检查

- [ ] `versionCode` 比上一个 Release 大；
- [ ] `versionName` 与 tag 一致；
- [ ] `apksigner verify` 通过；
- [ ] AAB 使用同一 upload key；
- [ ] APK/AAB 的 SHA256 已记录；
- [ ] 包名没有误带 `.dev`；
- [ ] 密钥和密码没有进入 Git、日志或 artifact。

## 5. 注意事项

- **不要**把仓库里的 `ac2-debug.keystore` 用于商店发布；它是公开的调试密钥，任何人都能用它签同名包。
- 一旦用某个密钥发布，后续升级必须使用同一密钥。密钥丢失只能走 Google Play 的 upload key reset 等特殊流程，其他渠道通常无法恢复。
- 上架 Google Play 时应启用 **Play App Signing**；本仓库的 release key 作为 upload key。
- 正式上架前仍需处理 `MANAGE_EXTERNAL_STORAGE`、隐私政策和商店资料，签名只是第一道门槛。
