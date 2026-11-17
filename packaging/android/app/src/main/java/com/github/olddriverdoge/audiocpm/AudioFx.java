package com.github.olddriverdoge.audiocpm;

import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.media.audiofx.Virtualizer;
import android.util.Log;

/**
 * 音频输出效果链：EQ / 低音增强 / 虚拟环绕 / 响度（前级）增益。
 * 全部挂在 ExoPlayer 的真实 audio session 上，所以 HiFi 输出和通知栏播放都吃这套效果。
 * 设备不支持某个效果时逐个降级，不影响播放。
 */
public class AudioFx {
    private static final String TAG = "Audio-CPM";
    private static Equalizer eq;
    private static BassBoost bass;
    private static Virtualizer virt;
    private static LoudnessEnhancer loud;
    private static int session = -1;
    private static boolean eqOn = false;
    private static int preampMb = 0;

    /* 预设：在 10 个标准频点上给出增益(dB)，再按设备实际频点做对数插值 */
    private static final double[] STD_F = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
    private static final double[][] PRESETS = {
        /* 0 关闭 */ {0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        /* 1 流行 */ {0, 0, 1, 3, 3, 2, 0, -1, -1, 0},
        /* 2 古典 */ {1, 2, 3, 2, 0, 0, -1, -1, 0, 1},
        /* 3 摇滚 */ {3, 3, 1, -1, -2, 0, 2, 4, 4, 2},
        /* 4 人声 */ {-2, -1, 0, 2, 4, 4, 3, 1, 0, -1},
        /* 5 自定义（不动，保留当前滑杆值） */ null
    };

    private static synchronized void release() {
        try { if (eq != null) eq.release(); } catch (Throwable ignored) {}
        try { if (bass != null) bass.release(); } catch (Throwable ignored) {}
        try { if (virt != null) virt.release(); } catch (Throwable ignored) {}
        try { if (loud != null) loud.release(); } catch (Throwable ignored) {}
        eq = null; bass = null; virt = null; loud = null; session = -1;
    }

    /** 确保效果挂在当前播放器的 audio session 上（切歌/重建播放器后 session 会变） */
    public static synchronized boolean sync() {
        int sid = PlaybackService.getAudioSessionId();
        if (sid <= 0) return false;
        if (session == sid && eq != null) return true;
        release();
        session = sid;
        try { eq = new Equalizer(0, sid); eq.setEnabled(eqOn); } catch (Throwable t) { eq = null; Log.w(TAG, "eq unavailable: " + t); }
        try { bass = new BassBoost(0, sid); } catch (Throwable t) { bass = null; }
        try { virt = new Virtualizer(0, sid); } catch (Throwable t) { virt = null; }
        try { loud = new LoudnessEnhancer(sid); loud.setTargetGain(preampMb); loud.setEnabled(preampMb > 0); } catch (Throwable t) { loud = null; }
        return eq != null || bass != null || virt != null || loud != null;
    }

    private static double presetDb(int preset, double f) {
        if (preset < 0 || preset >= PRESETS.length || PRESETS[preset] == null) return Double.NaN;
        double[] c = PRESETS[preset];
        if (f <= STD_F[0]) return c[0];
        if (f >= STD_F[STD_F.length - 1]) return c[c.length - 1];
        for (int i = 0; i < STD_F.length - 1; i++) {
            if (f <= STD_F[i + 1]) {
                double t = (Math.log(f) - Math.log(STD_F[i])) / (Math.log(STD_F[i + 1]) - Math.log(STD_F[i]));
                return c[i] + t * (c[i + 1] - c[i]);
            }
        }
        return 0;
    }

    public static synchronized String apply(String op, int a, int b) {
        if (!sync()) return "{\"ok\":false,\"error\":\"no audio session\"}";
        try {
            switch (op == null ? "" : op) {
                case "eq": {
                    eqOn = a > 0;
                    if (eq != null) eq.setEnabled(eqOn);
                    return "{\"ok\":true}";
                }
                case "band": {
                    if (eq == null) return "{\"ok\":false,\"error\":\"eq unavailable\"}";
                    short[] range = eq.getBandLevelRange();
                    int lv = Math.max(range[0], Math.min(range[1], a));
                    eq.setBandLevel((short) b, (short) lv);
                    return "{\"ok\":true}";
                }
                case "preset": {
                    if (eq == null) return "{\"ok\":false,\"error\":\"eq unavailable\"}";
                    short[] range = eq.getBandLevelRange();
                    for (short i = 0; i < eq.getNumberOfBands(); i++) {
                        double db = presetDb(a, eq.getCenterFreq(i) / 1000.0);
                        if (Double.isNaN(db)) continue;
                        int mb = (int) Math.round(db * 100);
                        int lv = Math.max(range[0], Math.min(range[1], mb));
                        eq.setBandLevel(i, (short) lv);
                    }
                    return "{\"ok\":true}";
                }
                case "bass": {
                    if (bass == null) return "{\"ok\":false,\"error\":\"bass unavailable\"}";
                    if (a <= 0) { bass.setEnabled(false); return "{\"ok\":true}"; }
                    bass.setStrength((short) Math.max(0, Math.min(1000, a)));
                    bass.setEnabled(true);
                    return "{\"ok\":true}";
                }
                case "virt": {
                    if (virt == null) return "{\"ok\":false,\"error\":\"virtualizer unavailable\"}";
                    if (a <= 0) { virt.setEnabled(false); return "{\"ok\":true}"; }
                    virt.setStrength((short) Math.max(0, Math.min(1000, a)));
                    virt.setEnabled(true);
                    return "{\"ok\":true}";
                }
                case "loud": {
                    if (loud == null) return "{\"ok\":false,\"error\":\"loudness unavailable\"}";
                    preampMb = Math.max(0, Math.min(2000, a));   // 0~+20dB
                    loud.setTargetGain(preampMb);
                    loud.setEnabled(preampMb > 0);
                    return "{\"ok\":true}";
                }
                case "reset": {
                    release();
                    return "{\"ok\":true}";
                }
                default:
                    return "{\"ok\":false,\"error\":\"unknown op\"}";
            }
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + AudioCpmBridge.escPublic(String.valueOf(t)) + "\"}";
        }
    }

    public static synchronized String info() {
        if (!sync() || eq == null && bass == null && virt == null && loud == null) {
            return "{\"ok\":false,\"session\":" + session + "}";
        }
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"session\":").append(session).append(",\"eq\":").append(eq != null);
        if (eq != null) {
            short[] range = eq.getBandLevelRange();
            sb.append(",\"bands\":").append(eq.getNumberOfBands());
            sb.append(",\"minLevel\":").append(range[0]).append(",\"maxLevel\":").append(range[1]);
            sb.append(",\"freqs\":[");
            for (short i = 0; i < eq.getNumberOfBands(); i++) {
                if (i > 0) sb.append(',');
                sb.append((int) eq.getCenterFreq(i));
            }
            sb.append("],\"levels\":[");
            for (short i = 0; i < eq.getNumberOfBands(); i++) {
                if (i > 0) sb.append(',');
                sb.append((int) eq.getBandLevel(i));
            }
            sb.append("],\"eqOn\":").append(eqOn);
        }
        sb.append(",\"bass\":").append(bass != null ? 1 : 0);
        sb.append(",\"virt\":").append(virt != null ? 1 : 0);
        sb.append(",\"loud\":").append(loud != null ? 1 : 0);
        sb.append(",\"preamp\":").append(preampMb);
        sb.append('}');
        return sb.toString();
    }
}
