package com.github.olddriverdoge.audiocpm;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor.AudioFormat;
import androidx.media3.common.audio.BaseAudioProcessor;


import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;

/**
 * 软件 10 段 EQ + 前级增益：直接对 PCM 做双二阶（RBJ peaking）滤波。
 *
 * 为什么不用系统 Equalizer：很多 ROM / 蓝牙链路会直接忽略 AudioEffect，表现为“设备不支持均衡器”
 * 或调了没反应。这里走 ExoPlayer 的 AudioProcessor 链，所有输出方式（扬声器/蓝牙/USB DAC）都生效，
 * 也不需要 audio session，因此不会出现“重启后恢复正常、用着用着不可用”。
 */
public class SoftwareEqProcessor extends BaseAudioProcessor {
    public static final int BANDS = 10;
    private static final double[] FREQ = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
    private static final double Q = 1.0;
    private static final double[][] PRESETS = {
        {0, 0, 0, 0, 0, 0, 0, 0, 0, 0},              /* 关闭 */
        {0, 0, 1, 3, 3, 2, 0, -1, -1, 0},            /* 流行 */
        {1, 2, 3, 2, 0, 0, -1, -1, 0, 1},            /* 古典 */
        {3, 3, 1, -1, -2, 0, 2, 4, 4, 2},            /* 摇滚 */
        {-2, -1, 0, 2, 4, 4, 3, 1, 0, -1},           /* 人声 */
        null                                          /* 自定义 */
    };

    private static volatile boolean enabled = false;
    private static volatile int preampMb = 0;                 // 百分之一 dB，可正可负
    private static final int[] gainsMb = new int[BANDS];
    private static volatile int bassAmount = 0;               // 0..1000（软件低音增强）
    private static volatile int virtAmount = 0;               // 0..1000（软件立体声扩展）
    private static final int MAX_BAND_MB = 2000;              // 单个频段最多 +20.0 dB，防止破音
    private static volatile long rev = 0;

    private int channels = 2, sampleRate = 48000, encoding = C.ENCODING_PCM_16BIT;
    private double[] b0 = new double[BANDS], b1 = new double[BANDS], b2 = new double[BANDS];
    private double[] a1 = new double[BANDS], a2 = new double[BANDS];
    private float[][] z1, z2;
    private long appliedRev = -1;
    private boolean bypass = false;

    /* ---------------- 外部调参 ---------------- */
    public static void setEnabled(boolean on) { enabled = on; rev++; }
    public static boolean isEnabled() { return enabled; }

    public static void setBand(int band, int mb) {
        if (band < 0 || band >= BANDS) return;
        gainsMb[band] = Math.max(-MAX_BAND_MB, Math.min(MAX_BAND_MB, mb));
        rev++;
    }

    public static void setBass(int amount) {
        bassAmount = Math.max(0, Math.min(1000, amount));
        rev++;
    }

    public static void setVirt(int amount) {
        virtAmount = Math.max(0, Math.min(1000, amount));
        rev++;
    }

    public static void setPreamp(int mb) {
        preampMb = Math.max(-24000, Math.min(24000, mb));
        rev++;
    }

    public static int getPreamp() { return preampMb; }

    /** preset 0..5（5=保持当前自定义值） */
    public static void setPreset(int preset) {
        if (preset < 0 || preset >= PRESETS.length || PRESETS[preset] == null) return;
        for (int i = 0; i < BANDS; i++) gainsMb[i] = (int) Math.round(PRESETS[preset][i] * 100);
        rev++;
    }

    public static void resetAll() {
        enabled = false;
        preampMb = 0;
        bassAmount = 0;
        virtAmount = 0;
        for (int i = 0; i < BANDS; i++) gainsMb[i] = 0;
        rev++;
    }

