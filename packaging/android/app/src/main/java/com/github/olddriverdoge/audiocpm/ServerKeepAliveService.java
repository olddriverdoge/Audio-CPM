package com.github.olddriverdoge.audiocpm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * 本地 HTTP 服务的前台保活壳。
 *
 * Activity 在后台或浏览器拿着 127.0.0.1:8765 访问时，进程仍有前台服务，
 * Android 不会因为“没有可见界面”优先回收它；服务启动时也会确保 Python
 * 服务已运行。真正让系统不限制后台，还需要用户在电池优化/自启动里放行，
 * 这两步由设置页的后台运行区块引导。
 */
public class ServerKeepAliveService extends Service {
    private static final String TAG = "Audio-CPM";
    private static final String CHANNEL_ID = "ac2_local_server";
    private static final int NOTIF_ID = 1002;

    public static void start(Context context) {
        Intent i = new Intent(context, ServerKeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(i);
        } else {
            context.startService(i);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, ServerKeepAliveService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        startForegroundCompat();
        ServerRuntime.ensureStarted(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ServerRuntime.ensureStarted(this);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startForegroundCompat() {
        Intent open = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentTitle(getString(R.string.server_notif_title))
                .setContentText(getString(R.string.server_notif_text))
                .setContentIntent(pi)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                ServiceCompat.startForeground(this, NOTIF_ID, n,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Throwable t) {
            Log.e(TAG, "start server foreground failed", t);
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, getString(R.string.channel_server), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(getString(R.string.server_notif_text));
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }
}
