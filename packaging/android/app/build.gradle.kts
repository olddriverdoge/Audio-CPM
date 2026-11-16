plugins {
    id("com.android.application")
    id("com.chaquo.python")
}

android {
    namespace = "com.github.olddriverdoge.audiocpm"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.github.olddriverdoge.audiocpm"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1"
        ndk { abiFilters += listOf("arm64-v8a") }
    }

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
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("ac2")
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

/* APK 输出名与项目一致：Audio-CPM-debug.apk */
tasks.named("assembleDebug") {
    doLast {
        val apkDir = layout.buildDirectory.dir("outputs/apk/debug").get().asFile
        apkDir.listFiles { f -> f.name == "app-debug.apk" }?.firstOrNull()?.let {
            it.renameTo(File(apkDir, "Audio-CPM-debug.apk"))
        }
    }
}
