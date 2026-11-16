package com.github.olddriverdoge.audiocpm;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;

import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;

/**
 * 波形包络（无 ffmpeg 时的解码路径）。
 *
 * 用系统 MediaExtractor + MediaCodec 解出 PCM，按 100ms 窗口取声道峰值，
 * 再降采样到需要的桶数，结果以 JSON 写到 outPath 供 Python 读取。
 *
 * 目的：APK 里不打包 ffmpeg 也能给 FLAC/MP3/AAC/OGG/Opus 生成波形。
 */
public final class Ac2Wave {
    private static final int WINDOW_MS = 100;
    private static final int TIMEOUT_US = 8000;
    /** 解码卡死保护：单次调用最多这么多次主循环 */
    private static final int MAX_LOOPS = 8_000_000;

    private Ac2Wave() {}

    public static boolean peaks(String srcPath, int buckets, String outPath) {
        if (buckets < 8) buckets = 8;
        MediaExtractor ex = new MediaExtractor();
        MediaCodec dec = null;
        try {
            ex.setDataSource(srcPath);
            int track = -1;
            MediaFormat fmt = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    fmt = f;
                    break;
                }
            }
            if (track < 0 || fmt == null) return false;
            ex.selectTrack(track);

            String mime = fmt.getString(MediaFormat.KEY_MIME);
            dec = MediaCodec.createDecoderByType(mime);
            dec.configure(fmt, null, null, 0);
            dec.start();

            int rate = getInt(fmt, MediaFormat.KEY_SAMPLE_RATE, 44100);
            if (rate <= 0) rate = 44100;
            int channels = getInt(fmt, MediaFormat.KEY_CHANNEL_COUNT, 2);
            if (channels <= 0) channels = 2;

            int windowFrames = Math.max(1, rate * WINDOW_MS / 1000);
            ArrayList<Double> windowMax = new ArrayList<>();

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            ByteBuffer out = null;
            boolean inputDone = false, outputDone = false;
            int pcmEncoding = 2;          // 2 = 16bit, 4 = float
            int outChannels = channels;
            long globalFrame = 0;
            int loops = 0;

            while (!outputDone && loops++ < MAX_LOOPS) {
                if (!inputDone) {
                    int inIdx = dec.dequeueInputBuffer(TIMEOUT_US);
                    if (inIdx >= 0) {
                        ByteBuffer inBuf = dec.getInputBuffer(inIdx);
                        int size = -1;
                        if (inBuf != null) {
                            inBuf.clear();
                            size = ex.readSampleData(inBuf, 0);
                        }
                        if (size < 0) {
                            dec.queueInputBuffer(inIdx, 0, 0, 0,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            dec.queueInputBuffer(inIdx, 0, size, ex.getSampleTime(), 0);
                            ex.advance();
                        }
                    }
                }

                int outIdx = dec.dequeueOutputBuffer(info, TIMEOUT_US);
                if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = dec.getOutputFormat();
                    if (of.containsKey("pcm-encoding")) {
                        pcmEncoding = getInt(of, "pcm-encoding", pcmEncoding);
                    }
                    outChannels = getInt(of, MediaFormat.KEY_CHANNEL_COUNT, outChannels);
                    if (outChannels <= 0) outChannels = channels;
                } else if (outIdx >= 0) {
                    if (info.size > 0) {
                        out = dec.getOutputBuffer(outIdx);
                        if (out != null) {
                            out.order(ByteOrder.LITTLE_ENDIAN);
                            out.position(info.offset);
                            out.limit(info.offset + info.size);
                            globalFrame = accumulate(out, info.offset, info.size,
                                    pcmEncoding, outChannels, windowFrames, windowMax, globalFrame);
                        }
                    }
                    dec.releaseOutputBuffer(outIdx, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputDone = true;
                    }
                }
            }

            if (windowMax.isEmpty()) return false;
            double[] peaks = downsample(windowMax, buckets);
            return writeJson(outPath, peaks, rate);
        } catch (Throwable t) {
            return false;
        } finally {
            try {
                if (dec != null) {
                    dec.stop();
                    dec.release();
                }
            } catch (Throwable ignored) {
            }
            try {
                ex.release();
            } catch (Throwable ignored) {
            }
        }
    }

    /** 把一段 PCM 折算进 100ms 窗口峰值，返回新的帧计数。 */
    private static long accumulate(ByteBuffer buf, int offset, int size, int pcmEncoding,
                                   int channels, int windowFrames,
                                   ArrayList<Double> windowMax, long globalFrame) {
        int bytesPerSample = (pcmEncoding == 4) ? 4 : (pcmEncoding == 3 ? 1 : 2);
        int frameBytes = bytesPerSample * channels;
        if (frameBytes <= 0) return globalFrame;
        int frames = size / frameBytes;
        for (int i = 0; i < frames; i++) {
            double peak = 0.0;
            int base = offset + i * frameBytes;
            for (int ch = 0; ch < channels; ch++) {
                int pos = base + ch * bytesPerSample;
                double v;
                if (pcmEncoding == 4) {
                    v = Math.abs(buf.getFloat(pos));
                } else if (pcmEncoding == 3) {
                    v = Math.abs(((buf.get(pos) & 0xFF) - 128) / 128.0);
                } else {
                    v = Math.abs(buf.getShort(pos)) / 32768.0;
                }
                if (v > peak) peak = v;
            }
            int win = (int) (globalFrame / windowFrames);
            while (windowMax.size() <= win) windowMax.add(0.0);
            double cur = windowMax.get(win);
            if (peak > cur) windowMax.set(win, peak);
            globalFrame++;
        }
        return globalFrame;
    }

    /** 100ms 窗口峰值 → buckets 个桶（按时间比例取最大）。 */
    private static double[] downsample(ArrayList<Double> windows, int buckets) {
        double[] out = new double[buckets];
        int n = windows.size();
        for (int i = 0; i < buckets; i++) {
            int from = (int) ((long) i * n / buckets);
            int to = (int) ((long) (i + 1) * n / buckets);
            if (to <= from) to = from + 1;
            if (to > n) to = n;
            double m = 0.0;
            for (int j = from; j < to; j++) {
                double v = windows.get(j);
                if (v > m) m = v;
            }
            out[i] = m;
        }
        return out;
    }

    private static boolean writeJson(String outPath, double[] peaks, int rate) {
        try (Writer w = new OutputStreamWriter(new FileOutputStream(outPath), "UTF-8")) {
            StringBuilder sb = new StringBuilder(peaks.length * 8 + 40);
            sb.append("{\"sampleRate\":").append(rate).append(",\"peaks\":[");
            for (int i = 0; i < peaks.length; i++) {
                if (i > 0) sb.append(',');
                sb.append(Math.round(peaks[i] * 10000) / 10000.0);
            }
            sb.append("]}");
            w.write(sb.toString());
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private static int getInt(MediaFormat fmt, String key, int def) {
        try {
            return fmt.containsKey(key) ? fmt.getInteger(key) : def;
        } catch (Throwable t) {
            return def;
        }
    }
}
