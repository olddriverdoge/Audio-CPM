package com.github.olddriverdoge.audiocpm;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.os.Build;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.AudioProcessor.AudioFormat;
import androidx.media3.common.audio.AudioProcessingPipeline;
import androidx.media3.common.audio.SonicAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.common.util.Util;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.AudioOffloadSupport;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.audio.AuxEffectInfo;

import com.google.common.collect.ImmutableList;

import java.nio.ByteBuffer;
import java.util.Arrays;

/**
 * AAudio 独占输出优先，失败自动回退到 DefaultAudioSink（共享混音）。
 *
 * 说明：AAudio 只接管“最终 PCM 写入”，ExoPlayer 仍负责解封装/解码；频谱与 EQ
 * 在进入 AAudio 前通过 Media3 AudioProcessingPipeline 处理，链路和旧版一致。
 */
@UnstableApi
public final class AaudioAudioSink implements AudioSink {
    private static final String TAG = "Audio-CPM/AAudio";

    private final DefaultAudioSink fallback;
    private final AudioProcessor[] processors;
    private final SonicAudioProcessor sonic = new SonicAudioProcessor();
    private AudioProcessingPipeline pipeline;
    private volatile AudioSink.Listener listener;

    private long nativeHandle;
    private boolean nativeActive;
    private boolean ended;
    private boolean released;
    private int preferredDeviceId;
    private long streamOffsetUs;
    private PlaybackParameters playbackParameters = PlaybackParameters.DEFAULT;
    private boolean skipSilence;
    private AudioAttributes audioAttributes;

    // 给「音频输出」面板读的只读状态
    private static volatile boolean sActive;
    private static volatile boolean sFallback;
    private static volatile String sError = "";
    private static volatile int sRate;
    private static volatile int sChannels;
    private static volatile int sEncoding;
    private static volatile String sDevice = "";
    private static volatile int sInputRate;
    private static volatile int sInputChannels;
    private static volatile int sInputEncoding;

