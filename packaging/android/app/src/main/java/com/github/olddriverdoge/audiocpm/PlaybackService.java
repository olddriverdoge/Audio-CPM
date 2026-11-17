package com.github.olddriverdoge.audiocpm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;

import androidx.core.app.NotificationCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.MediaStyleNotificationHelper;

/** 本地 HiFi 播放服务：ExoPlayer + MediaSession（通知栏/锁屏/后台播放由 Media3 负责）。 */
public class PlaybackService extends MediaSessionService {
    private static final String TAG = "Audio-CPM";
    private static final String CHANNEL_ID = "audio_cpm_playback";
    private static final int NOTIF_ID = 1001;
    private static volatile ExoPlayer player;
    private static volatile MediaSession session;
    private static volatile String lastError = "";

    /** 频谱旁路：挂在 AudioSink 上只读 PCM，不改音频数据 */
    private final SpectrumProcessor spectrum = new SpectrumProcessor();

    public static ExoPlayer getPlayer() { return player; }
    public static String getLastError() { return lastError; }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "PlaybackService.onCreate");
        ensureChannel();
        /*
         * ExoPlayer.Builder 没有公开的 setAudioSink（1.5.x），
         * 官方扩展点是 DefaultRenderersFactory#buildAudioSink。
         */
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this) {
            @Override
            protected AudioSink buildAudioSink(Context context, boolean enableFloatOutput,
                                               boolean enableAudioTrackPlaybackParams) {
                return new DefaultAudioSink.Builder(context)
                        .setAudioProcessors(new AudioProcessor[]{PlaybackService.this.spectrum})
                        .setEnableFloatOutput(enableFloatOutput)
                        .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                        .build();
            }
        };
        player = new ExoPlayer.Builder(this, renderers).build();
        // 不接管音频焦点：旧 p4a 版就是默认行为；接管后一旦焦点被别的应用拿走会直接暂停。
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build(), false);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                lastError = error.getErrorCodeName() + " / " + describe(error);
                Log.e(TAG, "player error " + lastError, error);
                dumpError(error);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                lastError = state == Player.STATE_IDLE ? lastError : "";
                Log.i(TAG, "playback state -> " + state);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                Log.i(TAG, "isPlaying -> " + isPlaying);
            }

            @Override
            public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                // 换曲：把谱系清零，前端切歌窗口里取到的是干净的 0，不会画出上一首的残影
                SpectrumProcessor.clear();
                Log.i(TAG, "media item transition reason=" + reason);
            }
        });
        player.setSkipSilenceEnabled(false);

        Intent openApp = new Intent(this, MainActivity.class);
        openApp.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this, player)
                .setSessionActivity(pi)
                .build();
        // 关键：把 session 注册进 MediaSessionService。
        // 不 addSession 时，service 不会给 session 挂 MediaSessionListener，
        // onNotificationRefreshRequired 永远不触发，通知栏/前台服务也就不会出现
        // （本机 notifEnabled=true 却始终无通知，就是这个原因）。
        addSession(session);
        Log.i(TAG, "MediaSession created and added, player ready");
    }

    private void ensureChannel() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "播放控制", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(ch);
            }
        } catch (Throwable t) {
            Log.w(TAG, "create channel failed", t);
        }
    }

    /**
     * 自己接管通知：Media3 默认通知在本机没有出现（notifEnabled=true），
     * 所以直接覆写 onUpdateNotification 并用 MediaStyle 手动维护，
     * 保证通知栏/锁屏一定有媒体卡片，且播放时把服务拉进前台。
     */
    @Override
    public void onUpdateNotification(MediaSession session, boolean startInForegroundRequired) {
        try {
            Notification n = buildNotification(session);
            if (startInForegroundRequired) {
                startForeground(NOTIF_ID, n);
            } else {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                nm.notify(NOTIF_ID, n);
            }
        } catch (Throwable t) {
            Log.w(TAG, "own notification failed", t);
            super.onUpdateNotification(session, startInForegroundRequired);
        }
    }

    private Notification buildNotification(MediaSession session) {
        Player p = session.getPlayer();
        String title = "Audio-CPM";
        try {
            MediaItem mi = p.getCurrentMediaItem();
            if (mi != null && mi.localConfiguration != null && mi.localConfiguration.uri != null) {
                String path = mi.localConfiguration.uri.getPath();
                if (path != null) title = new File(path).getName();
            }
        } catch (Throwable ignored) {
        }
        boolean playing = p.isPlaying();
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent toggle = serviceAction("AUDIO_CPM_TOGGLE", 11);
        PendingIntent prev = serviceAction("AUDIO_CPM_PREV", 12);
        PendingIntent next = serviceAction("AUDIO_CPM_NEXT", 13);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title)
                .setContentText("Audio-CPM · HiFi")
                .setContentIntent(content)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .addAction(android.R.drawable.ic_media_previous, "上一首", prev)
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "暂停" : "播放", toggle)
                .addAction(android.R.drawable.ic_media_next, "下一首", next);
        b.setStyle(new MediaStyleNotificationHelper.MediaStyle(session)
                .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private PendingIntent serviceAction(String action, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, code, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (action != null && player != null) {
            if ("AUDIO_CPM_TOGGLE".equals(action)) {
                if (player.isPlaying()) player.pause(); else player.play();
                return START_STICKY;
            }
            if ("AUDIO_CPM_NEXT".equals(action)) {
                if (player.hasNextMediaItem()) player.seekToNextMediaItem();
                return START_STICKY;
            }
            if ("AUDIO_CPM_PREV".equals(action)) {
                if (player.hasPreviousMediaItem()) player.seekToPreviousMediaItem();
                else player.seekTo(0);
                return START_STICKY;
            }
        }
        return super.onStartCommand(intent, flags, startId);
    }

    /** 把异常链压成一行，diag 里直接能看到根因类型。 */
    static String describe(Throwable root) {
        StringBuilder sb = new StringBuilder();
        Throwable t = root;
        for (int d = 0; t != null && d < 6; d++) {
            if (d > 0) sb.append(" <- ");
            sb.append(t.getClass().getSimpleName());
            String m = t.getMessage();
            if (m != null && !m.isEmpty()) sb.append(": ").append(m);
            t = t.getCause();
        }
        return sb.toString();
    }

    /** 完整堆栈落盘，便于 adb/诊断接口取。 */
    private void dumpError(Throwable error) {
        try {
            StringWriter sw = new StringWriter();
            error.printStackTrace(new PrintWriter(sw));
            File f = new File(getFilesDir(), "player_error.txt");
            try (FileWriter w = new FileWriter(f, false)) {
                w.write(String.valueOf(System.currentTimeMillis()));
                w.write('\n');
                w.write(sw.toString());
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        Log.i(TAG, "onGetSession from " + (controllerInfo == null ? "?" : controllerInfo.getPackageName()));
        return session;
    }

    /** 从最近任务划掉 app 时不要停服务：通知栏继续可控，后台播放不断。 */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 有意留空
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "PlaybackService.onDestroy");
        if (session != null) session.release();
        if (player != null) player.release();
        session = null;
        player = null;
        super.onDestroy();
    }
}
