# 本机构建尝试记录（2026-11-15）

## 环境

- Termux aarch64，Python 3.14.6
- 无 JDK / Android SDK / NDK / Gradle / aapt2
- `pip install buildozer` 成功（1.6.0）

## 尝试

```bash
cd packaging/p4a
buildozer android debug
```

## 结果

在 `Check requirements for android` 阶段失败：

```
E zlib headers must be installed, run: sudo apt-get install zlib1g-dev
```

这是第一道门槛，不是唯一门槛。即使补上 zlib，后续仍会卡在：

1. **JDK**：Termux 可 `pkg install openjdk-17`，但不是构建机的完整环境；
2. **Android SDK build-tools**：`aapt2` 是 native 二进制，官方只发布 Linux x86_64 版本；aarch64 Termux 无法执行（这是硬障碍，与 JDK/NDK 无关）；
3. **NDK**：aarch64 工具链支持有限；p4a 的交叉编译链依赖标准 NDK 布局；
4. **Gradle/AndroidX**：p4a 构建依赖完整 SDK。

## 结论

Termux 不能构建 APK。用 GitHub Actions（`packaging/ci/build-apk.yml`）或 PC/WSL（`packaging/README.md`）。

## 已清理

`~/.buildozer`、`packaging/p4a/.buildozer`、`packaging/p4a/bin`（本次尝试生成物）。
