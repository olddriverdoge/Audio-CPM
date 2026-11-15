# AndroidManifest 增量（合并进 p4a 模板）

## 1. FileProvider（外部播放器，Android 7+ 必需）

```xml
<provider
    android:name="androidx.core.content.FileProvider"
    android:authorities="${applicationId}.fileprovider"
    android:exported="false"
    android:grantUriPermissions="true">
    <meta-data
        android:name="android.support.FILE_PROVIDER_PATHS"
        android:resource="@xml/file_paths" />
</provider>
```

`res/xml/file_paths.xml`：

```xml
<paths>
    <external-path name="sdcard" path="." />
</paths>
```

> 若无 AndroidX（p4a 默认模板可能没有），可在 `buildozer.spec` 加
> `android.gradle_dependencies = androidx.core:core:1.12.0`；否则用自定义 ContentProvider（约 40 行）替代。

## 2. 包可见性（Android 11+ 才能查到播放器）

```xml
<queries>
    <intent>
        <action android:name="android.intent.action.VIEW" />
        <data android:mimeType="audio/*" />
    </intent>
</queries>
```

## 3. 权限

- targetSdk 28：`READ_EXTERNAL_STORAGE`、`WRITE_EXTERNAL_STORAGE`
- targetSdk 30+ 若继续用路径访问：`MANAGE_EXTERNAL_STORAGE`（需用户手动开"所有文件访问"），并在代码里检测/引导
- 网络：`INTERNET`（127.0.0.1 服务 + WebDAV）

## 4. 其他

- `android:usesCleartextTraffic="true"`（本地 HTTP，p4a 模板默认）
- `android:extractNativeLibs="true"`（FFmpeg .so 需解压到 nativeLibraryDir）
