package com.github.olddriverdoge.audiocpm;

import android.app.Activity;
import android.content.res.AssetManager;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {
    private static final String TAG = "AC2";
    private static final int PORT = 8765;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        webView.setWebViewClient(new WebViewClient());
        WebView.setWebContentsDebuggingEnabled(true);
        setContentView(webView);

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
    }

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
