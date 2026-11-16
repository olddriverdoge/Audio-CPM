package com.github.olddriverdoge.audiocpm;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.MediaItem;
import androidx.media3.exoplayer.ExoPlayer;

import org.kivy.android.PythonActivity;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * AC2 原生桥（p4a）。所有方法不抛异常，统一返回 JSON 字符串。
 */
public class Ac2Bridge {

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
            PythonActivity act = PythonActivity.mActivity;
            if (act == null) {
                return "{\"status\":\"error\",\"message\":\"no activity\"}";
            }
            String authority = act.getPackageName() + ".fileprovider";
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
            act.startActivity(i);
            return "{\"status\":\"ok\"}";
        } catch (Throwable t) {
            return "{\"status\":\"error\",\"message\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    /** 本地 HiFi：交给 PlaybackService 的 ExoPlayer（通知栏/锁屏由 MediaSession 负责） */
    public static String play(String path, int startMs, int sampleRate, int bitDepth, int channels) {
        try {
            PythonActivity act = PythonActivity.mActivity;
            if (act == null) return "{\"ok\":false,\"error\":\"no activity\"}";
            if (!ensureService(act)) return "{\"ok\":false,\"error\":\"playback service unavailable\"}";
            final File f = new File(path);
            if (!f.isFile()) return "{\"ok\":false,\"error\":\"file not found\"}";
            sSampleRate = sampleRate;
            sBitDepth = bitDepth;
            sChannels = channels;
            Boolean ok = onMain(() -> {
                ExoPlayer p = PlaybackService.getPlayer();
                p.setMediaItem(MediaItem.fromUri(Uri.fromFile(f)));
                p.prepare();
                p.play();
                if (startMs > 0) p.seekTo(startMs);
                return true;
            }, false);
            return ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"play failed\"}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    public static String pause() { return simpleVoid(() -> { ExoPlayer p = PlaybackService.getPlayer(); if (p != null) p.pause(); }); }
    public static String resume() { return simpleVoid(() -> { ExoPlayer p = PlaybackService.getPlayer(); if (p != null) p.play(); }); }
    public static String stop() { return simpleVoid(() -> { ExoPlayer p = PlaybackService.getPlayer(); if (p != null) { p.stop(); p.clearMediaItems(); } }); }
    public static String seek(int ms) { return simpleVoid(() -> { ExoPlayer p = PlaybackService.getPlayer(); if (p != null) p.seekTo(ms); }); }

    private interface VoidFn { void run() throws Exception; }
    private static String simpleVoid(VoidFn fn) {
        Boolean ok = onMain(() -> { fn.run(); return true; }, false);
        return ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"playback unavailable\"}";
    }

    public static String state() {
        try {
            ExoPlayer p = PlaybackService.getPlayer();
            if (p == null) return "{\"ok\":false,\"error\":\"not playing\"}";
            long pos = onMain(() -> p.getCurrentPosition(), 0L);
            long dur = onMain(() -> p.getDuration(), 0L);
            boolean playing = onMain(() -> p.isPlaying(), false);
            return "{\"ok\":true,\"positionMs\":" + pos + ",\"durationMs\":" + dur
                    + ",\"playing\":" + playing
                    + ",\"sampleRate\":" + sSampleRate + ",\"bitDepth\":" + sBitDepth
                    + ",\"channels\":" + sChannels
                    + ",\"outputMode\":\"shared\",\"isResampling\":false,\"dacName\":\"\"}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    public static void setSpectrumEnabled(boolean enabled) { SpectrumProcessor.setEnabled(enabled); }

    public static String spectrum() {
        try {
            float[] b = SpectrumProcessor.getBands();
            StringBuilder sb = new StringBuilder(1024);
            sb.append("{\"ok\":true,\"sampleRate\":").append(SpectrumProcessor.getSampleRate()).append(",\"bands\":[");
            for (int i = 0; i < b.length; i++) {
                if (i > 0) sb.append(',');
                sb.append(Math.round(b[i] * 1000) / 1000.0);
            }
            sb.append("]}");
            return sb.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(t)) + "\"}";
        }
    }

    public static String peaks(String path, int buckets) {
        return "{\"ok\":false,\"error\":\"peaks not implemented\"}";
    }

    public static boolean hasAllFiles() { return false; }
    public static void openAllFilesSettings() { }
}
