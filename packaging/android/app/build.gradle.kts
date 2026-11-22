plugins {
    id("com.android.application")
    id("com.chaquo.python")
}

/*
 * 包名策略：只有 main / 发布 tag 使用主干包名，其他分支统一加 .dev。
 * 这样 feature / 测试分支的 APK 可以与正式版同时安装，不会覆盖正式版数据。
 */
val buildRefName: String = System.getenv("GITHUB_REF_NAME")?.takeIf { it.isNotBlank() } ?: runCatching {
    val head = rootProject.file("../../.git/HEAD")
    if (!head.exists()) return@runCatching "main"
    val raw = head.readText().trim()
    if (raw.startsWith("ref: refs/heads/")) raw.removePrefix("ref: refs/heads/") else "detached"
}.getOrDefault("main")
val buildRefType: String = System.getenv("GITHUB_REF_TYPE") ?: "branch"
val forceStablePackage: Boolean = (System.getenv("AC2_FORCE_STABLE_PACKAGE") ?: "false")
    .lowercase() in setOf("1", "true", "yes")
val stablePackage: Boolean = forceStablePackage || buildRefType == "tag" || buildRefName == "main"
val packageSuffix: String = if (stablePackage) "" else ".dev"

/*
 * 商店发布签名：密钥不提交仓库，由 CI 从 GitHub Secrets 解码到临时目录，
 * 再通过环境变量传入。只有配置了签名文件时才创建 release signingConfig；
 * 本地 debug 构建和没有密钥的普通分支构建不受影响。
 */
val releaseKeystoreFile: File? = System.getenv("AC2_RELEASE_KEYSTORE")
    ?.takeIf { it.isNotBlank() }
    ?.let { File(it) }
    ?.takeIf { it.isFile }

android {
    namespace = "com.github.olddriverdoge.audiocpm"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.github.olddriverdoge.audiocpm$packageSuffix"
        minSdk = 24
        targetSdk = 35
        versionCode = 95
        versionName = "0.5.15"
        ndk { abiFilters += listOf("arm64-v8a") }
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_PLATFORM=android-26")
                cppFlags += "-std=c++17"
            }
        }
    }
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }
    ndkVersion = "27.0.12077973"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    /*
     * 固定调试签名：CI 每次跑都是新机器，AGP 自动生成的 debug.keystore 每次不同，
     * 导致新包不能覆盖安装。这里用仓库内固定的调试密钥（仅调试用途，非发布签名）。
     */
    signingConfigs {
        create("ac2") {
            storeFile = file("../ac2-debug.keystore")
            storePassword = "ac2debug"
            keyAlias = "ac2"
            keyPassword = "ac2debug"
        }
        if (releaseKeystoreFile != null) {
            create("release") {
                storeFile = releaseKeystoreFile
                storePassword = System.getenv("AC2_RELEASE_STORE_PASSWORD")
                keyAlias = System.getenv("AC2_RELEASE_KEY_ALIAS")
                keyPassword = System.getenv("AC2_RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("ac2")
        }
        getByName("release") {
            isMinifyEnabled = false
            if (releaseKeystoreFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
            // 二进制在 CI 里已经 strip 过，别让 AGP 再尝试（构建机没装 NDK 时会告警）
            keepDebugSymbols += "**/libffmpegbin.so"
        }
    }

    sourceSets.getByName("main") {
        java.srcDir("src/main/java")
        assets.srcDir(layout.buildDirectory.dir("generated/assets"))
    }
}

/* 前端静态文件：构建时复制到 assets/frontend，Activity 启动时解压到 filesDir */
val copyFrontend by tasks.registering(Copy::class) {
    from("../../../frontend")
    into(layout.buildDirectory.dir("generated/assets/frontend"))
}

/* Python 源码 staging：只把 backend 放进 Chaquopy 源目录，避免扫描仓库根 */
val copyPython by tasks.registering(Copy::class) {
    from("../../../backend") {
        exclude("**/__pycache__/**", "**/*.pyc")
    }
    into(layout.buildDirectory.dir("generated/python/backend"))
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("PythonSources") }
    .configureEach { dependsOn(copyPython) }
tasks.named("preBuild") { dependsOn(copyFrontend, copyPython) }

chaquopy {
    defaultConfig {
        version = "3.14"
        buildPython("python3")
        pip {
            install("starlette")
            install("uvicorn")
            install("httpx")
            install("mutagen")
        }
    }
    sourceSets {
        getByName("main") {
            srcDir("${layout.buildDirectory.get().asFile}/generated/python")
        }
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
    // HiFi 播放：ExoPlayer + MediaSession（通知栏 / 锁屏 / 后台播放）
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-session:1.5.1")
}

/* APK 输出名与项目一致：Audio-CPM-debug.apk / Audio-CPM-release.apk */
tasks.matching { it.name == "assembleDebug" }.configureEach {
    doLast {
        val apkDir = layout.buildDirectory.dir("outputs/apk/debug").get().asFile
        apkDir.listFiles { f -> f.name == "app-debug.apk" }?.firstOrNull()?.let {
            it.renameTo(File(apkDir, "Audio-CPM-debug.apk"))
        }
    }
}

/* 发布 APK 与 AAB 使用统一命名，便于 Release / 商店上传 */
tasks.matching { it.name == "assembleRelease" }.configureEach {
    doLast {
        val apkDir = layout.buildDirectory.dir("outputs/apk/release").get().asFile
        apkDir.listFiles { f -> f.name == "app-release.apk" }?.firstOrNull()?.let {
            it.renameTo(File(apkDir, "Audio-CPM-release.apk"))
        }
    }
}
tasks.matching { it.name == "bundleRelease" }.configureEach {
    doLast {
        val bundleDir = layout.buildDirectory.dir("outputs/bundle/release").get().asFile
        bundleDir.listFiles { f -> f.name == "app-release.aab" }?.firstOrNull()?.let {
            it.renameTo(File(bundleDir, "Audio-CPM-release.aab"))
        }
    }
}
