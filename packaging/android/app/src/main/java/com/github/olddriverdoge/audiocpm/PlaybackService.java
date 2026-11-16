package com.github.olddriverdoge.audiocpm;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/** 本地 HiFi 播放服务：ExoPlayer + MediaSession（通知栏/锁屏/后台播放由 Media3 负责）。 */
public class PlaybackService extends MediaSessionService {
    private static volatile ExoPlayer player;
    private static volatile MediaSession session;

    /** 频谱旁路：挂在 AudioSink 上只读 PCM，不改音频数据 */
    private final SpectrumProcessor spectrum = new SpectrumProcessor();

    public static ExoPlayer getPlayer() { return player; }

    @Override
    public void onCreate() {
        super.onCreate();
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
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build(), true);
        player.setSkipSilenceEnabled(false);

        Intent openApp = new Intent(this, MainActivity.class);
        openApp.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this, player)
                .setSessionActivity(pi)
                .build();
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    /** 从最近任务划掉 app 时不要停服务：通知栏继续可控，后台播放不断。 */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 有意留空
    }

    @Override
    public void onDestroy() {
        if (session != null) session.release();
        if (player != null) player.release();
        session = null;
        player = null;
        super.onDestroy();
    }
}