    static {
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                System.loadLibrary("ac2aaudio");
                sFallback = false;
            } catch (Throwable t) {
                sError = "load libac2aaudio: " + t;
                Log.w(TAG, "AAudio native library load failed", t);
            }
        } else {
            sError = "Android < 8.0（无 AAudio）";
        }
    }

    public AaudioAudioSink(Context context, DefaultAudioSink fallback, AudioProcessor[] processors) {
        this.fallback = fallback;
        this.processors = processors == null ? new AudioProcessor[0] : processors.clone();
        this.pipeline = newPipeline();
    }

    private AudioProcessingPipeline newPipeline() {
        ImmutableList.Builder<AudioProcessor> b = ImmutableList.builder();
        for (AudioProcessor p : processors) b.add(p);
        b.add(sonic);
        return new AudioProcessingPipeline(b.build());
    }

    public static boolean isNativeActive() { return sActive; }
    public static String lastError() { return sError; }

    public static String describe() {
        StringBuilder sb = new StringBuilder("{\"active\":").append(sActive)
                .append(",\"fallback\":").append(sFallback)
                .append(",\"sampleRate\":").append(Math.max(0, sRate))
                .append(",\"channels\":").append(Math.max(0, sChannels))
                .append(",\"encoding\":").append(sEncoding)
                .append(",\"device\":\"").append(esc(sDevice))
                .append("\",\"inputSampleRate\":").append(sInputRate)
                .append(",\"inputChannels\":").append(sInputChannels)
                .append(",\"inputEncoding\":").append(sInputEncoding)
                .append("\",\"error\":\"").append(esc(sError)).append("\"}");
        return sb.toString();
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", " ").replace("\r", " ");
    }

    @Override
    public void setListener(AudioSink.Listener listener) {
        this.listener = listener;
        fallback.setListener(listener);
    }

    @Override
    public void setPlayerId(@Nullable androidx.media3.exoplayer.analytics.PlayerId playerId) {
        fallback.setPlayerId(playerId);
    }

    @Override
    public void setClock(androidx.media3.common.util.Clock clock) {
        fallback.setClock(clock);
    }

    @Override
    public boolean supportsFormat(Format format) { return true; }

    @Override
    public int getFormatSupport(Format format) {
        return fallback.getFormatSupport(format);
    }

    @Override
    public AudioOffloadSupport getFormatOffloadSupport(Format format) {
        return fallback.getFormatOffloadSupport(format);
    }

    @Override
    public long getCurrentPositionUs(boolean sourceEnded) {
        if (!nativeActive) return fallback.getCurrentPositionUs(sourceEnded);
        long pos = nativePositionUs(nativeHandle);
        if (pos < 0) return CURRENT_POSITION_NOT_SET;
        return pos + streamOffsetUs;
    }

    @Override
    public void configure(Format inputFormat, int specifiedBufferSize, @Nullable int[] outputChannels)
            throws ConfigurationException {
        sFallback = true;
        sActive = false;
        sRate = 0;
        sChannels = 0;
        sEncoding = 0;
        sDevice = "";
        sError = "";
        sInputRate = inputFormat == null ? 0 : inputFormat.sampleRate;
        sInputChannels = inputFormat == null ? 0 : inputFormat.channelCount;
        sInputEncoding = inputFormat == null ? 0 : inputFormat.pcmEncoding;
        ended = false;
        released = false;
        if (nativeHandle != 0) {
            nativeClose(nativeHandle);
            nativeHandle = 0;
        }

        // 自定义 channel map 走默认 sink，避免 AAudio 写入声道错位。
        if (outputChannels != null && !isIdentityMap(outputChannels, inputFormat.channelCount)) {
            configureFallback(inputFormat, specifiedBufferSize, outputChannels);
            sError = "channel map 非直通";
            return;
        }

        if (!nativeUsable(inputFormat)) {
            configureFallback(inputFormat, specifiedBufferSize, outputChannels);
            return;
        }

        try {
            AudioFormat in = new AudioFormat(inputFormat);
            AudioFormat out = pipeline.configure(in);
            pipeline.flush();
            if (!pipeline.isOperational()) {
                throw new IllegalStateException("AudioProcessingPipeline 未激活");
            }
            if (out.sampleRate <= 0 || out.channelCount <= 0) {
                throw new IllegalStateException("无效输出格式: " + out);
            }
            int aaFormat = toAaFormat(out.encoding);
            if (aaFormat < 0) {
                throw new IllegalStateException("AAudio 不支持编码: " + out.encoding);
            }
            long h = nativeOpen(out.sampleRate, out.channelCount, aaFormat, preferredDeviceId, 0);
            if (h == 0) {
                throw new IllegalStateException("AAudio open 失败: " + nativeLastError());
            }
            int actualRate = nativeGetSampleRate(h);
            int actualCh = nativeGetChannels(h);
            int actualFmt = nativeGetFormat(h);
            if (actualRate != out.sampleRate || actualCh != out.channelCount
                    || actualFmt != aaFormat) {
                nativeClose(h);
                throw new IllegalStateException("AAudio 实际参数不匹配: "
                        + actualRate + "/" + actualCh + "/" + actualFmt
                        + " 需要 " + out.sampleRate + "/" + out.channelCount + "/" + aaFormat);
            }
            nativeHandle = h;
            nativeActive = true;
            sActive = true;
            sFallback = false;
            sRate = actualRate;
            sChannels = actualCh;
            sEncoding = out.encoding;
            sDevice = "AAudio exclusive";
            sError = "";
            nativeSetVolume(h, 1.0f); // 由 Media3 setVolume 覆盖
            Log.i(TAG, "AAudio exclusive opened " + actualRate + "Hz/" + actualCh + "ch/fmt=" + actualFmt);
            return;
        } catch (Throwable t) {
            try { pipeline.reset(); } catch (Throwable ignored) {}
            pipeline = newPipeline();
            sError = String.valueOf(t.getMessage() == null ? t : t.getMessage());
            Log.w(TAG, "AAudio exclusive unavailable, fallback to shared mix: " + sError, t);
            configureFallback(inputFormat, specifiedBufferSize, outputChannels);
        }
    }

    private void configureFallback(Format inputFormat, int specifiedBufferSize, @Nullable int[] outputChannels)
            throws ConfigurationException {
        nativeActive = false;
        sActive = false;
        sFallback = true;
        fallback.configure(inputFormat, specifiedBufferSize, outputChannels);
    }

    private static boolean isIdentityMap(int[] map, int channels) {
        if (map == null) return true;
        if (map.length != channels) return false;
        for (int i = 0; i < map.length; i++) if (map[i] != i) return false;
        return true;
    }

    private static boolean nativeUsable(Format f) {
        if (Build.VERSION.SDK_INT < 26) return false;
        if (f == null) return false;
        if (f.sampleRate <= 0 || f.channelCount <= 0) return false;
        if (f.channelCount > 2) return false;
        return Util.isEncodingLinearPcm(f.pcmEncoding)
                && (f.pcmEncoding == C.ENCODING_PCM_16BIT || f.pcmEncoding == C.ENCODING_PCM_FLOAT);
    }

    private static int toAaFormat(int encoding) {
        if (encoding == C.ENCODING_PCM_16BIT) return 1; // AAUDIO_FORMAT_PCM_I16
        if (encoding == C.ENCODING_PCM_FLOAT) return 2; // AAUDIO_FORMAT_PCM_FLOAT
        return -1;
    }

    @Override
    public void play() {
        if (nativeActive) {
            nativeStart(nativeHandle);
            AudioSink.Listener l = listener;
            if (l != null) l.onPositionAdvancing(System.currentTimeMillis());
        } else {
            fallback.play();
        }
    }

    @Override
    public void handleDiscontinuity() {
        if (!nativeActive) fallback.handleDiscontinuity();
    }

    @Override
    public boolean handleBuffer(ByteBuffer buffer, long presentationTimeUs, int encodedAccessUnitCount)
            throws InitializationException, WriteException {
        if (!nativeActive) return fallback.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount);
        try {
            int guard = 0;
            while (buffer.hasRemaining() && guard++ < 16) {
                int before = buffer.position();
                pipeline.queueInput(buffer);
                drainPipeline(buffer, presentationTimeUs);
                if (buffer.position() == before) {
                    ByteBuffer out = pipeline.getOutput();
                    if (!out.hasRemaining()) break;
                }
            }
            return !buffer.hasRemaining();
        } catch (WriteException e) {
            throw e;
        } catch (Throwable t) {
            throw new WriteException(-999, null, true);
        }
    }

    private void drainPipeline(ByteBuffer input, long presentationTimeUs) throws WriteException {
        int guard = 0;
        while (guard++ < 64) {
            ByteBuffer out = pipeline.getOutput();
            if (out == null || !out.hasRemaining()) return;
            int start = out.position();
            int remaining = out.remaining();
            int written;
            if (out.isDirect()) {
                written = nativeWrite(nativeHandle, out, remaining);
            } else {
                ByteBuffer direct = ByteBuffer.allocateDirect(remaining);
                direct.put(out.duplicate());
                direct.flip();
                written = nativeWrite(nativeHandle, direct, remaining);
            }
            if (written < 0) {
                throw new WriteException(written, null, true);
            }
            if (written == 0) {
                // 阻塞写不应返回 0；避免死循环，交给上层重试。
                return;
            }
            out.position(start + written);
        }
    }

    @Override
    public void playToEndOfStream() throws WriteException {
        if (!nativeActive) { fallback.playToEndOfStream(); return; }
        pipeline.queueEndOfStream();
        drainPipeline(null, 0);
        ended = true;
    }

    @Override
    public boolean isEnded() {
        if (!nativeActive) return fallback.isEnded();
        return ended && !pipeline.getOutput().hasRemaining();
    }

    @Override
    public boolean hasPendingData() {
        if (!nativeActive) return fallback.hasPendingData();
        return false;
    }

    @Override
    public void setPlaybackParameters(PlaybackParameters playbackParameters) {
        this.playbackParameters = playbackParameters;
        sonic.setSpeed(playbackParameters.speed);
        sonic.setPitch(playbackParameters.pitch);
        fallback.setPlaybackParameters(playbackParameters);
    }

    @Override
    public PlaybackParameters getPlaybackParameters() {
        return playbackParameters;
    }

    @Override
    public void setSkipSilenceEnabled(boolean skipSilenceEnabled) {
        this.skipSilence = skipSilenceEnabled;
        fallback.setSkipSilenceEnabled(skipSilenceEnabled);
    }

    @Override
    public boolean getSkipSilenceEnabled() { return skipSilence; }

    @Override
    public void setAudioAttributes(AudioAttributes audioAttributes) {
        this.audioAttributes = audioAttributes;
        fallback.setAudioAttributes(audioAttributes);
    }

    @Override
    public @Nullable AudioAttributes getAudioAttributes() { return audioAttributes; }

    @Override
    public void setAudioSessionId(int audioSessionId) {
        fallback.setAudioSessionId(audioSessionId);
    }

    @Override
    public void setAuxEffectInfo(AuxEffectInfo auxEffectInfo) {
        fallback.setAuxEffectInfo(auxEffectInfo);
    }

    @Override
    public void setPreferredDevice(@Nullable AudioDeviceInfo audioDeviceInfo) {
        preferredDeviceId = audioDeviceInfo == null ? 0 : audioDeviceInfo.getId();
        fallback.setPreferredDevice(audioDeviceInfo);
        // 已开流不重建；下一次 configure（切歌/格式变化）会使用新设备。
    }

    @Override
    public void setOutputStreamOffsetUs(long outputStreamOffsetUs) {
        this.streamOffsetUs = outputStreamOffsetUs;
        fallback.setOutputStreamOffsetUs(outputStreamOffsetUs);
    }

    @Override
    public void enableTunnelingV21() { fallback.enableTunnelingV21(); }

    @Override
    public void disableTunneling() { fallback.disableTunneling(); }

    @Override
    public void setOffloadMode(int offloadMode) { fallback.setOffloadMode(offloadMode); }

    @Override
    public void setOffloadDelayPadding(int delayInFrames, int paddingInFrames) {
        fallback.setOffloadDelayPadding(delayInFrames, paddingInFrames);
    }

    @Override
    public void setVolume(float volume) {
        if (nativeActive) nativeSetVolume(nativeHandle, volume);
        fallback.setVolume(volume);
    }

    @Override
    public void pause() {
        if (nativeActive) nativePause(nativeHandle);
        else fallback.pause();
    }

    @Override
    public void flush() {
        if (nativeActive) {
            nativeFlush(nativeHandle);
            try { pipeline.flush(); } catch (Throwable ignored) {}
            ended = false;
        } else {
            fallback.flush();
        }
    }

    @Override
    public void reset() {
        if (nativeActive && nativeHandle != 0) {
            nativeClose(nativeHandle);
            nativeHandle = 0;
            nativeActive = false;
        }
        sActive = false;
        try { pipeline.reset(); } catch (Throwable ignored) {}
        pipeline = newPipeline();
        ended = false;
        fallback.reset();
    }

    @Override
    public void release() {
        if (released) return;
        released = true;
        if (nativeHandle != 0) {
            nativeClose(nativeHandle);
            nativeHandle = 0;
            nativeActive = false;
        }
        sActive = false;
        fallback.release();
    }

    private static native long nativeOpen(int sampleRate, int channels, int format, int deviceId, int bufferFrames);
    private static native void nativeStart(long handle);
    private static native void nativePause(long handle);
    private static native void nativeFlush(long handle);
    private static native void nativeClose(long handle);
    private static native int nativeWrite(long handle, ByteBuffer buffer, int bytes);
    private static native long nativePositionUs(long handle);
    private static native void nativeSetVolume(long handle, float volume);
    private static native int nativeGetSampleRate(long handle);
    private static native int nativeGetChannels(long handle);
    private static native int nativeGetFormat(long handle);
    private static native String nativeLastError();
}
