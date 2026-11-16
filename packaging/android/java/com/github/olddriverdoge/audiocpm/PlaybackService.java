package com.github.olddriverdoge.audiocpm;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/** 本地 HiFi 播放服务：ExoPlayer + MediaSession（通知栏/锁屏由 Media3 负责）。 */
public class PlaybackService extends MediaSessionService {
    private static volatile ExoPlayer player;
    private static volatile MediaSession session;

    public static ExoPlayer getPlayer() { return player; }

    @Override
    public void onCreate() {
        super.onCreate();
        SpectrumProcessor sp = new SpectrumProcessor();
        DefaultAudioSink sink = new DefaultAudioSink.Builder(this)
                .setAudioProcessors(new AudioProcessor[]{sp})
                .build();
        player = new ExoPlayer.Builder(this).setAudioSink(sink).build();
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build(), true);
        session = new MediaSession.Builder(this, player).build();
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
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
