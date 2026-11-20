package com.github.olddriverdoge.audiocpm;

import android.content.Context;
import android.util.Log;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * 本地 HTTP 服务的唯一启动入口。
 *
 * MainActivity 首次启动时写 ac2_boot.json 后调用 start()；前台保活服务从后台
 * 重建进程时调用 ensureStarted()，复用同一份配置把 Python 服务重新拉起来。
 */
public final class ServerRuntime {
    private static final String TAG = "Audio-CPM";
    public static final int PORT = 8765;
    private static final Object LOCK = new Object();
    private static volatile boolean started = false;

    private ServerRuntime() {}

    public static void start(Context context, String configPath) {
        synchronized (LOCK) {
            startLocked(context.getApplicationContext(), configPath);
        }
    }

    /** 服务在进程重建后调用：端口已开就只标记，否则从磁盘上的启动配置重启 Python。 */
    public static void ensureStarted(Context context) {
        Context app = context.getApplicationContext();
        synchronized (LOCK) {
            if (started || portOpen()) {
                started = true;
                return;
            }
            File cfg = new File(app.getFilesDir(), "ac2_boot.json");
            if (!cfg.isFile()) {
                Log.w(TAG, "server config missing; cannot restart local service");
                return;
            }
            startLocked(app, cfg.getAbsolutePath());
        }
    }

    private static void startLocked(Context context, String configPath) {
        if (started) return;
        started = true;
        try {
            if (!Python.isStarted()) Python.start(new AndroidPlatform(context));
        } catch (Throwable t) {
            started = false;
            Log.e(TAG, "Python.start failed", t);
            return;
        }
        new Thread(() -> {
            try {
                Python.getInstance().getModule("backend.boot").callAttr("run", configPath);
            } catch (Throwable t) {
                started = false;
                Log.e(TAG, "python server failed", t);
            }
        }, "audio-cpm-python").start();
    }

    public static boolean portOpen() {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", PORT), 300);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
