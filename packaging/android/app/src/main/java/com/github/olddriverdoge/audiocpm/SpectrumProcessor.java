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
    private static final int FFT_N = 2048;
    private static volatile float[] bands = new float[96];
    /** 频谱柱状（快速响应）：平滑更轻，专门给频谱条用，避免和声谱共用 0.8 平滑导致卡顿/延迟。 */
    private static volatile float[] levels = new float[96];
    private static volatile int sampleRate = 48000;
    private static volatile boolean enabled = false;
    private static volatile int encoding = C.ENCODING_PCM_16BIT;
    private static volatile int channels = 2;

    private final float[] window = new float[FFT_N];
    private final float[] re = new float[FFT_N];
    private final float[] im = new float[FFT_N];
    private final float[] mono = new float[FFT_N];
    private final float[] prev = new float[96];
    private final float[] prevLevels = new float[96];
    private int fill = 0;

    public SpectrumProcessor() {
        // 与 WebAudio AnalyserNode 一致用 Blackman 窗（低频泄漏更小，观感接近旧版）。
        for (int i = 0; i < FFT_N; i++) {
            double x = 2.0 * Math.PI * i / (FFT_N - 1);
            window[i] = (float) (0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x));
        }
    }

    public static void setEnabled(boolean b) { enabled = b; }
    public static boolean isEnabled() { return enabled; }
    public static float[] getBands() { return bands.clone(); }
    public static float[] getLevels() { return levels.clone(); }
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
        bands = new float[96];
        levels = new float[96];
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
                    // 75% 重叠：保留后 3/4，每 512 个新样本（≈10.7ms@48k）算一次 → 约 93fps，
                    // 供前端 90Hz 刷新；未展开时 setEnabled(false) 整个分析不跑。
                    System.arraycopy(mono, FFT_N / 4, mono, 0, FFT_N - FFT_N / 4);
                    fill = FFT_N - FFT_N / 4;
                }
                // 跳过本帧剩余声道
                int skip = frame - bytes;
                if (skip > 0) dup.position(dup.position() + skip);
            }
        }
        // 原样透传（必须 consume 输入缓冲区）
        // 注意：replaceOutputBuffer() 返回的是本处理器内部的 buffer，而管线有时会把同一个
        // ByteBuffer 对象当输入传进来，直接 out.put(inputBuffer) 会抛
        // IllegalArgumentException: The source buffer is this buffer（真机已复现）。
        // 所以先复制到独立的临时缓冲，再写回输出缓冲。
        ByteBuffer tmp = ByteBuffer.allocateDirect(size).order(ByteOrder.LITTLE_ENDIAN);
        tmp.put(inputBuffer.duplicate());
        tmp.flip();
        // 必须把输入消费掉：AudioProcessingPipeline 用 (输入前剩余 - 调用后剩余) 判断是否有进展，
        // 不消费会导致同一段 PCM 被反复喂进来，真机表现就是“一小段声音不停重复”。
        inputBuffer.position(inputBuffer.limit());
        ByteBuffer out = replaceOutputBuffer(size);
        out.put(tmp);
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
        float[] out = new float[96];
        float[] outLevels = new float[96];
        // 线性频率分档（和 WebAudio getByteFrequencyData 的 1024 个线性 bin 同源，
        // 再用 96 档做平均；对数分档会让低频只有 1 个 bin，显得一根根柱子又高又跳）。
        final int half = FFT_N / 2;
        final double minDb = -100.0, maxDb = -30.0;   // WebAudio analyser 默认值
        for (int b = 0; b < 96; b++) {
            int k0 = Math.max(1, (int) Math.round(b * half / 96.0));
            int k1 = Math.min(half - 1, (int) Math.round((b + 1) * half / 96.0) - 1);
            if (k1 < k0) k1 = k0;
            float sum = 0f;
            int n = 0;
            for (int k = k0; k <= k1; k++) {
                sum += (float) Math.hypot(re[k], im[k]);
                n++;
            }
            float mag = n > 0 ? sum / n : 0f;
            // Blackman 下幅度按 N 归一化；再套 WebAudio 的 -100..-30dB 映射。
            double amp = mag / (double) FFT_N;
            double db = 20.0 * Math.log10(Math.max(amp, 1e-7));
            float v = (float) Math.max(0.0, Math.min(1.0, (db - minDb) / (maxDb - minDb)));
            // 声谱：0.8 平滑，稳定、观感接近 AnalyserNode。
            prev[b] = prev[b] * 0.8f + v * 0.2f;
            out[b] = prev[b];
            // 频谱条：0.35 平滑，响应更快、延迟更低。
            prevLevels[b] = prevLevels[b] * 0.35f + v * 0.65f;
            outLevels[b] = prevLevels[b];
        }
        bands = out;
        levels = outLevels;
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
