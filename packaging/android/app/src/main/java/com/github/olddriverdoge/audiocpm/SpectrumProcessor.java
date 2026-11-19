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
    /**
     * 频谱条（48 个对数频段，等倍频程划分，取频段内峰值，快起慢落）。
     * 不是把 96 个线性 bin 做移动平均——那样低频被压成 1~2 根柱子，跟听到的声音对不上。
     */
    private static volatile int barCount = 48;      // 柱数（48/64/96，可在调节条里切）
    private static final double BAR_F0 = 40.0, BAR_F1 = 20000.0;
    private static volatile float[] bars = new float[barCount];
    /** 线性频段版（X 轴切线性时用），频段宽度按 Hz 等分。 */
    private static volatile float[] linBars = new float[barCount];
    /** 声谱专用高分辨率线性频谱（0..nyquist），数量 0/128/256/512。 */
    private static volatile int specCount = 0;
    private static volatile float[] spec = new float[0];
    private static volatile int sampleRate = 0;
    private static volatile boolean enabled = false;
    private static volatile int encoding = C.ENCODING_PCM_16BIT;
    private static volatile int channels = 2;
    /** onConfigure 是否已经拿到过真实输出格式；未播放时不要拿默认 48k/16bit 冒充实际输出。 */
    private static volatile boolean configured = false;
    /* 显示参数（前端调节条通过 AudioCpmBridge 下发） */
    private static volatile float dbFloor = -80.0f;   // Y 轴下限：-60 / -80 / -100
    private static volatile float releaseK = 0.12f;   // 回弹（下降）系数：快 .20 / 中 .12 / 慢 .07
    /** 帧序号：每算出一帧就 +1，桥层用它做 JSON 缓存，避免 90Hz 下重复字符串化。 */
    private static volatile int seq = 0;
    public static int getSeq() { return seq; }
    private static void bump() { seq++; }
    /** 切歌/停用时把谱系清零，避免把上一首的残影继续画出来。 */
    public static void clear() {
        bands = new float[96];
        levels = new float[96];
        bars = new float[barCount];
        linBars = new float[barCount];
        spec = new float[specCount];
        bump();
    }

    private final float[] window = new float[FFT_N];
    private final float[] re = new float[FFT_N];
    private final float[] im = new float[FFT_N];
    private final float[] mono = new float[FFT_N];
    private final float[] prev = new float[96];
    private final float[] prevLevels = new float[96];
    private float[] barPrev = new float[barCount];
    private float[] linPrev = new float[barCount];
    private float[] specPrev = new float[0];
    private int fill = 0;
    /** 音频线程每帧都要复制一份输入；反复用同一块 direct buffer，避免 GC/原生内存抖动。 */
    private ByteBuffer copyBuffer = ByteBuffer.allocateDirect(0);
    /* compute 的输出数组反复使用；否则 90Hz FFT 每秒会产生几百个小数组。 */
    private float[] computeBands = new float[96];
    private float[] computeLevels = new float[96];
    private float[] computeBars = new float[64];
    private float[] computeLin = new float[64];
    private float[] computeSpec = new float[0];

    public SpectrumProcessor() {
        // 与 WebAudio AnalyserNode 一致用 Blackman 窗（低频泄漏更小，观感接近旧版）。
        for (int i = 0; i < FFT_N; i++) {
            double x = 2.0 * Math.PI * i / (FFT_N - 1);
            window[i] = (float) (0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x));
        }
    }

    public static void setEnabled(boolean b) {
        if (enabled != b) { enabled = b; bump(); }
        if (!b) { bands = new float[96]; levels = new float[96];
                  bars = new float[barCount]; linBars = new float[barCount];
                  spec = new float[specCount]; }
    }
    public static boolean isEnabled() { return enabled; }
    public static float[] getBands() { return bands.clone(); }
    public static float[] getLevels() { return levels.clone(); }
    public static float[] getBars() {
        if (bars.length != barCount) bars = new float[barCount];
        return bars.clone();
    }
    public static float[] getSpec() { return spec.clone(); }
    public static float[] getLinBars() {
        if (linBars.length != barCount) linBars = new float[barCount];
        return linBars.clone();
    }
    /** 调节条下发：dB 下限、回弹系数、柱数。 */
    public static void setParams(float floorDb, float release, int bars, int specBands) {
        dbFloor = Math.max(-120f, Math.min(-20f, floorDb));
        releaseK = Math.max(0.04f, Math.min(0.5f, release));
        barCount = Math.max(32, Math.min(96, bars));
        int sc = Math.max(0, Math.min(512, specBands));
        if (sc != specCount) {
            specCount = sc;
            spec = new float[sc];
        }
    }
    public static int getBarCount() { return barCount; }
    public static int getSampleRate() { return sampleRate; }
    /** 排查用：当前输入格式。 */
    public static String describe() {
        return "{\"sampleRate\":" + sampleRate + ",\"channels\":" + channels
                + ",\"encoding\":" + encoding + ",\"enabled\":" + enabled
                + ",\"configured\":" + configured + "}";
    }

    @Override
    protected AudioFormat onConfigure(AudioFormat inputFormat) {
        sampleRate = inputFormat.sampleRate;
        channels = Math.max(1, inputFormat.channelCount);
        encoding = inputFormat.encoding;
        configured = true;
        fill = 0;
        bump();
        return inputFormat;
    }

    @Override
    protected void onFlush() {
        fill = 0;
    }

    @Override
    protected void onReset() {
        configured = false;
        fill = 0;
        barPrev = new float[barCount];
        linPrev = new float[barCount];
        specPrev = new float[specCount];
        bump();
        bands = new float[96];
        levels = new float[96];
        bars = new float[barCount];
        linBars = new float[barCount];
        barPrev = new float[barCount];
        linPrev = new float[barCount];
        spec = new float[specCount];
        specPrev = new float[specCount];
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
        if (copyBuffer.capacity() < size) copyBuffer = ByteBuffer.allocateDirect(size);
        copyBuffer.clear();
        copyBuffer.put(inputBuffer.duplicate());
        copyBuffer.flip();
        // 必须把输入消费掉：AudioProcessingPipeline 用 (输入前剩余 - 调用后剩余) 判断是否有进展，
        // 不消费会导致同一段 PCM 被反复喂进来，真机表现就是“一小段声音不停重复”。
        inputBuffer.position(inputBuffer.limit());
        ByteBuffer out = replaceOutputBuffer(size);
        out.put(copyBuffer);
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
        if (computeBands.length != 96) computeBands = new float[96];
        if (computeLevels.length != 96) computeLevels = new float[96];
        float[] out = computeBands;
        float[] outLevels = computeLevels;
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

        // ---- 频谱条：对数频段（每段一个倍频程的等分），取段内峰值，快起慢落 ----
        final double binHz = (double) sampleRate / FFT_N;
        final double logF0 = Math.log(BAR_F0);
        final double logSpan = Math.log(BAR_F1) - logF0;
        final double cg = 0.42 * FFT_N;          // Blackman 相干增益
        final int n = barCount;
        if (barPrev.length != n) barPrev = new float[n];
        if (computeBars.length != n) computeBars = new float[n];
        float[] outBars = computeBars;
        for (int b = 0; b < n; b++) {
            double f0 = Math.exp(logF0 + logSpan * b / n);
            double f1 = Math.exp(logF0 + logSpan * (b + 1) / n);
            int k0 = Math.max(1, (int) Math.floor(f0 / binHz));
            int k1 = Math.max(k0, (int) Math.ceil(f1 / binHz));
            k1 = Math.min(FFT_N / 2 - 1, k1);
            float peak = 0f;
            for (int k = k0; k <= k1; k++) {
                float m = (float) Math.hypot(re[k], im[k]);
                if (m > peak) peak = m;         // 峰值而非平均：音调/鼓点不会被邻近 bin 稀释
            }
            // 单边谱 + 窗增益补偿：满幅正弦 ≈ 1.0
            double amp = 2.0 * peak / cg;
            double db = 20.0 * Math.log10(Math.max(amp, 1e-7));
            // 显示范围 0 ~ -80dB（行业常见刻度）：0dB 满幅、-80dB 静音，
            // 不再用 -30dB 当下限（那会把正常的强信号削平）。
            float v = (float) Math.max(0.0, Math.min(1.0, (db - dbFloor) / (-dbFloor)));
            // 快起慢落（约 3:1），上升跟手、下降自然
            if (v > barPrev[b]) barPrev[b] += (v - barPrev[b]) * 0.55f;
            else barPrev[b] += (v - barPrev[b]) * releaseK;
            outBars[b] = barPrev[b];
        }
        bars = outBars;

        // ---- 同一份 FFT 的线性分档（Hz 等宽），供 X 轴切“线性”时使用 ----
        if (linPrev.length != n) linPrev = new float[n];
        if (computeLin.length != n) computeLin = new float[n];
        float[] outLin = computeLin;
        double spanHz = BAR_F1 - BAR_F0;
        for (int b = 0; b < n; b++) {
            double f0 = BAR_F0 + spanHz * b / n;
            double f1 = BAR_F0 + spanHz * (b + 1) / n;
            int k0 = Math.max(1, (int) Math.floor(f0 / binHz));
            int k1 = Math.max(k0, (int) Math.ceil(f1 / binHz));
            k1 = Math.min(FFT_N / 2 - 1, k1);
            float peak = 0f;
            for (int k = k0; k <= k1; k++) {
                float m = (float) Math.hypot(re[k], im[k]);
                if (m > peak) peak = m;
            }
            double amp = 2.0 * peak / cg;
            double db = 20.0 * Math.log10(Math.max(amp, 1e-7));
            float v = (float) Math.max(0.0, Math.min(1.0, (db - dbFloor) / (-dbFloor)));
            if (v > linPrev[b]) linPrev[b] += (v - linPrev[b]) * 0.55f;
            else linPrev[b] += (v - linPrev[b]) * releaseK;
            outLin[b] = linPrev[b];
        }
        linBars = outLin;

        // ---- 声谱专用线性高分辨率频谱（只在声谱模式计算，数量可调 0/128/256/512） ----
        int sc = specCount;
        if (sc > 0) {
            if (specPrev.length != sc) specPrev = new float[sc];
            if (computeSpec.length != sc) computeSpec = new float[sc];
            float[] outSpec = computeSpec;
            for (int b = 0; b < sc; b++) {
                int k0 = (int) ((long) b * half / sc);
                int k1 = (int) ((long) (b + 1) * half / sc) - 1;
                if (k1 < k0) k1 = k0;
                float sum = 0f;
                int cnt = 0;
                for (int k = k0; k <= k1; k++) {
                    sum += (float) Math.hypot(re[k], im[k]);
                    cnt++;
                }
                double amp = (cnt > 0 ? sum / cnt : 0.0) / (double) FFT_N;
                double db = 20.0 * Math.log10(Math.max(amp, 1e-7));
                float v = (float) Math.max(0.0, Math.min(1.0, (db + 100.0) / 70.0));
                specPrev[b] = specPrev[b] * 0.5f + v * 0.5f;
                outSpec[b] = specPrev[b];
            }
            spec = outSpec;
        } else if (spec.length != 0) {
            spec = new float[0];
        }
        bump();     // 一帧算完，通知桥层可以重新序列化
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
