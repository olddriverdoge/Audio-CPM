package com.github.olddriverdoge.audiocpm;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor.AudioFormat;
import androidx.media3.common.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * 挂在 ExoPlayer DefaultAudioSink 上的 PCM 旁路：只读样本算频谱，音频原样透传。
 *
 * 注意：BaseAudioProcessor 要求子类在 queueInput 里用 replaceOutputBuffer 消费输入，
 * 否则音频会被丢弃（早期 p4a 版本写成 super.queueInput(inputBuffer)，是错的）。
 *
 * 采样格式必须按 AudioFormat.encoding 走：ExoPlayer 在 24bit 源 / 浮点输出时会用
 * ENCODING_PCM_FLOAT，早期实现一律按 16bit short 读，频谱会是一团噪声或全零。
 */
public class SpectrumProcessor extends BaseAudioProcessor {
    private static final int FFT_N = 1024;
    private static volatile float[] bands = new float[64];
    private static volatile int sampleRate = 48000;
    private static volatile boolean enabled = false;
    private static volatile int encoding = C.ENCODING_PCM_16BIT;
    private static volatile int channels = 2;

    private final float[] window = new float[FFT_N];
    private final float[] re = new float[FFT_N];
    private final float[] im = new float[FFT_N];
    private final float[] mono = new float[FFT_N];
    private int fill = 0;

    public SpectrumProcessor() {
        for (int i = 0; i < FFT_N; i++) {
            window[i] = (float) (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_N - 1)));
        }
    }

    public static void setEnabled(boolean b) { enabled = b; }
    public static boolean isEnabled() { return enabled; }
    public static float[] getBands() { return bands.clone(); }
    public static int getSampleRate() { return sampleRate; }
    /** 排查用：当前输入格式。 */
    public static String describe() {
        return "{\"sampleRate\":" + sampleRate + ",\"channels\":" + channels
                + ",\"encoding\":" + encoding + ",\"enabled\":" + enabled + "}";
    }

    @Override
    protected AudioFormat onConfigure(AudioFormat inputFormat) {
        sampleRate = inputFormat.sampleRate;
        channels = Math.max(1, inputFormat.channelCount);
        encoding = inputFormat.encoding;
        fill = 0;
        return inputFormat;
    }

    @Override
    protected void onFlush() {
        fill = 0;
    }

    @Override
    protected void onReset() {
        fill = 0;
        bands = new float[64];
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        int size = inputBuffer.remaining();
        if (enabled && size > 0) {
            int bytes = bytesPerSample(encoding);
            int frame = bytes * channels;
            ByteBuffer dup = inputBuffer.duplicate();
            dup.order(ByteOrder.LITTLE_ENDIAN);
            while (frame > 0 && dup.remaining() >= frame) {
                mono[fill++] = readSample(dup, bytes);
                if (fill >= FFT_N) {
                    compute();
                    fill = 0;
                }
                // 跳过本帧剩余声道
                int skip = frame - bytes;
                if (skip > 0) dup.position(dup.position() + skip);
            }
        }
        // 原样透传（必须 consume 输入缓冲区）
        ByteBuffer out = replaceOutputBuffer(size);
        out.put(inputBuffer);
        out.flip();
    }

    private static int bytesPerSample(int enc) {
        switch (enc) {
            case C.ENCODING_PCM_8BIT: return 1;
            case C.ENCODING_PCM_24BIT: return 3;
            case C.ENCODING_PCM_32BIT:
            case C.ENCODING_PCM_FLOAT: return 4;
            default: return 2;
        }
    }

    /** 读当前帧第一声道并归一化到 [-1,1]。 */
    private float readSample(ByteBuffer b, int bytes) {
        if (bytes == 1) {
            return ((b.get() & 0xFF) - 128) / 128.0f;
        }
        if (bytes == 3) {
            int b0 = b.get() & 0xFF, b1 = b.get() & 0xFF, b2 = b.get();
            int v = (b2 << 16) | (b1 << 8) | b0;   // b2 带符号，高位自动扩展
            return v / 8388608.0f;
        }
        if (bytes == 4) {
            if (encoding == C.ENCODING_PCM_FLOAT) return b.getFloat();
            return b.getInt() / 2147483648.0f;
        }
        return b.getShort() / 32768.0f;
    }

    private void compute() {
        for (int i = 0; i < FFT_N; i++) {
            re[i] = mono[i] * window[i];
            im[i] = 0f;
        }
        fft(re, im);
        float[] out = new float[64];
        double minHz = 40.0;
        double maxHz = Math.min(20000.0, sampleRate / 2.0);
        for (int b = 0; b < 64; b++) {
            double f0 = minHz * Math.pow(maxHz / minHz, b / 64.0);
            double f1 = minHz * Math.pow(maxHz / minHz, (b + 1) / 64.0);
            int k0 = Math.max(1, (int) (f0 * FFT_N / sampleRate));
            int k1 = Math.min(FFT_N / 2 - 1, (int) (f1 * FFT_N / sampleRate));
            float sum = 0f;
            int n = 0;
            for (int k = k0; k <= k1; k++) {
                sum += (float) Math.hypot(re[k], im[k]);
                n++;
            }
            float v = n > 0 ? sum / n : 0f;
            out[b] = Math.min(1f, (float) (Math.log10(1.0 + v * 30.0) / 2.0));
        }
        bands = out;
    }

    private static void fft(float[] re, float[] im) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                float t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = -2 * Math.PI / len;
            float wr = (float) Math.cos(ang), wi = (float) Math.sin(ang);
            for (int i = 0; i < n; i += len) {
                float cr = 1f, ci = 0f;
                for (int j = 0; j < len / 2; j++) {
                    int a = i + j, b = i + j + len / 2;
                    float tr = re[b] * cr - im[b] * ci;
                    float ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti;
                    re[a] += tr; im[a] += ti;
                    float ncr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr; cr = ncr;
                }
            }
        }
    }
}
