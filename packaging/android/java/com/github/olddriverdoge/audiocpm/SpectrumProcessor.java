package com.github.olddriverdoge.audiocpm;

import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.AudioProcessor.AudioFormat;
import androidx.media3.common.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;

/** 挂在 ExoPlayer DefaultAudioSink 上的 PCM 旁路：不接管输出，只读样本算频谱。 */
public class SpectrumProcessor extends BaseAudioProcessor {
    private static final int FFT_N = 1024;
    private static volatile float[] bands = new float[64];
    private static volatile int sampleRate = 48000;
    private static volatile boolean enabled = false;

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
    public static float[] getBands() { return bands.clone(); }
    public static int getSampleRate() { return sampleRate; }

    @Override
    protected AudioFormat onConfigure(AudioFormat inputFormat) {
        sampleRate = inputFormat.sampleRate;
        return inputFormat;
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        if (enabled && inputBuffer != null) {
            ByteBuffer dup = inputBuffer.duplicate();
            int remaining = dup.remaining();
            while (remaining >= 2) {
                short s = dup.getShort();
                mono[fill++] = s / 32768f;
                remaining -= 2;
                if (fill >= FFT_N) {
                    compute();
                    fill = 0;
                }
            }
        }
        super.queueInput(inputBuffer);
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
