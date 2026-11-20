package com.github.olddriverdoge.audiocpm;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.database.Cursor;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.net.Uri;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.Settings;
import android.provider.OpenableColumns;
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
import androidx.core.view.WindowInsetsControllerCompat;


import java.io.File;
import java.io.IOException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String TAG = "Audio-CPM";
    private static final int PORT = ServerRuntime.PORT;

    private static final int REQ_ALL_FILES = 1001;
    private static final int REQ_MEDIA_AUDIO = 1002;
    private static final int REQ_LEGACY_STORAGE = 1003;
    private static final int REQ_NOTIFICATIONS = 1004;
    private static final int REQ_PICK_COVER = 1005;

    private static final String PREFS = "ac2_shell";
    private static final String KEY_ALL_FILES_PROMPTED = "all_files_prompted";

    private WebView webView;
    private int insetTop, insetBottom, insetLeft, insetRight;
    /** 上次 onResume 时是否已有全盘读取权限，用于“授权返回后自动刷新页面” */
    private boolean lastStorageGranted = false;
    /** 系统图片选择器是否正在前台，避免连续点击开多个系统页面。 */
    private boolean pickerActive = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /*
         * targetSdk 35 在 Android 15+ 强制 edge-to-edge（内容必须画到系统栏后面）。
         * 做法按官方指南 + 社区通用解：系统栏透明、自己处理 insets，
         * 顶部交给页面 header 补 padding（避免露出窗口底色那条“黑边”）。
         */
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        /*
         * 系统栏一律透明：状态栏区域不再是一块黑条，而是由页面 header 自己的背景色填充
         * （现代 App 的通行做法：顶栏延伸到状态栏后面，内容再按 inset 让位）。
         */
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);   // 关掉三键导航的半透明遮罩
        }
        getWindow().setBackgroundDrawable(new ColorDrawable(0xFF0F1419));  // 与页面底色一致，启动不闪白
        WindowInsetsControllerCompat wic =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        wic.setAppearanceLightStatusBars(false);       // 深色界面 → 白色系统图标
        wic.setAppearanceLightNavigationBars(false);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pushInsetsToWeb(insetTop, insetBottom, insetLeft, insetRight);
            }
        });
        // 没有 WebChromeClient 时，JS 的 alert()/confirm() 会被静默吞掉：
        // 表现就是“长按删除没弹窗、也没删成功”。这里显式用系统对话框接管。
        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onJsAlert(android.webkit.WebView v, String url, String message,
                                     final android.webkit.JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(getString(R.string.dialog_ok), (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(android.webkit.WebView v, String url, String message,
                                       final android.webkit.JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(getString(R.string.dialog_confirm), (d, w) -> result.confirm())
                        .setNegativeButton(getString(R.string.dialog_cancel), (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }
        });
        // 频谱高刷通道：JS 直接同步调用 Java（绕过 HTTP 轮询的序列化/线程开销），
        // 供前端 requestAnimationFrame 90Hz 级刷新使用。
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public String spectrum() {
                try { return AudioCpmBridge.spectrum(); } catch (Throwable t) { return "{}"; }
            }

            @android.webkit.JavascriptInterface
            public String setParams(String json) {
                try { return AudioCpmBridge.setParams(json); } catch (Throwable t) { return "{}"; }
            }

            /**
             * 设置里的英文语言提示：在系统浏览器打开本地服务，方便启用浏览器自动翻译。
             * 只放行本机 127.0.0.1:8765 / localhost:8765，避免变成任意 URL 跳转口。
             */
            @android.webkit.JavascriptInterface
            public String openExternalUrl(String url) {
                try {
                    Uri u = Uri.parse(String.valueOf(url));
                    String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
                    String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
                    if (!("http".equals(scheme) || "https".equals(scheme))
                            || !("127.0.0.1".equals(host) || "localhost".equals(host))
                            || u.getPort() != PORT) {
                        return "{\"ok\":false,\"error\":\"untrusted url\"}";
                    }
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                    return "{\"ok\":true}";
                } catch (Throwable t) {
                    return "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(t)) + "}";
                }
            }

            /** 设置页后台运行状态：是否被系统电池优化限制。 */
            @android.webkit.JavascriptInterface
            public String backgroundStatus() {
                try {
                    PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                    boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
                    JSONObject j = new JSONObject();
                    j.put("ok", true);
                    j.put("battery_optimized", !ignoring);
                    j.put("ignoring_battery", ignoring);
                    j.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
                    return j.toString();
                } catch (Throwable t) {
                    return "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(t)) + "}";
                }
            }

            /** 引导用户把本应用加入“不优化电池”名单；失败时退到电池优化列表。 */
            @android.webkit.JavascriptInterface
            public String requestBackground() {
                try {
                    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    i.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                    return "{\"ok\":true}";
                } catch (Throwable t) {
                    return openBatterySettings();
                }
            }

            /** 打开系统电池优化列表（部分 ROM 没有直接请求页时用这个）。 */
            @android.webkit.JavascriptInterface
            public String openBatterySettings() {
                try {
                    startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    return "{\"ok\":true}";
                } catch (Throwable t) {
                    return "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(t)) + "}";
                }
            }

            /** 打开本应用系统详情页：小米/华为等自启动、后台限制通常在这里。 */
            @android.webkit.JavascriptInterface
            public String openAppSettings() {
                try {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                    return "{\"ok\":true}";
                } catch (Throwable t) {
                    return "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(t)) + "}";
                }
            }

            /**
             * 下载更新 APK：交给系统 DownloadManager，完成后通知栏可点开安装。
             * 只允许本仓库 releases/download/http(s) 地址，避免任意 URL 被注入下载。
             */
            @android.webkit.JavascriptInterface
            public String downloadUpdate(String url, String filename) {
                try {
                    if (!isAllowedUpdateUrl(url)) {
                        return "{\"ok\":false,\"error\":\"untrusted url\"}";
                    }
                    String safe = safeApkName(filename);
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm == null) return "{\"ok\":false,\"error\":\"download manager unavailable\"}";
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setTitle("Audio-CPM update");
                    req.setDescription("Audio-CPM " + safe);
                    req.setMimeType("application/vnd.android.package-archive");
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setAllowedOverMetered(true);
                    req.setAllowedOverRoaming(false);
                    String unique = safe.replaceAll("(?i)\\.apk$", "") + "-" + System.currentTimeMillis() + ".apk";
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                            "Audio-CPM/" + unique);
                    long id = dm.enqueue(req);
                    return "{\"ok\":true,\"id\":" + id + "}";
                } catch (Throwable t) {
                    return "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(t)) + "}";
                }
            }

            /**
             * 调起系统文件选择器选封面。结果通过 window.AudioCpmPickResult(json) 异步回传。
             * 不用应用内自绘选择器：用户明确要求系统组件，而且系统选择器能到最前台。
             */
            @android.webkit.JavascriptInterface
            public String pickImage() {
                if (pickerActive) return "{\"ok\":false,\"error\":\"busy\"}";
                pickerActive = true;
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES,
                            new String[]{"image/jpeg", "image/png", "image/webp", "image/bmp"});
                    intent.putExtra(Intent.EXTRA_TITLE, getString(R.string.cover_picker_title));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        startActivityForResult(intent, REQ_PICK_COVER);
                    } catch (ActivityNotFoundException e) {
                        // 极少数精简 ROM 没有 DocumentsUI：退回系统文件选择（不是应用内选择器）。
                        try {
                            Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
                            fallback.addCategory(Intent.CATEGORY_OPENABLE);
                            fallback.setType("image/*");
                            fallback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            startActivityForResult(fallback, REQ_PICK_COVER);
                        } catch (Throwable t) {
                            pickerActive = false;
                            callbackPick("{\"ok\":false,\"error\":\"system picker unavailable\"}");
                        }
                    } catch (Throwable t) {
                        pickerActive = false;
                        callbackPick("{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(t)) + "}");
                    }
                });
                return "{\"ok\":true}";
            }
        }, "AudioCpmNative");
        WebView.setWebContentsDebuggingEnabled(true);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        /*
         * 只给底部导航栏留白（固定悬浮控件不被手势条挡住）；
         * 顶部不再用原生 padding 顶下去——那样会在状态栏下面露出一条窗口底色（就是你说的"黑边"）。
         * 顶部 inset 通过 CSS 变量 --sat 交给页面，由 header 自己补 padding-top，
         * 于是 header 背景直接铺满状态栏区域，视觉上是连续的，没有分隔条。
         */
        root.setBackgroundColor(0xFF0F1419);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(0, 0, 0, bars.bottom);
            pushInsetsToWeb(bars.top, bars.bottom, bars.left, bars.right);
            // 归零后继续下发，避免 WebView 自己再按 inset 补一次（双重留白）
            return new WindowInsetsCompat.Builder(windowInsets)
                    .setInsets(WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
                    .build();
        });
        ViewCompat.requestApplyInsets(root);

        File data = getFilesDir();
        File frontend = new File(data, "frontend");
        try {
            copyAssets("frontend", frontend);
        } catch (Exception e) {
            Log.e(TAG, "copy frontend failed", e);
        }

        String appVersion = "0.0.0";
        long appVersionCode = 0;
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            appVersion = pi.versionName == null ? "0.0.0" : pi.versionName;
            appVersionCode = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Throwable t) {
            Log.w(TAG, "read app version failed", t);
        }
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        // 只有真正的稳定 release 包走生产通道；debug / .dev 构建都走测试通道。
        String updateChannel = (debuggable || getPackageName().endsWith(".dev")) ? "test" : "release";

        File config = new File(data, "ac2_boot.json");
        String json = "{\"AC2_DATA_DIR\":\"" + esc(data.getAbsolutePath()) + "\","
                + "\"AC2_FRONTEND_DIR\":\"" + esc(frontend.getAbsolutePath()) + "\","
                + "\"AC2_ROOT\":\"/sdcard\",\"AC2_HOST\":\"127.0.0.1\","
                + "\"AC2_PORT\":\"" + PORT + "\",\"AC2_ANDROID\":\"1\","
                + "\"AC2_APP_VERSION\":\"" + esc(appVersion) + "\","
                + "\"AC2_APP_VERSION_CODE\":\"" + appVersionCode + "\","
                + "\"AC2_APP_PACKAGE\":\"" + esc(getPackageName()) + "\","
                + "\"AC2_UPDATE_CHANNEL\":\"" + updateChannel + "\","
                + "\"AC2_NATIVE_LIB_DIR\":\"" + esc(getApplicationInfo().nativeLibraryDir) + "\"}";
        try (FileOutputStream out = new FileOutputStream(config)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.e(TAG, "write config failed", e);
        }

        ServerRuntime.start(this, config.getAbsolutePath());
        try {
            // 前台保活服务：浏览器在后台调用 127.0.0.1:8765 时，进程仍保有前台优先级。
            ServerKeepAliveService.start(this);
        } catch (Throwable t) {
            Log.e(TAG, "start keepalive service failed", t);
        }

        new Thread(this::waitAndLoad, "audio-cpm-wait").start();

        lastStorageGranted = hasStorageAccess();
        ensureStorageAccess();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK_COVER) return;
        pickerActive = false;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            callbackPick("{\"ok\":false,\"canceled\":true}");
            return;
        }
        final android.net.Uri uri = data.getData();
        try {
            // 只读授权在当前进程里复制文件即可；仍申请持久授权，避免少数 provider 延迟读失败。
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Throwable ignored) {
        }
        new Thread(() -> importPickedImage(uri), "ac2-pick-cover").start();
    }

    /** 把系统选择器返回的 content:// 图片复制到 App 私有缓存，回传 Python/前端可读的绝对路径。 */
    private void importPickedImage(android.net.Uri uri) {
        String name = "";
        try (Cursor c = getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Throwable ignored) {
        }
        String mime = "";
        try { mime = String.valueOf(getContentResolver().getType(uri)); } catch (Throwable ignored) {}
        String ext = coverExtension(name, mime);
        File dir = new File(getCacheDir(), "picked_covers");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            callbackPick("{\"ok\":false,\"error\":\"cannot create cache dir\"}");
            return;
        }
        File out = new File(dir, "cover-" + System.currentTimeMillis() + "." + ext);
        try (InputStream in = getContentResolver().openInputStream(uri);
             OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new IOException("openInputStream returned null");
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        } catch (Throwable t) {
            try { out.delete(); } catch (Throwable ignored) {}
            callbackPick("{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(t)) + "}");
            return;
        }
        if (out.length() <= 0) {
            try { out.delete(); } catch (Throwable ignored) {}
            callbackPick("{\"ok\":false,\"error\":\"empty image\"}");
            return;
        }
        callbackPick("{\"ok\":true,\"path\":" + JSONObject.quote(out.getAbsolutePath())
                + ",\"name\":" + JSONObject.quote(name.isEmpty() ? out.getName() : name) + "}");
    }

    private static String coverExtension(String name, String mime) {
        String n = name == null ? "" : name.toLowerCase();
        int dot = n.lastIndexOf('.');
        if (dot >= 0 && dot < n.length() - 1) {
            String e = n.substring(dot + 1);
            if (e.matches("jpe?g|png|webp|bmp")) return e.equals("jpeg") ? "jpg" : e;
        }
        String m = mime == null ? "" : mime.toLowerCase();
        if (m.contains("png")) return "png";
        if (m.contains("webp")) return "webp";
        if (m.contains("bmp")) return "bmp";
        return "jpg";
    }

    private void callbackPick(String json) {
        final String js = "window.AudioCpmPickResult&&window.AudioCpmPickResult("
                + JSONObject.quote(json) + ")";
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
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

    /** 把系统栏 inset 写进页面 CSS 变量（--sat/--sab/--sal/--sar），供 header / 浮层留白 */
    private void pushInsetsToWeb(int top, int bottom, int left, int right) {
        insetTop = top; insetBottom = bottom; insetLeft = left; insetRight = right;
        if (webView == null) return;
        /*
         * insets 是物理像素，CSS 是 dp：必须除以 density 再注入，
         * 否则在 3x 屏上状态栏留白会是应该的 3 倍（看起来"太宽、很丑"）。
         */
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        int topDp = Math.round(top / density), bottomDp = Math.round(bottom / density);
        int leftDp = Math.round(left / density), rightDp = Math.round(right / density);
        String js = "try{var d=document.documentElement.style;"
                + "d.setProperty('--sat','" + topDp + "px');"
                + "d.setProperty('--sab','" + bottomDp + "px');"
                + "d.setProperty('--sal','" + leftDp + "px');"
                + "d.setProperty('--sar','" + rightDp + "px');"
                + "}catch(e){}";
        webView.evaluateJavascript(js, null);
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

    /** 只允许仓库 release 资产页；GitHub API 返回的 browser_download_url 就是这个前缀。 */
    private static boolean isAllowedUpdateUrl(String url) {
        try {
            Uri u = Uri.parse(String.valueOf(url));
            return "https".equalsIgnoreCase(u.getScheme())
                    && "github.com".equalsIgnoreCase(u.getHost())
                    && u.getPath() != null
                    && u.getPath().startsWith("/olddriverdoge/Audio-CPM/releases/download/");
        } catch (Throwable t) {
            return false;
        }
    }

    private static String safeApkName(String name) {
        String n = name == null ? "" : new File(name).getName();
        n = n.replaceAll("[^A-Za-z0-9._-]", "_");
        if (n.length() > 100) n = n.substring(n.length() - 100);
        if (!n.toLowerCase().endsWith(".apk")) n = "Audio-CPM-update.apk";
        return n;
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
                .setTitle(getString(R.string.file_access_title))
                .setMessage(getString(R.string.file_access_message))
                .setPositiveButton(getString(R.string.file_access_grant), (d, w) -> openAllFilesSettings())
                .setNegativeButton(getString(R.string.file_access_later), null)
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
                        .setTitle(getString(R.string.notif_title))
                        .setMessage(getString(R.string.notif_message))
                        .setPositiveButton(getString(R.string.notif_settings), (d, w) -> openNotificationSettings())
                        .setNegativeButton(getString(R.string.notif_known), null)
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
                "<h1>Audio-CPM 服务启动失败</h1><p>请查看 files/ac2_boot.json 与 logcat。</p>",
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
