package com.github.olddriverdoge.audiocpm;

import android.media.audiofx.BassBoost;
import android.media.audiofx.Virtualizer;
import android.os.SystemClock;
import android.util.Log;

/**
 * 音频输出效果链：
 *  - EQ / 前级增益：软件 10 段 EQ（PCM 级，任何设备/蓝牙都生效，不依赖 audio session）
 *  - 低音增强 / 虚拟环绕：同样走 SoftwareEqProcessor（PCM 级软件处理，任何设备都可用）
 */
public class AudioFx {
    private static final String TAG = "Audio-CPM";
    private static BassBoost bass;
    private static Virtualizer virt;
    private static int session = -1;
    private static long lastTry = 0;

    private static synchronized void release() {
        try { if (bass != null) bass.release(); } catch (Throwable ignored) {}
        try { if (virt != null) virt.release(); } catch (Throwable ignored) {}
        bass = null; virt = null; session = -1;
    }

    private static synchronized boolean sync() {
        int sid = PlaybackService.getAudioSessionId();
        if (sid <= 0) return false;
        if (session == sid) {
            if (bass != null || virt != null) return true;
            // 设备偶发拒绝创建 AudioEffect：2 秒内不反复重试，过后自动再试，避免“用着用着就不可用”
            if (SystemClock.uptimeMillis() - lastTry < 2000) return false;
        }
        release();
        lastTry = SystemClock.uptimeMillis();
        session = sid;
        try { bass = new BassBoost(0, sid); } catch (Throwable t) { bass = null; }
        try { virt = new Virtualizer(0, sid); } catch (Throwable t) { virt = null; }
        return bass != null || virt != null;
    }

    public static String apply(String op, int a, int b) {
        try {
            switch (op == null ? "" : op) {
                case "eq":
                    SoftwareEqProcessor.setEnabled(a > 0);
                    return "{\"ok\":true}";
                case "band":
                    SoftwareEqProcessor.setBand(b, a);
                    return "{\"ok\":true}";
                case "preset":
                    SoftwareEqProcessor.setPreset(a);
                    return "{\"ok\":true}";
                case "preamp":
                case "loud":
                    SoftwareEqProcessor.setPreamp(a);
                    return "{\"ok\":true}";
                case "bass": {
                    SoftwareEqProcessor.setBass(a);
                    return "{\"ok\":true}";
                }
                case "virt": {
                    SoftwareEqProcessor.setVirt(a);
                    return "{\"ok\":true}";
                }
                case "reset":
                    SoftwareEqProcessor.resetAll();
                    release();
                    return "{\"ok\":true}";
                default:
                    return "{\"ok\":false,\"error\":\"unknown op\"}";
            }
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + AudioCpmBridge.escPublic(String.valueOf(t)) + "\"}";
        }
    }

    public static String info() {
        // 低音/环绕也已改为软件处理（SoftwareEqProcessor），任何设备都可用
        String base = SoftwareEqProcessor.infoJson();
        return base.substring(0, base.length() - 1)
                + ",\"bass\":true,\"virt\":true"
                + ",\"session\":" + session + "}";
    }
}
