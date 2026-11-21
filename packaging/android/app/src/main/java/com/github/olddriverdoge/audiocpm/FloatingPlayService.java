package com.github.olddriverdoge.audiocpm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * 系统级悬浮窗：只承载播放管理页面（?float=1），盖在其他 App 上层。
 *
 * 页面是本地服务里的普通 HTML（和主工作台同一套组件），但只初始化
 * 播放管理 + 内嵌声谱；播放状态从本机 HiFi 服务接管，拖动/缩放/关闭
 * 由页面通过 AudioCpmFloat 桥驱动原生 WindowManager。
 */
public class FloatingPlayService extends Service {
    private static final String TAG = "Audio-CPM";
    private static final String CHANNEL = "ac2_float_play";
    private static final int NOTIF_ID = 0xAC2F;
    private static final String PREFS = "ac2_float_geo";

    public static volatile boolean running = false;

    private WindowManager wm;
    private FrameLayout rootView;
    private WebView webView;
    private WindowManager.LayoutParams lp;
    private final Handler main = new Handler(Looper.getMainLooper());
    private float density = 3f;
    private int screenW, screenH;

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        density = getResources().getDisplayMetrics().density;
        screenW = getResources().getDisplayMetrics().widthPixels;
        screenH = getResources().getDisplayMetrics().heightPixels;
        startForeground(NOTIF_ID, buildNotification());
        if (!android.provider.Settings.canDrawOverlays(this)) {
            Log.w(TAG, "overlay permission revoked, stop floating play");
            stopSelf();
            return;
        }
        ServerRuntime.ensureStarted(getApplicationContext());
        showOverlay();
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL, getString(R.string.float_channel_name), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setContentTitle(getString(R.string.float_notif_title))
                .setContentText(getString(R.string.float_notif_text))
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
    }

    private void showOverlay() {
        rootView = new FrameLayout(this);
        FrameLayout root = rootView;
        root.setBackgroundColor(Color.TRANSPARENT);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new FloatBridge(), "AudioCpmFloat");
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        int defW = Math.round(screenW * 0.92f);
        int defH = Math.round(screenH * 0.70f);
        int w = prefs.getInt("w", defW);
        int h = prefs.getInt("h", defH);
        int x = prefs.getInt("x", screenW - w - Math.round(8 * density));
        int y = prefs.getInt("y", Math.round(64 * density));
        w = Math.max(Math.round(240 * density), Math.min(w, screenW));
        h = Math.max(Math.round(260 * density), Math.min(h, screenH));

        lp = new WindowManager.LayoutParams(
                w, h,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = x; lp.y = y;
        try {
            wm.addView(root, lp);
        } catch (Throwable t) {
            Log.e(TAG, "overlay addView failed", t);
            stopSelf();
            return;
        }
        webView.loadUrl("http://127.0.0.1:" + ServerRuntime.PORT + "/?float=1");
    }

    private void saveGeo() {
        try {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putInt("x", lp.x).putInt("y", lp.y)
                    .putInt("w", lp.width).putInt("h", lp.height).apply();
        } catch (Throwable ignored) {}
    }

    private void clamp() {
        int margin = Math.round(4 * density);
        if (lp.x < -lp.width + margin) lp.x = -lp.width + margin;
        if (lp.x > screenW - margin) lp.x = screenW - margin;
        if (lp.y < margin) lp.y = margin;
        if (lp.y > screenH - margin) lp.y = screenH - margin;
        lp.width = Math.max(Math.round(220 * density), Math.min(lp.width, screenW));
        lp.height = Math.max(Math.round(240 * density), Math.min(lp.height, screenH));
    }

    private class FloatBridge {
        /** 当前窗口几何（CSS/dp 像素），页面用绝对坐标拖动，避免移动中的
         *  相对坐标反馈造成整窗抖动。 */
        @JavascriptInterface
        public String pos() {
            if (lp == null) return "{\"ok\":false}";
            return "{\"ok\":true,\"x\":" + (lp.x / density) + ",\"y\":" + (lp.y / density)
                    + ",\"w\":" + (lp.width / density) + ",\"h\":" + (lp.height / density) + "}";
        }

        @JavascriptInterface
        public void moveTo(float x, float y) {
            main.post(() -> {
                if (lp == null) return;
                lp.x = Math.round(x * density);
                lp.y = Math.round(y * density);
                clamp();
                try { if (rootView != null) wm.updateViewLayout(rootView, lp); } catch (Throwable ignored) {}
                saveGeo();
            });
        }

        @JavascriptInterface
        public void moveBy(float dx, float dy) {
            main.post(() -> {
                if (lp == null) return;
                lp.x += Math.round(dx * density);
                lp.y += Math.round(dy * density);
                clamp();
                try { if (rootView != null) wm.updateViewLayout(rootView, lp); } catch (Throwable ignored) {}
                saveGeo();
            });
        }

        /** 页面给的是 CSS 像素（= dp），这里换算成窗口物理像素。 */
        @JavascriptInterface
        public void resizeTo(float w, float h) {
            main.post(() -> {
                if (lp == null) return;
                lp.width = Math.round(w * density);
                lp.height = Math.round(h * density);
                clamp();
                try { if (rootView != null) wm.updateViewLayout(rootView, lp); } catch (Throwable ignored) {}
                saveGeo();
            });
        }

        @JavascriptInterface
        public void close() {
            main.post(FloatingPlayService.this::stopSelf);
        }

        @JavascriptInterface
        public String status() {
            return "{\"ok\":true,\"running\":true}";
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            if (rootView != null && rootView.getParent() != null) {
                wm.removeView(rootView);
            }
        } catch (Throwable ignored) {}
        try { if (webView != null) webView.destroy(); } catch (Throwable ignored) {}
        webView = null;
        rootView = null;
        lp = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