    public static String infoJson() {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"mode\":\"software\",\"bands\":")
                .append(BANDS).append(",\"minLevel\":-2000,\"maxLevel\":2000,\"eqOn\":").append(enabled)
                .append(",\"preamp\":").append(preampMb).append(",\"freqs\":[");
        for (int i = 0; i < BANDS; i++) { if (i > 0) sb.append(','); sb.append((int) FREQ[i]); }
        sb.append("],\"levels\":[");
        for (int i = 0; i < BANDS; i++) { if (i > 0) sb.append(','); sb.append(gainsMb[i]); }
        sb.append("]}");
        return sb.toString();
    }

    /* ---------------- AudioProcessor ---------------- */
    @Override
    protected AudioFormat onConfigure(AudioFormat inputFormat) {
        channels = Math.max(1, inputFormat.channelCount);
        sampleRate = inputFormat.sampleRate;
        encoding = inputFormat.encoding;
        bypass = (encoding != C.ENCODING_PCM_16BIT && encoding != C.ENCODING_PCM_FLOAT);
        z1 = new float[channels][BANDS];
        z2 = new float[channels][BANDS];
        bassZ = new float[channels];
        appliedRev = -1;
        return inputFormat;
    }

    @Override
    protected void onFlush() {
        if (z1 != null) for (float[] row : z1) java.util.Arrays.fill(row, 0f);
        if (z2 != null) for (float[] row : z2) java.util.Arrays.fill(row, 0f);
        if (bassZ != null) java.util.Arrays.fill(bassZ, 0f);
    }

    @Override
    protected void onReset() {
        z1 = null; z2 = null; bassZ = null;
        appliedRev = -1;
    }

    private void applyParams() {
        long r = rev;
        if (r == appliedRev) return;
        appliedRev = r;
        double fs = sampleRate;
        double preampDb = preampMb / 100.0;
        for (int i = 0; i < BANDS; i++) {
            double f = Math.min(FREQ[i], fs * 0.45);
            double gainDb = gainsMb[i] / 100.0 - (enabled ? 0 : 0);
            if (!enabled) gainDb = 0;
            double A = Math.pow(10.0, gainDb / 40.0);
            double w0 = 2.0 * Math.PI * f / fs;
            double alpha = Math.sin(w0) / (2.0 * Q);
            double a0 = 1.0 + alpha / A;
            b0[i] = (1.0 + alpha * A) / a0;
            b1[i] = (-2.0 * Math.cos(w0)) / a0;
            b2[i] = (1.0 - alpha * A) / a0;
            a1[i] = (-2.0 * Math.cos(w0)) / a0;
            a2[i] = (1.0 - alpha / A) / a0;
        }
        // 前级增益混在第一个双二阶之前，用单独系数保存
        preampLin = (float) Math.pow(10.0, preampDb / 20.0);
        double fc = Math.min(160.0, fs * 0.2);
        bassAlpha = (float) (1.0 - Math.exp(-2.0 * Math.PI * fc / fs));
        bassGain = (bassAmount / 1000f) * 0.65f;       // 最大约 +4.3 dB 的低频增益，避免直接削波
        virtWidth = (virtAmount / 1000f) * 1.1f;       // 最大 2.1 倍侧向扩展
        if (z1 == null) { z1 = new float[channels][BANDS]; z2 = new float[channels][BANDS]; }
        if (bassZ == null) bassZ = new float[channels];
    }

    private float preampLin = 1f;
    private float[] bassZ;
    private float bassAlpha = 0.02f;
    private float bassGain = 0f;
    private float virtWidth = 0f;

    private float processSample(int ch, float x) {
        float v = x * preampLin;
        if (enabled) {
            float[] zz1 = z1[ch], zz2 = z2[ch];
            for (int i = 0; i < BANDS; i++) {
                float y = (float) (b0[i] * v + zz1[i]);
                zz1[i] = (float) (b1[i] * v - a1[i] * y + zz2[i]);
                zz2[i] = (float) (b2[i] * v - a2[i] * y);
                v = y;
            }
        }
        if (bassAmount > 0 && bassZ != null) {
            bassZ[ch] += bassAlpha * (v - bassZ[ch]);
            v += bassGain * bassZ[ch];
        }
        return v;
    }

    private void widenStereo(float[] frame) {
        if (virtAmount <= 0 || channels < 2 || frame.length < 2) return;
        float l = frame[0], r = frame[1];
        float m = (l + r) * 0.5f;
        float side = (l - r) * 0.5f * (1f + virtWidth);
        frame[0] = m + side;
        frame[1] = m - side;
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        if (inputBuffer == null || !inputBuffer.hasRemaining()) return;
        if (z1 == null) return;                    // 还没 configure
        if (bypass) {                              // 不支持的 PCM 格式：原样透传
            ByteBuffer out = replaceOutputBuffer(inputBuffer.remaining());
            out.put(inputBuffer.duplicate());
            inputBuffer.position(inputBuffer.limit());
            out.flip();
            return;
        }
        applyParams();
        int bytesPerSample = encoding == C.ENCODING_PCM_FLOAT ? 4 : 2;
        int frameSize = bytesPerSample * channels;
        int frames = inputBuffer.remaining() / frameSize;
        if (frames <= 0) return;

        ByteBuffer out = replaceOutputBuffer(frames * frameSize);
        float[] frame = new float[channels];
        if (encoding == C.ENCODING_PCM_FLOAT) {
            FloatBuffer in = inputBuffer.asFloatBuffer();
            FloatBuffer ob = out.asFloatBuffer();
            for (int f = 0; f < frames; f++) {
                for (int ch = 0; ch < channels; ch++) frame[ch] = processSample(ch, in.get());
                widenStereo(frame);
                for (int ch = 0; ch < channels; ch++) {
                    float v = frame[ch];
                    if (v > 1f) v = 1f; else if (v < -1f) v = -1f;
                    ob.put(v);
                }
            }
        } else {
            ShortBuffer in = inputBuffer.asShortBuffer();
            ShortBuffer ob = out.asShortBuffer();
            for (int f = 0; f < frames; f++) {
                for (int ch = 0; ch < channels; ch++) frame[ch] = processSample(ch, in.get() / 32768f);
                widenStereo(frame);
                for (int ch = 0; ch < channels; ch++) {
                    float v = frame[ch];
                    if (v > 1f) v = 1f; else if (v < -1f) v = -1f;
                    ob.put((short) Math.round(v * 32767f));
                }
            }
        }
        inputBuffer.position(inputBuffer.limit());
        out.position(frames * frameSize);      // asXBuffer 的写入不推进外层 ByteBuffer，手动同步
        out.flip();
    }
}
