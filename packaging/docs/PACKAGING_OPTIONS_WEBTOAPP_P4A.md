# 打包路线评估：WebToApp vs python-for-android (webview) vs Chaquopy

> **已选型（2026-11-15）**：确定走 **p4a + webview bootstrap**。现有项目要改什么、FFmpeg recipe 的真实能力（`libffmpegbin.so`，无 ffprobe）、PoC 顺序与排期，见 [P4A_MIGRATION_PLAN.md](P4A_MIGRATION_PLAN.md)。

> 评估目标（用户原话）：**尽量不做太多代码分支改造、完美打包、功能迭代继续在 Termux、后续出包方便。**
>
> 先说结论：**“不分支”可以做到，且和选哪个壳关系不大**——把平台差异收敛到 3 个环境变量 + 1 个启动器即可。真正决定成败的是三件事：① 运行时进程模型；② FFmpeg 可执行文件从哪来；③ 生成 APK 是否离线自包含、能否 CI。
>
> 事实核查基于 2026-11-15 的官方文档/仓库（WebToApp 与 p4a 均为公开仓库）；标“待 PoC”的是文档没有承诺、必须真机验证的点。

---

## 0. 结论摘要

| 维度 | WebToApp | p4a + webview | Chaquopy（对照） |
|---|---|---|---|
| Python 运行模型 | **独立进程**（fork+exec 原生运行时，文档明确） | **嵌入 app 进程**（libpython + PythonActivity） | 嵌入 app 进程 |
| 生成 APK 的 targetSdk | **28 固定**（server-runtime 类型） | 可调（可设 28，但默认较高） | 由 Gradle 配置（35/36） |
| FFmpeg 子进程 | **能**（targetSdk 28 豁免；前提：能把二进制放进项目并 exec） | 能（targetSdk 28）或需 nativeLibraryDir 方案 | 不能（targetSdk 29+ 的 W^X） |
| 运行时是否打进 APK | **否，首次使用联网下载并缓存** | **是**（交叉编译进 APK） | 是 |
| 代码同源（Termux 仓库直接打包） | 需要导入项目/同步文件；非 git 直连 | **可**（项目目录直接打包） | 可（sourceSets 引用仓库） |
| 构建方式 | **手机内构建**（无需 PC）；导出 Gradle 工程 | 命令行（Linux/WSL/CI），首次 20~60 分钟 | Gradle/CI，增量 1~2 分钟 |
| 可 CI / 可复现 | 弱（构建逻辑在 app 内） | **强**（命令行、可 CI） | **强** |
| 离线独立性 | **首启需联网下载运行时**（之后离线） | **完全离线** | 完全离线 |
| 维护风险 | 项目年轻、构建管线黑盒、targetSdk 28 | 官方工具链但 webview bootstrap 使用者少、FFmpeg 集成要自己扛 | 上游稳定，但依赖 wheel/exec 限制 |

**一句话选型：**

- 只要“手机上点一下出包 + 接受首启联网一次 + 接受侧载 targetSdk 28” → **WebToApp 最省事，架构最像 Termux**。
- 要“完全离线 + 可 CI + 仓库直接打包” → **p4a**，但必须自己解决 Android 静态 ffmpeg（或改用 MediaCodec 波形）。
- 如果“离线”是硬要求且不想编译 ffmpeg → **p4a（或任意壳）+ v3 的 MediaCodec 方案**，FFmpeg 不进 app。

---

## 1. 事实核查：WebToApp

