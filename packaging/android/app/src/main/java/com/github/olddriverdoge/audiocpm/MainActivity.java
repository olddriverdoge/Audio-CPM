package com.github.olddriverdoge.audiocpm;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String TAG = "AC2";
    private static final int PORT = 8765;

    private static final int REQ_ALL_FILES = 1001;
    private static final int REQ_MEDIA_AUDIO = 1002;
    private static final int REQ_LEGACY_STORAGE = 1003;
    private static final int REQ_NOTIFICATIONS = 1004;

    private static final String PREFS = "ac2_shell";
    private static final String KEY_ALL_FILES_PROMPTED = "all_files_prompted";

    private WebView webView;
    /** 上次 onResume 时是否已有全盘读取权限，用于“授权返回后自动刷新页面” */
    private boolean lastStorageGranted = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /*
         * targetSdk 35 在 Android 15+ 强制 edge-to-edge：
         * 必须显式关闭 decorFitsSystemWindows，再自己按 insets 留出状态栏/导航栏的高度，
         * 否则 WebView 会绘制到状态栏与手势条下面，顶部按钮点不到。
         */
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        webView.setWebViewClient(new WebViewClient());
        WebView.setWebContentsDebuggingEnabled(true);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // 把 systemBars + 刘海的高度作为 padding 让出去，横竖屏切换时自动重算
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(root);

        File data = getFilesDir();
        File frontend = new File(data, "frontend");
        try {
            copyAssets("frontend", frontend);
        } catch (Exception e) {
            Log.e(TAG, "copy frontend failed", e);
        }

        File config = new File(data, "ac2_boot.json");
        String json = "{\"AC2_DATA_DIR\":\"" + esc(data.getAbsolutePath()) + "\","
                + "\"AC2_FRONTEND_DIR\":\"" + esc(frontend.getAbsolutePath()) + "\","
                + "\"AC2_ROOT\":\"/sdcard\",\"AC2_HOST\":\"127.0.0.1\","
                + "\"AC2_PORT\":\"" + PORT + "\",\"AC2_ANDROID\":\"1\","
                + "\"AC2_NATIVE_LIB_DIR\":\"" + esc(getApplicationInfo().nativeLibraryDir) + "\"}";
        try (FileOutputStream out = new FileOutputStream(config)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.e(TAG, "write config failed", e);
        }

        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(this));
        }
        final String cfgPath = config.getAbsolutePath();
        new Thread(() -> {
            try {
                Python.getInstance().getModule("backend.boot").callAttr("run", cfgPath);
            } catch (Throwable t) {
                Log.e(TAG, "python server failed", t);
            }
        }, "ac2-python").start();

        new Thread(this::waitAndLoad, "ac2-wait").start();

        lastStorageGranted = hasStorageAccess();
        ensureStorageAccess();
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean granted = hasStorageAccess();
        if (granted && !lastStorageGranted) {
            Log.i(TAG, "storage access granted, reloading web view");
            if (webView != null) {
                webView.post(() -> webView.reload());
            }
        } else if (!granted && lastStorageGranted) {
            Log.w(TAG, "storage access revoked");
        }
        lastStorageGranted = granted;
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // manifest 里声明了 configChanges=orientation|screenSize，Activity 不会重建，
        // 需要手动重新派发一次 insets，横竖屏切换后 padding 才对。
        if (webView != null && webView.getParent() instanceof android.view.View) {
            ViewCompat.requestApplyInsets((android.view.View) webView.getParent());
        }
    }

    // ---------------------------------------------------------------- 存储权限

    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * 启动时确保有 /sdcard 的读取能力：
     * - Android 11+ 走 MANAGE_EXTERNAL_STORAGE（跳系统“所有文件访问权限”页）
     * - Android 13+ 额外要 READ_MEDIA_AUDIO（仅媒体库读取，权限页里也会列出来）
     * - Android 6~10 走老的运行时权限
     * 自动跳设置的弹窗只弹一次，之后由用户在页面里自行处理，避免每次冷启动都打断。
     */
    private void ensureStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
                if (!sp.getBoolean(KEY_ALL_FILES_PROMPTED, false)) {
                    sp.edit().putBoolean(KEY_ALL_FILES_PROMPTED, true).apply();
                    showAllFilesDialog();
                } else {
                    Log.w(TAG, "all-files access not granted (already prompted once)");
                }
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE},
                        REQ_LEGACY_STORAGE);
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.READ_MEDIA_AUDIO},
                    REQ_MEDIA_AUDIO);
        }

        // 通知栏播放控制需要 POST_NOTIFICATIONS（33+）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    REQ_NOTIFICATIONS);
        }
    }

    private void openNotificationSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            startActivity(i);
        } catch (Exception e) {
            Log.w(TAG, "open notification settings failed", e);
        }
    }

    private void showAllFilesDialog() {
        new AlertDialog.Builder(this)
                .setTitle("需要文件访问权限")
                .setMessage("AC2 需要读取手机存储里的音乐文件。请在下一步打开“允许访问所有文件”，"
                        + "否则只能看到目录、看不到歌曲。")
                .setPositiveButton("去授权", (d, w) -> openAllFilesSettings())
                .setNegativeButton("稍后", null)
                .show();
    }

    private void openAllFilesSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivityForResult(intent, REQ_ALL_FILES);
        } catch (Exception e) {
            Log.w(TAG, "open all-files settings failed, fallback to list", e);
            try {
                startActivityForResult(
                        new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),
                        REQ_ALL_FILES);
            } catch (Exception e2) {
                Log.e(TAG, "open all-files settings fallback failed", e2);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        boolean grantedNow = false;
        for (int i = 0; i < permissions.length && i < results.length; i++) {
            boolean ok = results[i] == PackageManager.PERMISSION_GRANTED;
            Log.i(TAG, "permission " + permissions[i] + " granted=" + ok);
            if (ok) grantedNow = true;
        }
        if (requestCode == REQ_NOTIFICATIONS) {
            // 通知栏是 HiFi 的可见入口，被拒时明确告诉用户去哪儿开
            boolean anyNotif = false;
            for (int i = 0; i < permissions.length && i < results.length; i++) {
                if (Manifest.permission.POST_NOTIFICATIONS.equals(permissions[i])
                        && results[i] == PackageManager.PERMISSION_GRANTED) anyNotif = true;
            }
            if (!anyNotif) {
                new AlertDialog.Builder(this)
                        .setTitle("通知权限未开启")
                        .setMessage("播放时通知栏/锁屏不会出现播放控件。可在系统设置里为本应用打开通知。")
                        .setPositiveButton("去设置", (d, w) -> openNotificationSettings())
                        .setNegativeButton("知道了", null)
                        .show();
            }
        }
        if (grantedNow && webView != null) {
            webView.post(() -> webView.reload());
        }
        lastStorageGranted = hasStorageAccess();
    }

    // ---------------------------------------------------------------- 服务启动

    private void waitAndLoad() {
        for (int i = 0; i < 120; i++) {
            if (portOpen()) {
                runOnUiThread(() -> webView.loadUrl("http://127.0.0.1:" + PORT + "/"));
                return;
            }
            try { Thread.sleep(500); } catch (InterruptedException ignored) {}
        }
        runOnUiThread(() -> webView.loadDataWithBaseURL(null,
                "<h1>AC2 服务启动失败</h1><p>请查看 files/ac2_boot.json 与 logcat。</p>",
                "text/html", "utf-8", null));
    }

    private boolean portOpen() {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", PORT), 300);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String esc(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private void copyAssets(String assetDir, File outDir) throws Exception {
        AssetManager am = getAssets();
        String[] names = am.list(assetDir);
        if (names == null || names.length == 0) return;
        outDir.mkdirs();
        for (String name : names) {
            String path = assetDir + "/" + name;
            File out = new File(outDir, name);
            String[] children = am.list(path);
            if (children != null && children.length > 0) {
                copyAssets(path, out);
            } else {
                try (InputStream in = am.open(path); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
            }
        }
    }
}
