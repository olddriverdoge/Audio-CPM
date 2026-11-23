package com.github.olddriverdoge.audiocpm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaMetadataRetriever;
import android.os.PowerManager;
import android.os.Handler;
import android.os.Looper;
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
    private static final String PREFS_AUDIO = "ac2_audio_state";
    private static final String KEY_PREFERRED_DEVICE = "preferred_device";
    private static final String KEY_AUDIO_FOCUS = "audio_focus";
    private static final int NOTIF_ID = 1001;
    private static volatile ExoPlayer player;
    private static volatile MediaSession session;
    private static volatile String lastError = "";
    private static volatile long errorSeq = 0;
    private static volatile int audioSessionId = 0;
    private static volatile int preferredDeviceId = 0;
    private static volatile boolean audioFocusEnabled = false;
    private PowerManager.WakeLock wakeLock;
    private volatile String metaPath = "";
    private volatile String[] metaCache = null;
    /* 前端 probe 已经把 title/artist/composer/album 读出来了；FLAC 的 composer
       在部分 ROM 的 MediaMetadataRetriever 里取不到，这里优先使用前端提示。 */
    private static volatile String hintPath = "";
    private static volatile String hintTitle = "";
    private static volatile String hintArtist = "";
    private static volatile String hintComposer = "";
    private static volatile String hintAlbum = "";
    private static volatile PlaybackService instance;

    /** 频谱旁路：挂在 AudioSink 上只读 PCM，不改音频数据 */
    private final SpectrumProcessor spectrum = new SpectrumProcessor();
    /** 软件 10 段 EQ + 前级：PCM 级处理，所有输出方式都生效 */
    private final SoftwareEqProcessor softwareEq = new SoftwareEqProcessor();

    public static ExoPlayer getPlayer() { return player; }
    public static int getPreferredDeviceId() { return preferredDeviceId; }
    public static boolean isAudioFocusEnabled() { return audioFocusEnabled; }

    /** 音频焦点开关：持久化并立即应用到当前 ExoPlayer。 */
    public static boolean setAudioFocusEnabled(boolean enabled) {
        audioFocusEnabled = enabled;
        try {
            Context c = AudioCpmApp.get();
            if (c != null) c.getSharedPreferences(PREFS_AUDIO, Context.MODE_PRIVATE)
                    .edit().putBoolean(KEY_AUDIO_FOCUS, enabled).apply();
        } catch (Throwable ignored) {}
        final ExoPlayer p = player;
        if (p != null) {
            // ExoPlayer 只能在创建它的应用线程（主线程）访问；桥接调用来自
            // Python 工作线程，直接 setAudioAttributes 会触发线程校验异常。
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    p.setAudioAttributes(new AudioAttributes.Builder()
                            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                            .setUsage(C.USAGE_MEDIA)
                            .build(), enabled);
                } catch (Throwable t) {
                    Log.w(TAG, "setAudioFocus failed: " + t);
                }
            });
        }
        return true;
    }

    public static void setNowPlayingMeta(String path, String title, String artist, String composer, String album) {
        hintPath = path == null ? "" : path;
        hintTitle = title == null ? "" : title;
        hintArtist = artist == null ? "" : artist;
        hintComposer = composer == null ? "" : composer;
        hintAlbum = album == null ? "" : album;
        PlaybackService s = instance;
        if (s != null) s.refreshNotification();
    }

    /** DAC / USB / 有线输出路由：只改 ExoPlayer 的 preferred device，不改变解码和 EQ 链路。 */
    public static boolean setPreferredDevice(int id) {
        preferredDeviceId = Math.max(0, id);
        // 进程重启后也要恢复用户选过的 DAC/耳机，不能只活在前端 localStorage 里。
        try {
            Context c = AudioCpmApp.get();
            if (c != null) c.getSharedPreferences(PREFS_AUDIO, Context.MODE_PRIVATE)
                    .edit().putInt(KEY_PREFERRED_DEVICE, preferredDeviceId).apply();
        } catch (Throwable ignored) {}
        // 服务/播放器还没起来时先记住选择，PlaybackService.onCreate 会再应用一次。
        if (player == null) return true;
        return applyPreferredDevice();
    }

    private static boolean applyPreferredDevice() {
        ExoPlayer p = player;
        if (p == null) return false;
        if (preferredDeviceId <= 0) {
            p.setPreferredAudioDevice(null);
            return true;
        }
        try {
            AudioManager am = (AudioManager) AudioCpmApp.get().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return false;
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (d.getId() == preferredDeviceId) {
                    p.setPreferredAudioDevice(d);
                    return true;
                }
            }
        } catch (Throwable ignored) {}
        return false;
    }
    public static String getLastError() { return lastError; }
    public static long getErrorSeq() { return errorSeq; }
    public static int getAudioSessionId() { return audioSessionId; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Log.i(TAG, "PlaybackService.onCreate");
        try {
            preferredDeviceId = getSharedPreferences(PREFS_AUDIO, Context.MODE_PRIVATE)
                    .getInt(KEY_PREFERRED_DEVICE, 0);
            audioFocusEnabled = getSharedPreferences(PREFS_AUDIO, Context.MODE_PRIVATE)
                    .getBoolean(KEY_AUDIO_FOCUS, false);
        } catch (Throwable ignored) {}
        // 进程可能被系统回收后重建；高低音/EQ 参数从原生偏好恢复，不依赖前端面板是否打开。
        try { SoftwareEqProcessor.restore(this); } catch (Throwable ignored) {}
        ensureChannel();
        // 每次新进程启动都清掉上次的诊断残留，避免旧 errorLog 被误当成
        // 当前播放错误（旧文件只在 onPlayerError 时覆盖，不会自动清空）。
        clearStaleDiagnostics();
        /*
         * ExoPlayer.Builder 没有公开的 setAudioSink（1.5.x），
         * 官方扩展点是 DefaultRenderersFactory#buildAudioSink。
         */
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this) {
            @Override
            protected AudioSink buildAudioSink(Context context, boolean enableFloatOutput,
                                               boolean enableAudioTrackPlaybackParams) {
                DefaultAudioSink shared = new DefaultAudioSink.Builder(context)
                        .setAudioProcessors(new AudioProcessor[]{PlaybackService.this.spectrum, PlaybackService.this.softwareEq})
                        .setEnableFloatOutput(enableFloatOutput)
                        .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                        .build();
                // AAudio exclusive 优先；设备/ROM 拒绝时 AaudioAudioSink 会自动用 shared 回退。
                return new AaudioAudioSink(context, shared,
                        new AudioProcessor[]{PlaybackService.this.spectrum, PlaybackService.this.softwareEq});
            }
        };
        player = new ExoPlayer.Builder(this, renderers).build();
        applyPreferredDevice();
        /*
         * 音频焦点默认不接管，保持旧 p4a 行为；用户可在“音频输出”里打开。
         * 打开后由 ExoPlayer 处理焦点丢失：普通丢失暂停，短暂丢失（来电/导航提示）自动压低。
         */
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build(), audioFocusEnabled);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                lastError = error.getErrorCodeName() + " / " + describe(error);
                errorSeq++;
                Log.e(TAG, "player error " + lastError, error);
                dumpError(error);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                // 只有真正 READY 才清错误。以前 state != IDLE 就清空，
                // ExoPlayer 报错后经常短暂回到 BUFFERING，错误被抹掉，
                // 前端日志和自动回退都看不到。
                if (state == Player.STATE_READY) lastError = "";
                Log.i(TAG, "playback state -> " + state);
                refreshNotification();
            }

            @Override
            public void onAudioSessionIdChanged(int id) {
                audioSessionId = id;
                Log.i(TAG, "audio session id = " + id);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                Log.i(TAG, "isPlaying -> " + isPlaying);
                // 长后台/锁屏期间 CPU 会被 Doze 深度限频，AAudio 独占缓冲又小，
                // 解锁唤醒瞬间会 underrun 造成一卡一卡。播放期间持 PARTIAL_WAKE_LOCK，
                // 让解码线程保持可调度；暂停即释放。
                setCpuAwake(isPlaying);
                // 通知栏按钮/图标必须跟着实际播放状态走；只依赖 MediaSession
                // 的默认刷新在部分 ROM 上会滞后甚至不刷新。
                refreshNotification();
            }

            @Override
            public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                // 换曲：把谱系清零，前端切歌窗口里取到的是干净的 0，不会画出上一首的残影
                SpectrumProcessor.clear();
                Log.i(TAG, "media item transition reason=" + reason);
                refreshNotification();
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

    private void ensureWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) return;
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Audio-CPM:playback");
            wakeLock.setReferenceCounted(false);
        } catch (Throwable t) {
            Log.w(TAG, "wake lock create failed", t);
        }
    }

    private void setCpuAwake(boolean awake) {
        try {
            if (awake) {
                ensureWakeLock();
                if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(12 * 60 * 60 * 1000L);
            } else {
                if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            }
        } catch (Throwable t) {
            Log.w(TAG, "wake lock toggle failed", t);
        }
    }

    private void ensureChannel() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, getString(R.string.channel_playback), NotificationManager.IMPORTANCE_LOW);
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

    private void refreshNotification() {
        MediaSession s = session;
        if (s == null || player == null) return;
        try {
            Notification n = buildNotification(s);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, n);
        } catch (Throwable t) {
            Log.w(TAG, "refresh notification failed", t);
        }
    }

    private String[] metadataFor(String path) {
        if (path != null && path.equals(hintPath)) {
            return new String[]{hintTitle, hintArtist, hintComposer, hintAlbum};
        }
        if (path != null && path.equals(metaPath) && metaCache != null) return metaCache;
        String[] tags = new String[4];
        MediaMetadataRetriever r = null;
        try {
            r = new MediaMetadataRetriever();
            r.setDataSource(path);
            tags[0] = trimTag(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
            tags[1] = trimTag(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
            tags[2] = trimTag(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_COMPOSER));
            tags[3] = trimTag(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
        } catch (Throwable ignored) {
        } finally {
            if (r != null) { try { r.release(); } catch (Throwable ignored) {} }
        }
        metaPath = path == null ? "" : path;
        metaCache = tags;
        return tags;
    }

    private static String trimTag(String value) { return value == null ? "" : value.trim(); }

    private static String joinMeta(String... parts) {
        StringBuilder sb = new StringBuilder();
        for (String s : parts) {
            if (s == null || s.trim().isEmpty()) continue;
            if (sb.length() > 0) sb.append(" · ");
            sb.append(s.trim());
        }
        return sb.toString();
    }

    private Notification buildNotification(MediaSession session) {
        Player p = session.getPlayer();
        String title = "Audio-CPM";
        String metaLine = "Audio-CPM · HiFi";
        try {
            MediaItem mi = p.getCurrentMediaItem();
            if (mi != null && mi.localConfiguration != null && mi.localConfiguration.uri != null) {
                String path = mi.localConfiguration.uri.getPath();
                if (path != null) {
                    String[] tags = metadataFor(path);
                    title = tags[0].isEmpty() ? new File(path).getName() : tags[0];
                    String line = joinMeta(tags[1], tags[2], tags[3]);
                    if (!line.isEmpty()) metaLine = line;
                }
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
        PendingIntent floatPi = PendingIntent.getActivity(this, 14,
                new Intent(this, MainActivity.class)
                        .setAction(MainActivity.ACTION_SHOW_FLOAT)
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title)
                .setContentText(metaLine)
                .setContentIntent(content)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .addAction(android.R.drawable.ic_media_previous, getString(R.string.action_prev), prev)
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? getString(R.string.action_pause) : getString(R.string.action_play), toggle)
                .addAction(android.R.drawable.ic_media_next, getString(R.string.action_next), next)
                .addAction(android.R.drawable.ic_menu_view, getString(R.string.action_float), floatPi);
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
    private void clearStaleDiagnostics() {
        try {
            File f = new File(getFilesDir(), "player_error.txt");
            if (f.exists() && f.delete()) Log.i(TAG, "stale player_error.txt removed");
            File old = new File(getFilesDir(), "player_error.txt.old");
            if (old.exists()) old.delete();
        } catch (Throwable ignored) {
        }
        lastError = "";
    }

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
        setCpuAwake(false);
        if (session != null) session.release();
        if (player != null) player.release();
        session = null;
        player = null;
        if (instance == this) instance = null;
        super.onDestroy();
    }
}
