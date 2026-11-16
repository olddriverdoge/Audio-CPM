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

    packaging {
        jniLibs { useLegacyPackaging = true }
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
}