来源：[README](https://github.com/shiaho777/web-to-app)、[本地服务运行时](https://github.com/shiaho777/web-to-app/blob/main/docs/guide/config/runtimes.md)、[FAQ](https://github.com/shiaho777/web-to-app/blob/main/docs/guide/faq.md)、[Python 类型](https://github.com/shiaho777/web-to-app/blob/main/docs/guide/app-types/python.md)。

### 1.1 已确认的能力

- Python **3.14**，支持 **Flask / Django / FastAPI (uvicorn) / Tornado**；pip 依赖解析到 `.pypackages`；支持自定义 native `.so` 扩展。
- 服务端运行时类型（Node/PHP/Python/Go/WordPress）由原生二进制 **fork+exec** 启动，"像 Termux 一样，但打进可安装 APK"。
- 生成 APK 的这些类型 **固定 targetSdk=28**；文档明确这是为了从 app 存储 exec 二进制；**AAB/Play 分发不支持这些类型**（会改写 targetSdk 破坏 exec）。
- Host 应用自身 targetSdk 36，host 内预览 exec 会被 SELinux 阻止（Python/PHP 预览不可用），但**导出的 APK 不受影响**。
- 端口由 Port Manager 管理；WebView 指向本地端口。
- 开源（Unlicense），手机内构建 + 签名 + AAB 导出；可导出 Gradle 工程用 Android Studio 打开。
- 项目配置有：entry file / entry module / requirements / **envVars**（环境变量）/ 端口。

### 1.2 关键限制（对你不利的三点）

1. **运行时不在 APK 内**：FAQ 明确“runtime binaries aren't bundled into the base app；首次使用下载一次并缓存”。**严格意义上的“离线独立”要打折扣：首次启动必须联网**。
2. **自定义 CLI 二进制未在文档中承诺**：只看到“custom Python native extensions（.so）”，没有“把任意可执行文件放进项目并 exec”的说明。理论上项目文件 + `os.chmod` + `subprocess` 可行（targetSdk 28 允许），但**必须 PoC**。
3. **构建不可 CI**：构建在手机 app 内完成；虽然能导出 Gradle 工程，但运行时/依赖/打包逻辑在 WebToApp 内部，自动化与版本化能力弱。

### 1.3 待 PoC 验证清单

| # | 验证项 | 通过标准 |
|---|---|---|
| W1 | 极简 Python 项目（FastAPI + uvicorn）导入并预览 | WebView 打开本地端口，接口正常 |
| W2 | 项目里放一个 toy 可执行文件（arm64），`chmod + exec` | `subprocess` 返回 0 |
| W3 | 放入一个 Android 静态 ffmpeg（或 toy 脚本模拟）并执行 | 能解码 1 秒音频 |
| W4 | 导出 APK → 卸载重装 → **断网首启** | 观察是否卡在运行时下载（预期会） |
| W5 | 离线二次启动 | 正常（运行时已缓存） |
| W6 | 项目文件同步方式（zip/文件夹/编辑） | 能接受每次改代码的同步成本 |
| W7 | 导出 APK 的 targetSdk / 权限 / 16KB 对齐 | `aapt dump badging` 确认 28；模拟器/真机运行 |

> W4 是决策点：如果“首启必须联网”不可接受，WebToApp 直接出局（除非能把运行时缓存预置进项目，文档未提及）。

---

## 2. 事实核查：p4a + webview bootstrap

来源：[p4a README](https://github.com/kivy/python-for-android)、[webview bootstrap 源码](https://github.com/kivy/python-for-android/tree/develop/pythonforandroid/bootstraps/webview)。

### 2.1 已确认的能力

- 官方支持 `--bootstrap=webview`：启动一个 Python web server，WebView 指向本地端口（官方 README 明确 "a WebView with a Python web server"）。
- 交叉编译 Python 解释器 + 依赖，打包成 APK/AAB/AAR；纯 Python 包自动支持，C 扩展需要 recipe。
- 推荐用 Buildozer（`buildozer.spec` 里 `android.api` 控制 targetSdk，可设 28）。
- 构建在 Linux/macOS（Windows 用 WSL/Docker），**可在 CI 跑**；首次 20~60 分钟，之后 5~15 分钟（经验值）。

### 2.2 关键限制

1. **Python 是嵌入 app 进程**（libpython + PythonActivity），不是独立 OS 进程。与 Termux/WebToApp 的“独立进程”不同；`subprocess` 仍可用，但 fork 的是多线程 app 进程，**exec 仍受 targetSdk 约束**。
2. **FFmpeg 是真正的工程**：p4a 的 recipe 面向“编译成 Python 可 import 的库”，不是“打包一个 CLI 可执行文件”。你要：
   - 自己交叉编译 Android 静态 ffmpeg（NDK + 依赖库），放 `jniLibs` 或 `assets`；
   - 或设 targetSdk 28，把二进制放 assets，首启复制到 filesDir + chmod + exec；
   - 或走 nativeLibraryDir（`libffmpeg.so`），但可行性需实测（社区有争议）。
3. **构建慢**：每次改代码都要重新打包/签名（增量 5~15 分钟），比 Gradle/Chaquopy 慢一个量级。
4. **webview bootstrap 使用面小**：官方支持，但文档/示例少；遇到问题定位成本高。

### 2.3 待 PoC 验证清单

| # | 验证项 | 通过标准 |
|---|---|---|
| P1 | `buildozer`/`p4a` 打出 webview APK（Starlette + uvicorn） | 安装启动，WebView 打开本地端口 |
| P2 | `android.api=28` 时，assets 里的 toy 二进制复制后 exec | `subprocess` 返回 0 |
| P3 | 放入静态 ffmpeg（自编译）并转一首 FLAC | 成功 |
| P4 | 构建时间/失败率（首次 + 增量） | 可接受 |
| P5 | Python 版本（3.11~3.13）与依赖（starlette/uvicorn/mutagen/httpx） | 全部可装 |
| P6 | 项目目录直接引用仓库（不复制代码） | 打包进去的是同一份 backend/frontend |

---

## 3. 拆解“架构一致性”：三个维度，不是一个

用户说“WebToApp 是独立进程，和 Termux 机制相同”，这**部分正确**，但“一致性”要拆开看：

| 维度 | Termux | WebToApp | p4a | Chaquopy |
|---|---|---|---|---|
| **进程模型** | 独立 Python 进程 | **独立** | 嵌入 | 嵌入 |
| **FFmpeg 执行** | 子进程（PATH） | **子进程**（targetSdk 28） | 子进程（需 targetSdk 28/nativeLibraryDir） | 不可（W^X） |
| **代码同源** | 仓库 | 项目导入/同步 | **仓库目录** | 仓库 sourceSets |
| **离线自包含** | 是 | **否（首启下载）** | 是 | 是 |
| **构建/CI** | — | 手机内，弱 | 命令行，强 | Gradle，强 |

**结论：**
- 进程模型 + FFmpeg 执行，WebToApp 最像 Termux；
- 代码同源 + 离线 + CI，p4a 更好；
- 没有一条在四个维度全赢。**“完美打包”不存在，只能选你最能接受的 trade-off。**

---

## 4. 不分支的最小改造（与选哪个壳无关）

无论 WebToApp / p4a / Chaquopy，业务代码只需要认 3 个环境变量：

```python
# backend/config.py
DATA_DIR = os.environ.get("AC2_DATA_DIR") or SCRIPT_DIR      # 可写目录（预设/缓存）
# backend/ffmpeg.py
FFMPEG  = os.environ.get("AC2_FFMPEG_BIN", "ffmpeg")         # 二进制路径
FFPROBE = os.environ.get("AC2_FFPROBE_BIN", "ffprobe")
# backend/cli.py
HOST = os.environ.get("AC2_HOST", "127.0.0.1")
PORT = int(os.environ.get("AC2_PORT", "8000"))
```

- Termux：不设这些变量 → 行为与现在完全一致（零回归）。
- app 壳：在启动器里设 `AC2_DATA_DIR=/data/user/0/<pkg>/files`、`AC2_FFMPEG_BIN=<可执行路径>`、`AC2_PORT=<随机>`，然后 `from backend.cli import main`。
- **不需要 `if Android` 分支**；唯一需要平台判断的是“启动器”（设置 env + 启动 WebView），而启动器本来就不属于业务代码。

配套的 3 个启动器：

```
Termux:      python3 ac_web.py
WebToApp:    entry=app.py（或 ac_web.py），envVars 填 3 个变量，framework=FastAPI/uvicorn
p4a:         main.py = set env + from backend.cli import main（项目目录直接引用仓库）
```

> 这套改造本来就是 v2/v3 的 T1/T2，先做它，三条路线都不浪费。

---

## 5. FFmpeg 二进制从哪来（真正的工作量）

“WebToApp 允许 fork+exec”只解决“能不能跑”，不解决“跑什么”。你需要一个 **Android arm64 可执行的 ffmpeg**：

| 方案 | 体积 | 工作量 | 风险 |
|---|---|---|---|
| **自编译静态 ffmpeg**（NDK，`ffmpeg-android-maker` 等脚本） | ~15~25 MB | 一次性 1~2 天（含依赖/许可证） | 需 16KB 对齐；GPL/LGPL 合规 |
| 用 Termux 的 ffmpeg + 一并打包它的 `.so` | ~60~90 MB | 0.5 天（复制 + LD_LIBRARY_PATH） | 动态链接路径/API 24/许可证；易碎 |
| 现成预编译静态 ffmpeg（GitHub 产物） | ~15~25 MB | 0.5 天（验证来源/ABI/对齐） | 来源可信度、更新停止 |
| **不打包 ffmpeg**（v3 MediaCodec 方案） | 0 | 1~2 天（Kotlin 桥） | 格式覆盖需实测 |

**关键判断：**
- 如果你愿意编译一次，**WebToApp 的 targetSdk 28 让“子进程 ffmpeg”变成最简单路径**，`ffmpeg.py` 几乎不用改（只改二进制路径）。
- 如果不愿意编译，那“哪个壳”都不白送 FFmpeg——回到 v3 的 MediaCodec 方案，任何壳都行（Chaquopy/p4a/WebToApp 都只是跑 Python + WebView）。
- p4a 即使 targetSdk 28，也要先解决“把二进制放进 APK 并 chmod/exec”，且构建慢；它不比 WebToApp 省事，只是可 CI。

---

## 6. 出包方便性

| 场景 | WebToApp | p4a | Chaquopy |
|---|---|---|---|
| 改一行 Python 后出包 | 手机内重新构建（分钟级），但需先同步项目文件 | 重新 buildozer（5~15 分钟） | 增量 1~2 分钟 |
| 无 PC | ✅ | ❌（需 Linux/WSL/CI） | ❌（需 PC/CI） |
| CI/可复现 | ❌（app 内构建） | ✅ | ✅ |
| 版本/签名管理 | app 内 keystore | buildozer.spec / keystore | Gradle + CI secrets |
| 首装体验 | 首启下载运行时 | 完全离线 | 完全离线 |

“出包方便”取决于你的定义：
- **手机上随手出包** → WebToApp；
- **一条命令、可回滚、可 CI** → p4a；
- **最快增量** → Chaquopy（但你已排除）。

---

## 7. 如果选 WebToApp：落地路径

1. 把仓库打成 zip（backend + frontend + ac_web.py + requirements），导入 WebToApp 的 Python 项目；
2. entry=ac_web.py（或 app.py），framework=FastAPI/uvicorn，envVars 填 `AC2_DATA_DIR` / `AC2_FFMPEG_BIN`；
3. 项目里放 `ffmpeg` 二进制（先 toy 脚本验证 exec，再换真 ffmpeg）；
4. 手机内构建 → 导出 APK → 首启联网下载 Python 运行时 → 二次启动离线；
5. 每次改代码：重新导入项目（或导出/导入源）→ 重新构建。

**风险**：项目同步是手工流程；WebToApp 升级可能改变项目格式/构建行为；targetSdk 28 的长期兼容性；自定义二进制的 exec 未承诺。

## 8. 如果选 p4a：落地路径

1. 装 buildozer + Android SDK/NDK（Linux/PC/CI）；
2. `buildozer.spec`：`requirements = python3,starlette,uvicorn,httpx,mutagen`；`android.api = 28`；`android.bootstrap = webview`；`android.port = 8000`；
3. 项目目录指向仓库（不复制代码）；`main.py` 设置 env + 启动；
4. 自编译静态 ffmpeg（或先 toy 脚本验证 exec）→ 放 assets → 首启复制 + chmod；
5. `buildozer android debug` → 安装 → 完全离线首启。

**风险**：构建慢；p4a 的 Python 版本（3.11~3.13）与依赖兼容；webview bootstrap 文档少；ffmpeg 编译/打包是额外工程。

---

## 9. PoC 计划（建议顺序）

| 顺序 | 内容 | 时间 | 决策问题 |
|---|---|---|---|
| 1 | WebToApp 极简 Python + toy exec（W1/W2） | 半天 | 自定义二进制能不能跑 |
| 2 | WebToApp 断网首启（W4） | 1 小时 | 首启联网能不能接受 |
| 3 | p4a webview 空项目（P1） | 1 天 | 构建链路能不能通 |
| 4 | p4a toy exec（P2） | 半天 | targetSdk 28 能不能 exec |
| 5 | 两条都过 → 各自带真 ffmpeg（W3/P3） | 1~2 天 | 出包体积/时间/稳定性 |

**先做 1+2**：如果“首启联网”不可接受，WebToApp 直接淘汰，不用再花时间。
**3+4 可并行**（p4a 构建首次很慢，先跑起来）。

---

## 10. 我的建议

- 如果**离线独立是硬要求**（首启不能联网）：**p4a** 是唯一自包含的“服务进程 + WebView”路线；但要接受“自编译 ffmpeg + 构建慢”。如果你不想编译 ffmpeg，p4a + MediaCodec（v3 方案）是最稳组合。
- 如果**首启联网一次可接受**，且你更看重“手机上出包、架构像 Termux”：**先 PoC WebToApp**，半天就能知道答案。
- **不要现在就改业务代码**：先把 3 个环境变量接口（§4）落下来，它对三条路线都是净收益；然后再做 PoC。
- **Chaquopy 不是必须排除**：它的真实短板是“不能 exec ffmpeg + pydantic 装不上”，不是“嵌入进程”本身；如果走 MediaCodec 波形，Chaquopy 也零分支。但在你明确不走 Chaquopy 的前提下，上面的对比成立。

---

## 附录：待确认事实（文档没有承诺）

| # | 问题 | 影响 | 验证方式 |
|---|---|---|---|
| A1 | WebToApp 导出 APK 是否可在项目里放任意可执行文件并 exec | 决定 FFmpeg 是否“白送” | toy 脚本 PoC |
| A2 | WebToApp 断网首启是否可用 | 决定离线独立性 | 飞行模式测试 |
| A3 | WebToApp 项目文件如何同步（zip/文件夹/git） | 决定迭代成本 | 实际操作 |
| A4 | p4a 的 targetSdk 28 设置是否影响 WebView/权限 | 兼容性 | 构建后 aapt 查看 |
| A5 | p4a 的 webview bootstrap 是否支持 Starlette/uvicorn | 服务可用性 | PoC |
| A6 | p4a 的 Python 版本/依赖 wheel | 兼容性 | 构建日志 |
| A7 | 静态 ffmpeg 的 16KB 对齐/许可证 | 长期维护 | 编译 + 真机 |

> 以上 A1~A2 是整个决策的“闸门”，建议在写任何业务代码前先验证。
