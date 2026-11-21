package com.github.olddriverdoge.audiocpm;

import android.content.ComponentName;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Audio-CPM 原生桥（Gradle/Chaquopy 壳）。所有方法不抛异常，统一返回 JSON 字符串。
 * 由 Python 侧的 backend/native_bridge.py 通过 Chaquopy 的 jclass 调用。
 */
public class AudioCpmBridge {
    private static final String TAG = "Audio-CPM";

    private static volatile int sSampleRate = 0;
    private static volatile int sBitDepth = 0;
    private static volatile int sChannels = 0;

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".flac")) return "audio/flac";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".aif") || p.endsWith(".aiff")) return "audio/aiff";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".m4a") || p.endsWith(".mp4") || p.endsWith(".aac")) return "audio/mp4";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".opus")) return "audio/opus";
        if (p.endsWith(".ape")) return "audio/x-ape";
        if (p.endsWith(".wv")) return "audio/x-wavpack";
        if (p.endsWith(".dsf") || p.endsWith(".dff")) return "audio/x-dsf";
        return "audio/*";
    }

    /** 给 AudioFx 用的转义（保持错误信息可回传又不破坏 JSON） */
    public static String escPublic(String s) { return esc(s); }

    /** 音频效果：op=eq/band/preset/bass/virt/loud/reset */
    public static String fx(final String op, final int a, final int b) {
        if ("speed".equals(op)) {          // a = 速度*100，例如 150 = 1.5x
            final float sp = Math.max(0.5f, Math.min(2.0f, a / 100f));
            return simpleVoid(() -> {
                ExoPlayer p = PlaybackService.getPlayer();
                if (p == null) return;
                p.setPlaybackParameters(new PlaybackParameters(sp));
            });
        }
        return AudioFx.apply(op, a, b);
    }

    /** 当前音源轨道格式（ExoPlayer 已识别到的原始格式，不代表 AudioSink 最终输出格式）。 */
    private static String sourceFormat(ExoPlayer p) {
        try {
            Tracks tracks = p.getCurrentTracks();
            for (Tracks.Group group : tracks.getGroups()) {
                if (group.getType() != C.TRACK_TYPE_AUDIO || !group.isSelected()) continue;
                Format f = group.getTrackFormat(0);
                return "{\"sampleRate\":" + Math.max(0, f.sampleRate)
                        + ",\"channels\":" + Math.max(0, f.channelCount)
                        + ",\"encoding\":" + Math.max(0, f.pcmEncoding) + "}";
            }
        } catch (Throwable ignored) {
        }
        return "{\"sampleRate\":0,\"channels\":0,\"encoding\":0}";
    }

    private static String deviceTypeName(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "speaker";
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "earpiece";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "wired_headset";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "wired_headphones";
            case AudioDeviceInfo.TYPE_LINE_ANALOG: return "line_analog";
            case AudioDeviceInfo.TYPE_LINE_DIGITAL: return "line_digital";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "bluetooth_a2dp";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "bluetooth_sco";
            case AudioDeviceInfo.TYPE_USB_DEVICE: return "usb_device";
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "usb_headset";
            case AudioDeviceInfo.TYPE_HDMI: return "hdmi";
            case AudioDeviceInfo.TYPE_HDMI_ARC: return "hdmi_arc";
            case AudioDeviceInfo.TYPE_HDMI_EARC: return "hdmi_earc";
            case AudioDeviceInfo.TYPE_BLE_HEADSET: return "ble_headset";
            case AudioDeviceInfo.TYPE_BLE_SPEAKER: return "ble_speaker";
            case AudioDeviceInfo.TYPE_BLE_BROADCAST: return "ble_broadcast";
            default: return "other";
        }
    }

    /** 设备稳定 key：同型号重连后 id 可能变化，type + 产品名更适合记住“这台设备”的延迟。 */
    private static String deviceKey(AudioDeviceInfo d) {
        String name = d.getProductName() == null ? "" : d.getProductName().toString().trim();
        return deviceTypeName(d.getType()) + "|" + name;
    }

    /**
     * 当前实际输出设备。优先用 Android 13+ 的预期路由 API；旧系统按系统路由优先级
     * 从已连接 sink 里推断（USB/有线 > 蓝牙 > 扬声器），至少蓝牙不会再被显示成“系统默认”。
     */
    private static int activeOutputDeviceId(AudioManager am, AudioDeviceInfo[] devices) {
        int selected = PlaybackService.getPreferredDeviceId();
        if (selected > 0) {
            for (AudioDeviceInfo d : devices) {
                if (d.getId() == selected && d.isSink()) return selected;
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build();
                List<AudioDeviceInfo> routed = am.getAudioDevicesForAttributes(attrs);
                for (AudioDeviceInfo d : routed) {
                    if (d != null && d.isSink()) return d.getId();
                }
            } catch (Throwable ignored) {}
        }
        int bestId = 0, bestScore = -1;
        for (AudioDeviceInfo d : devices) {
            if (!d.isSink()) continue;
            int score = outputPriority(d.getType());
            if (score > bestScore) { bestScore = score; bestId = d.getId(); }
        }
        return bestId;
    }

    private static int outputPriority(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_DEVICE: return 90;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return 80;
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER: return 70;
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return 60;
            case AudioDeviceInfo.TYPE_HDMI_EARC:
            case AudioDeviceInfo.TYPE_HDMI_ARC:
            case AudioDeviceInfo.TYPE_HDMI: return 50;
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return 10;
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return 5;
            default: return 0;
        }
    }

    /** 可用输出设备：USB DAC / 有线 / 蓝牙 / 扬声器。只返回 sink 设备。 */
    public static String audioDevices() {
        try {
            AudioManager am = (AudioManager) AudioCpmApp.get().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return "[]";
            AudioDeviceInfo[] devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            int activeId = activeOutputDeviceId(am, devices);
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (AudioDeviceInfo d : devices) {
                if (!d.isSink()) continue;
                if (!first) sb.append(',');
                first = false;
                String key = deviceKey(d);
                sb.append("{\"id\":").append(d.getId())
                        .append(",\"type\":\"").append(deviceTypeName(d.getType()))
                        .append("\",\"name\":\"").append(esc(d.getProductName() == null ? "" : d.getProductName().toString()))
                        .append("\",\"key\":\"").append(esc(key))
                        .append("\",\"sampleRates\":[");
                int[] rates = d.getSampleRates();
                for (int i = 0; i < rates.length; i++) { if (i > 0) sb.append(','); sb.append(rates[i]); }
                sb.append("],\"channels\":[");
                int[] ch = d.getChannelCounts();
                for (int i = 0; i < ch.length; i++) { if (i > 0) sb.append(','); sb.append(ch[i]); }
                sb.append("],\"preferred\":").append(d.getId() == PlaybackService.getPreferredDeviceId())
                        .append(",\"active\":").append(d.getId() == activeId).append('}');
            }
            sb.append(']');
            return sb.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    /** 选择输出设备；id=0 表示系统默认。 */
    public static String setAudioDevice(final int id) {
        try {
            Context ctx = AudioCpmApp.get();
            if (ctx != null) ensureService(ctx);
            boolean ok = PlaybackService.setPreferredDevice(id);
            return "{\"ok\":" + ok + ",\"id\":" + Math.max(0, id) + "}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    /** 输出信息：设备原生采样率/缓冲 + ExoPlayer 实际 PCM 格式 + 音源格式 + 效果状态 */
    public static String audioInfo() {
        try {
            StringBuilder sb = new StringBuilder("{\"ok\":true");
            try {
                android.media.AudioManager am = (android.media.AudioManager)
                        AudioCpmApp.get().getSystemService(Context.AUDIO_SERVICE);
                String sr = am == null ? null : am.getProperty(android.media.AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE);
                String fp = am == null ? null : am.getProperty(android.media.AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER);
                int rate = sr == null ? 0 : Integer.parseInt(sr);
                int frames = fp == null ? 0 : Integer.parseInt(fp);
                // 部分 ROM 不提供 PROPERTY_OUTPUT_SAMPLE_RATE（返回空串），
                // 用 AudioTrack 的原生输出采样率做兜底，避免面板一直显示“未知”。
                if (rate <= 0) {
                    try { rate = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC); } catch (Throwable ignored) {}
                }
                // 有些 ROM/蓝牙路由下上面两个 API 都返回 0；如果 AAudio 已经打开，
                // 直接用实际流采样率兜底，至少不会在面板上显示“未知”。
                if (rate <= 0 && AaudioAudioSink.isActive() && AaudioAudioSink.getSampleRate() > 0) {
                    rate = AaudioAudioSink.getSampleRate();
                }
                if (frames <= 0 && rate > 0) {
                    try {
                        int minBytes = AudioTrack.getMinBufferSize(rate, android.media.AudioFormat.CHANNEL_OUT_STEREO,
                                android.media.AudioFormat.ENCODING_PCM_16BIT);
                        if (minBytes > 0) frames = minBytes / 4; // 16bit stereo = 4 bytes/frame
                    } catch (Throwable ignored) {}
                }
                sb.append(",\"deviceSampleRate\":").append(rate);
                sb.append(",\"framesPerBuffer\":").append(frames);
                sb.append(",\"latencyMs\":").append(rate > 0 ? (int) Math.round(frames * 1000.0 / rate) : 0);
            } catch (Throwable ignored) {}
            try { sb.append(",\"format\":").append(SpectrumProcessor.describe()); }
            catch (Throwable t) { sb.append(",\"format\":{\"sampleRate\":0,\"channels\":0,\"encoding\":0,\"enabled\":false}"); }
            try { sb.append(",\"fx\":").append(AudioFx.info()); }
            catch (Throwable t) { sb.append(",\"fx\":{\"ok\":false,\"error\":\"").append(esc(String.valueOf(t))).append("\"}"); }
            try {
                ExoPlayer p = PlaybackService.getPlayer();
                if (p != null) {
                    sb.append(",\"preferredDeviceId\":").append(PlaybackService.getPreferredDeviceId());
            sb.append(",\"player\":true");
                    sb.append(",\"playing\":").append(p.isPlaying());
                    sb.append(",\"playbackState\":").append(p.getPlaybackState());
                    // audioInfo 是 1.5s 一次的面板数据，可以承受在主线程读一次
                    // getCurrentTracks；state 的 250ms 轮询才使用固定空值。
                    String sf = onMain(() -> sourceFormat(p), "{\"sampleRate\":0,\"channels\":0,\"encoding\":0}");
                    sb.append(",\"sourceFormat\":").append(sf);
                    float sp = p.getPlaybackParameters().speed;
                    if (Float.isNaN(sp) || Float.isInfinite(sp)) sp = 1.0f;
                    sb.append(",\"speed\":").append(sp);
                } else {
                    sb.append(",\"player\":false,\"playing\":false,\"playbackState\":-1");
                    sb.append(",\"sourceFormat\":{\"sampleRate\":0,\"channels\":0,\"encoding\":0}");
                }
                sb.append(",\"aaudio\":").append(AaudioAudioSink.describe());
            } catch (Throwable t) {
                sb.append(",\"player\":false,\"playing\":false,\"playbackState\":-1");
                sb.append(",\"sourceFormat\":{\"sampleRate\":0,\"channels\":0,\"encoding\":0}");
            }
            sb.append('}');
            return sb.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    private interface Fn<T> { T run() throws Exception; }

    @SuppressWarnings("unchecked")
    private static <T> T onMain(Fn<T> fn, T fallback) {
        final Object[] out = new Object[1];
        final CountDownLatch latch = new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                out[0] = fn.run();
            } catch (Throwable t) {
                out[0] = t;
            } finally {
                latch.countDown();
            }
        });
        try {
            latch.await(3, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
        Object v = out[0];
        if (v == null || v instanceof Throwable) return fallback;
        return (T) v;
    }

    private static ExoPlayer waitPlayer() {
        for (int i = 0; i < 60; i++) {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p != null) return p;
            try { Thread.sleep(50L); } catch (InterruptedException ignored) {}
        }
        return null;
    }

    private static boolean ensureService(Context ctx) {
        try {
            ctx.startService(new Intent(ctx, PlaybackService.class));
            return waitPlayer() != null;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 外部播放器：content:// + 自定义 provider */
    public static String open(String path, String pkg, String activity) {
        try {
            if (path == null || path.isEmpty()) {
                return "{\"status\":\"error\",\"message\":\"empty path\"}";
            }
            File f = new File(path);
            if (!f.isFile()) {
                return "{\"status\":\"error\",\"message\":\"file not found\"}";
            }
            Context ctx = AudioCpmApp.get();
            if (ctx == null) {
                return "{\"status\":\"error\",\"message\":\"no context\"}";
            }
            String authority = ctx.getPackageName() + ".fileprovider";
            Uri uri = Uri.parse("content://" + authority + Uri.encode(path, "/"));
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, mimeOf(path));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            if (activity != null && activity.contains("/")) {
                String[] parts = activity.split("/", 2);
                i.setComponent(new ComponentName(parts[0], parts[1]));
            } else if (pkg != null && !pkg.isEmpty()) {
                i.setPackage(pkg);
            }
            ctx.startActivity(i);
            return "{\"status\":\"ok\"}";
        } catch (Throwable t) {
            return "{\"status\":\"error\",\"message\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    /** 本地 HiFi：交给 PlaybackService 的 ExoPlayer（通知栏/锁屏由 MediaSession 负责） */
    public static String play(String path, int startMs, int sampleRate, int bitDepth, int channels) {
        try {
            Context ctx = AudioCpmApp.get();
            if (ctx == null) { Log.w(TAG, "play: no context"); return "{\"ok\":false,\"error\":\"no context\"}"; }
            if (!ensureService(ctx)) {
                Log.w(TAG, "play: service unavailable");
                return "{\"ok\":false,\"error\":\"playback service unavailable\"}";
            }
            final File f = new File(path);
            if (!f.isFile()) { Log.w(TAG, "play: not a file " + path); return "{\"ok\":false,\"error\":\"file not found\"}"; }
            sSampleRate = sampleRate;
            sBitDepth = bitDepth;
            sChannels = channels;
            Boolean ok = onMain(() -> {
                ExoPlayer p = PlaybackService.getPlayer();
                p.setMediaItem(MediaItem.fromUri(Uri.fromFile(f)));
                // 先 seek 再 prepare：对已有 Sink 直接 seek 会触发 flush，
                // 部分 AAudio 设备会阻塞；新起播场景在 prepare 前设置起点最稳。
                if (startMs > 0) p.seekTo(startMs);
                p.prepare();
                p.play();
                return true;
            }, false);
            Log.i(TAG, "play " + path + " startMs=" + startMs + " -> " + ok);
            return ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"play failed\"}";
        } catch (Throwable t) {
            Log.w(TAG, "play failed", t);
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    /** 前端 probe 的元数据推给原生通知栏；FLAC composer 不依赖 ROM 的 retriever 支持。 */
    public static String setNowPlayingMeta(String path, String title, String artist, String composer, String album) {
        try {
            PlaybackService.setNowPlayingMeta(path, title, artist, composer, album);
            return "{\"ok\":true}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    public static String pause() { return simpleVoid(() -> { ExoPlayer p = PlaybackService.getPlayer(); if (p != null) p.pause(); }); }
    public static String resume() { return simpleVoid(() -> { ExoPlayer p = PlaybackService.getPlayer(); if (p != null) p.play(); }); }
    public static String stop() { return simpleVoid(() -> { ExoPlayer p = PlaybackService.getPlayer(); if (p != null) { p.stop(); p.clearMediaItems(); } }); }
    public static String seek(int ms) {
        // 清零放到主线程外（纯赋值），主线程 runnable 只留 seekTo，尽量缩短 UI 线程占用
        try { SpectrumProcessor.clear(); } catch (Throwable ignored) {}
        return simpleVoid(() -> {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p != null) p.seekTo(ms);
        });
    }

    /** 音量（0~1）：网页播放条与播放管理面板共用；HiFi 走 ExoPlayer.setVolume */
    public static String setVolume(final double v) {
        final float f = (float) Math.max(0, Math.min(1, v));
        return simpleVoid(() -> {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p != null) p.setVolume(f);
        });
    }

    /** 播放模式：repeat 0=off 1=all 2=one；shuffle 随机。对应 ExoPlayer 原生，通知栏/后台同样生效 */
    public static String setMode(final int repeat, final boolean shuffle) {
        final int mode = (repeat == 2) ? Player.REPEAT_MODE_ONE
                : (repeat == 1 ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF);
        return simpleVoid(() -> {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p == null) return;
            p.setRepeatMode(mode);
            p.setShuffleModeEnabled(shuffle);
        });
    }

    /** 上一首 / 下一首（走队列，兼容随机顺序） */
    public static String skip(final int dir) {
        return simpleVoid(() -> {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p == null) return;
            if (dir > 0) p.seekToNextMediaItem(); else p.seekToPreviousMediaItem();
        });
    }

    private interface VoidFn { void run() throws Exception; }
    private static String simpleVoid(VoidFn fn) {
        Boolean ok = onMain(() -> { fn.run(); return true; }, false);
        return ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"playback unavailable\"}";
    }

    public static String queueList() {
        try {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p == null) return "{\"ok\":false,\"error\":\"not playing\"}";
            Object[] snap = onMain(() -> {
                int n = p.getMediaItemCount();
                String[] paths = new String[n];
                for (int i = 0; i < n; i++) {
                    try {
                        MediaItem mi = p.getMediaItemAt(i);
                        paths[i] = (mi != null && mi.localConfiguration != null
                                && mi.localConfiguration.uri != null)
                                ? String.valueOf(mi.localConfiguration.uri.getPath()) : "";
                    } catch (Throwable ignored) { paths[i] = ""; }
                }
                return new Object[]{p.getCurrentMediaItemIndex(), paths};
            }, null);
            if (snap == null) return "{\"ok\":false,\"error\":\"queue timeout\"}";
            int idx = (Integer) snap[0];
            String[] paths = (String[]) snap[1];
            StringBuilder sb = new StringBuilder(256 + paths.length * 64);
            sb.append("{\"ok\":true,\"index\":").append(idx).append(",\"paths\":[");
            for (int i = 0; i < paths.length; i++) {
                if (i > 0) sb.append(',');
                sb.append('"').append(esc(paths[i])).append('"');
            }
            sb.append("]}");
            return sb.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    public static String queuePlay(int index) {
        return simpleVoid(() -> {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p == null) throw new IllegalStateException("not playing");
            p.seekToMediaItem(Math.max(0, index));
            p.play();
        });
    }

    public static String state() {
        try {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p == null) return "{\"ok\":false,\"error\":\"not playing\"}";
            // 一次 onMain 取回全部字段：以前每个字段各 post 一次（7 次 Handler.post + 7 次锁等待），
            // 250ms 轮询叠加 90Hz 频谱桥调用时，主线程消息队列会被这些碎片任务塞满 —— seek 卡顿的主因之一。
            final Object[] snap = onMain(() -> {
                String path = "";
                try {
                    MediaItem mi = p.getCurrentMediaItem();
                    if (mi != null && mi.localConfiguration != null && mi.localConfiguration.uri != null) {
                        path = mi.localConfiguration.uri.getPath();
                    }
                } catch (Throwable ignored) {
                }
                return new Object[]{
                        p.getCurrentPosition(), p.getDuration(), p.isPlaying(),
                        p.getCurrentMediaItemIndex(), p.getPlaybackState(), p.getVolume(), path,
                        "{\"sampleRate\":0,\"channels\":0,\"encoding\":0}"
                };
            }, null);
            if (snap == null || snap.length < 8) return "{\"ok\":false,\"error\":\"state timeout\"}";
            long pos = ((Long) snap[0]);
            long rawDur = ((Long) snap[1]);
            long dur = (rawDur <= 0 || rawDur == androidx.media3.common.C.TIME_UNSET) ? 0 : rawDur;
            boolean playing = ((Boolean) snap[2]);
            int idx = ((Integer) snap[3]);
            int pbState = ((Integer) snap[4]);
            float vol = ((Float) snap[5]);
            String cur = ((String) snap[6]);
            String sourceFmt = ((String) snap[7]);
            boolean notif = true;
            try {
                Context ctx0 = AudioCpmApp.get();
                android.app.NotificationManager nm = ctx0 == null ? null
                        : (android.app.NotificationManager) ctx0.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) notif = nm.areNotificationsEnabled();
            } catch (Throwable ignored) {
            }
            boolean aaActive = AaudioAudioSink.isActive();
            boolean aaExclusive = AaudioAudioSink.isExclusive();
            int aaRate = AaudioAudioSink.getSampleRate();
            int aaChannels = AaudioAudioSink.getChannels();
            int aaEncoding = AaudioAudioSink.getEncoding();
            String mode = aaActive ? (aaExclusive ? "aaudio_exclusive" : "aaudio_shared") : "shared";
            int outRate = aaActive && aaRate > 0 ? aaRate : sSampleRate;
            int outChannels = aaActive && aaChannels > 0 ? aaChannels : sChannels;
            int outBits = aaActive
                    ? (aaEncoding == 4 ? 32 : (aaEncoding == 21 ? 24 : 16))
                    : sBitDepth;
            return "{\"ok\":true,\"positionMs\":" + pos + ",\"durationMs\":" + dur
                    + ",\"playing\":" + playing + ",\"index\":" + idx
                    + ",\"path\":\"" + esc(cur) + "\""
                    + ",\"playbackState\":" + pbState + ",\"volume\":" + vol
                    + ",\"error\":\"" + esc(PlaybackService.getLastError()) + "\""
                    + ",\"errorSeq\":" + PlaybackService.getErrorSeq()
                    + ",\"notifEnabled\":" + notif
                    + ",\"sampleRate\":" + outRate + ",\"bitDepth\":" + outBits
                    + ",\"channels\":" + outChannels
                    + ",\"outputMode\":\"" + mode + "\",\"isResampling\":false,\"dacName\":\"\""
                    + ",\"sourceFormat\":" + sourceFmt
                    + ",\"aaudio\":" + AaudioAudioSink.describe() + "}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    /** 原生队列：交给 ExoPlayer 的 playlist，切后台也能按顺序自动下一首。 */
    public static String setQueue(String[] paths, int startIndex, int startMs) {
        try {
            Context ctx = AudioCpmApp.get();
            if (ctx == null) return "{\"ok\":false,\"error\":\"no context\"}";
            if (!ensureService(ctx)) return "{\"ok\":false,\"error\":\"playback service unavailable\"}";
            final List<MediaItem> items = new ArrayList<>();
            for (String path : paths) {
                if (path == null) continue;
                File f = new File(path);
                if (f.isFile()) items.add(MediaItem.fromUri(Uri.fromFile(f)));
            }
            if (items.isEmpty()) return "{\"ok\":false,\"error\":\"queue empty\"}";
            final int idx = Math.max(0, Math.min(items.size() - 1, startIndex));
            Boolean ok = onMain(() -> {
                ExoPlayer p = PlaybackService.getPlayer();
                p.setMediaItems(items, idx, Math.max(0, startMs));
                p.prepare();
                p.play();
                return true;
            }, false);
            Log.i(TAG, "queue size=" + items.size() + " index=" + idx + " -> " + ok);
            return ok ? "{\"ok\":true,\"size\":" + items.size() + ",\"index\":" + idx + "}"
                    : "{\"ok\":false,\"error\":\"queue failed\"}";
        } catch (Throwable t) {
            Log.w(TAG, "queue failed", t);
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    public static void setSpectrumEnabled(boolean enabled) { SpectrumProcessor.setEnabled(enabled); }

    /**
     * 频谱显示参数：{"floorDb":-80,"release":0.12,"bars":48}
     * 只做极简解析（三个固定键），避免引入 JSON 依赖。
     */
    public static String setParams(String json) {
        try {
            if (json != null) {
                float floor = -80f, rel = 0.12f;
                int bars = SpectrumProcessor.getBarCount();
                int spec = 0;
                String f = num(json, "floorDb");
                if (f != null) floor = Float.parseFloat(f);
                String r = num(json, "release");
                if (r != null) rel = Float.parseFloat(r);
                String b = num(json, "bars");
                if (b != null) bars = (int) Float.parseFloat(b);
                String sc = num(json, "spec");
                if (sc != null) spec = (int) Float.parseFloat(sc);
                SpectrumProcessor.setParams(floor, rel, bars, spec);
            }
            return "{\"ok\":true}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    private static String num(String json, String key) {
        String k = "\"" + key + "\":";
        int i = json.indexOf(k);
        if (i < 0) return null;
        int j = i + k.length();
        int e = j;
        while (e < json.length()) {
            char c = json.charAt(e);
            if ((c >= '0' && c <= '9') || c == '-' || c == '.' || c == '+' || c == 'e' || c == 'E') e++;
            else break;
        }
        return e > j ? json.substring(j, e) : null;
    }

    /* 90Hz 取数下，帧序号没变就别重复拼 4KB JSON（这是切歌瞬间主线程被 JS 桥拖住的主因之一） */
    private static volatile String cachedSpectrum = null;
    private static volatile int cachedSpectrumSeq = -1;

    public static String spectrum() {
        int sq = SpectrumProcessor.getSeq();
        String c = cachedSpectrum;
        if (c != null && sq == cachedSpectrumSeq) return c;
        try {
            float[] b = SpectrumProcessor.getBands();
            float[] lv = SpectrumProcessor.getLevels();
            float[] bs = SpectrumProcessor.getBars();
            float[] lb = SpectrumProcessor.getLinBars();
            float[] sp = SpectrumProcessor.getSpec();
            StringBuilder sb = new StringBuilder(2048);
            sb.append("{\"ok\":true,\"seq\":").append(sq)
              .append(",\"service\":").append(PlaybackService.getPlayer() != null)
              .append(",\"format\":").append(SpectrumProcessor.describe())
              .append(",\"sampleRate\":").append(SpectrumProcessor.getSampleRate()).append(",\"bands\":[");
            appendFloats(sb, b);
            sb.append("],\"levels\":[");
            appendFloats(sb, lv);
            sb.append("],\"bars\":[");
            appendFloats(sb, bs);
            sb.append("],\"linbars\":[");
            appendFloats(sb, lb);
            sb.append("],\"spec\":[");
            appendFloats(sb, sp);
            sb.append("]}");
            cachedSpectrum = sb.toString();
            cachedSpectrumSeq = sq;
            return cachedSpectrum;
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    private static void appendFloats(StringBuilder sb, float[] arr) {
        for (int i = 0; i < arr.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(Math.round(arr[i] * 1000) / 1000.0);
        }
    }

    /** 波形峰值由 Python 侧 ffmpeg 计算（native 解码兜底在 AudioCpmWave 中，未接这条桥）。 */
    public static String peaks(String path, int buckets) {
        return "{\"ok\":false,\"error\":\"peaks not implemented\"}";
    }

    public static boolean hasAllFiles() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                return Environment.isExternalStorageManager();
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    public static void openAllFilesSettings() {
        try {
            Context ctx = AudioCpmApp.get();
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            i.setData(Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Throwable ignored) {
        }
    }
}
