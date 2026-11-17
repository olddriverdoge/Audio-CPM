package com.github.olddriverdoge.audiocpm;

import android.media.audiofx.BassBoost;
import android.media.audiofx.Virtualizer;
import android.os.SystemClock;
import android.util.Log;

/**
 * 音频输出效果链：
 *  - EQ / 前级增益：软件 10 段 EQ（PCM 级，任何设备/蓝牙都生效，不依赖 audio session）
 *  - 低音增强 / 虚拟环绕：系统 AudioEffect（设备支持才生效，不支持时 UI 里置灰）
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
                    if (a <= 0) { if (bass != null) bass.setEnabled(false); return "{\"ok\":true}"; }
                    if (!sync() || bass == null) return "{\"ok\":false,\"error\":\"bass unsupported\"}";
                    bass.setStrength((short) Math.max(0, Math.min(1000, a)));
                    bass.setEnabled(true);
                    return "{\"ok\":true}";
                }
                case "virt": {
                    if (a <= 0) { if (virt != null) virt.setEnabled(false); return "{\"ok\":true}"; }
                    if (!sync() || virt == null) return "{\"ok\":false,\"error\":\"virtualizer unsupported\"}";
                    virt.setStrength((short) Math.max(0, Math.min(1000, a)));
                    virt.setEnabled(true);
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
        boolean hasBass, hasVirt;
        try { hasBass = sync() && bass != null; } catch (Throwable t) { hasBass = false; }
        try { hasVirt = sync() && virt != null; } catch (Throwable t) { hasVirt = false; }
        String base = SoftwareEqProcessor.infoJson();      // 一定 ok:true，不再出现“设备不支持均衡器”
        return base.substring(0, base.length() - 1)
                + ",\"bass\":" + (hasBass ? "true" : "false")
                + ",\"virt\":" + (hasVirt ? "true" : "false")
                + ",\"session\":" + session + "}";
    }
}
