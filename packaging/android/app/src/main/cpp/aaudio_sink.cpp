#include <jni.h>
#include <aaudio/AAudio.h>
#include <android/log.h>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <mutex>
#include <string>
#include <vector>

#define LOG_TAG "Audio-CPM/AAudioNative"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

struct Sink {
    AAudioStream *stream = nullptr;
    int sampleRate = 0;
    int channels = 0;
    int format = 0;
    int bytesPerFrame = 2;
    int64_t baseFrames = 0;
    bool playing = false;
    float volume = 1.0f;
};

static std::mutex gLock;
static std::string gLastError;

static void setError(const std::string &s) {
    std::lock_guard<std::mutex> lk(gLock);
    gLastError = s;
}

static int bytesForFormat(int fmt) {
    if (fmt == AAUDIO_FORMAT_PCM_I16) return 2;
    if (fmt == AAUDIO_FORMAT_PCM_FLOAT) return 4;
    return 0;
}

static Sink *sinkOf(jlong handle) {
    return reinterpret_cast<Sink *>(static_cast<intptr_t>(handle));
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeOpen(
        JNIEnv *, jclass, jint sampleRate, jint channels, jint format, jint deviceId, jint bufferFrames) {
    if (sampleRate <= 0 || channels <= 0 || bytesForFormat(format) == 0) {
        setError("invalid format");
        return 0;
    }
    AAudioStreamBuilder *builder = nullptr;
    auto r = AAudio_createStreamBuilder(&builder);
    if (r != AAUDIO_OK || builder == nullptr) {
        setError("AAudio_createStreamBuilder failed: " + std::to_string(r));
        return 0;
    }
    AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
    AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_EXCLUSIVE);
    AAudioStreamBuilder_setPerformanceMode(builder, AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
    AAudioStreamBuilder_setFormat(builder, static_cast<decltype(AAUDIO_FORMAT_PCM_I16)>(format));
    AAudioStreamBuilder_setChannelCount(builder, channels);
    AAudioStreamBuilder_setSampleRate(builder, sampleRate);
    if (deviceId > 0) AAudioStreamBuilder_setDeviceId(builder, deviceId);
    if (bufferFrames > 0) AAudioStreamBuilder_setBufferCapacityInFrames(builder, bufferFrames);

    AAudioStream *stream = nullptr;
    r = AAudioStreamBuilder_openStream(builder, &stream);
    AAudioStreamBuilder_delete(builder);
    if (r != AAUDIO_OK || stream == nullptr) {
        setError("AAudio open failed: " + std::to_string(r));
        return 0;
    }

    int actualRate = AAudioStream_getSampleRate(stream);
    int actualCh = AAudioStream_getChannelCount(stream);
    auto actualFmtValue = AAudioStream_getFormat(stream);
    int actualFmt = static_cast<int>(actualFmtValue);
    if (actualRate != sampleRate || actualCh != channels || actualFmt != format) {
        std::string msg = "AAudio actual mismatch: " + std::to_string(actualRate) + "/" +
                          std::to_string(actualCh) + "/" + std::to_string(actualFmt) +
                          " need " + std::to_string(sampleRate) + "/" +
                          std::to_string(channels) + "/" + std::to_string(format);
        setError(msg);
        AAudioStream_close(stream);
        return 0;
    }

    Sink *sink = new Sink();
    sink->stream = stream;
    sink->sampleRate = actualRate;
    sink->channels = actualCh;
    sink->format = actualFmt;
    sink->bytesPerFrame = bytesForFormat(actualFmt) * actualCh;
    sink->baseFrames = 0;
    sink->playing = false;
    sink->volume = 1.0f;
    setError("");
    LOGI("open %d Hz %d ch format %d", actualRate, actualCh, actualFmt);
    return static_cast<jlong>(reinterpret_cast<intptr_t>(sink));
}

extern "C" JNIEXPORT void JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeStart(JNIEnv *, jclass, jlong handle) {
    Sink *s = sinkOf(handle);
    if (!s) return;
    auto r = AAudioStream_requestStart(s->stream);
    if (r != AAUDIO_OK) {
        setError("AAudio start failed: " + std::to_string(r));
        LOGW("start failed %d", r);
        return;
    }
    s->playing = true;
}

extern "C" JNIEXPORT void JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativePause(JNIEnv *, jclass, jlong handle) {
    Sink *s = sinkOf(handle);
    if (!s) return;
    AAudioStream_requestPause(s->stream);
    s->playing = false;
}

extern "C" JNIEXPORT void JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeFlush(JNIEnv *, jclass, jlong handle) {
    Sink *s = sinkOf(handle);
    if (!s) return;
    // AAudio 要求先 pause 再 flush；直接在播放中 flush 部分 ROM 会阻塞，
    // 表现就是拖动/点指定位置后整个 UI 卡死。
    bool wasPlaying = s->playing;
    s->playing = false;
    AAudioStream_requestPause(s->stream);
    int64_t before = AAudioStream_getFramesWritten(s->stream);
    AAudioStream_requestFlush(s->stream);
    s->baseFrames = before;
    if (wasPlaying) {
        auto r = AAudioStream_requestStart(s->stream);
        if (r == AAUDIO_OK) s->playing = true;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeClose(JNIEnv *, jclass, jlong handle) {
    Sink *s = sinkOf(handle);
    if (!s) return;
    AAudioStream_requestStop(s->stream);
    AAudioStream_close(s->stream);
    delete s;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeWrite(
        JNIEnv *env, jclass, jlong handle, jobject buffer, jint bytes) {
    Sink *s = sinkOf(handle);
    if (!s || !buffer || bytes <= 0) return -100;
    uint8_t *src = static_cast<uint8_t *>(env->GetDirectBufferAddress(buffer));
    jlong capacity = env->GetDirectBufferCapacity(buffer);
    if (!src || capacity < bytes) return -101; // 只接受 direct buffer

    int frames = bytes / s->bytesPerFrame;
    if (frames <= 0) return 0;
    // 某些调用顺序下 Media3 先写数据、后调用 play()，AAudio 未 start 时 write 会失败或静音。
    // 这里做一次幂等启动，避免“显示播放但没声音”。
    if (!s->playing) {
        auto r = AAudioStream_requestStart(s->stream);
        if (r == AAUDIO_OK) s->playing = true;
    }
    int64_t total = 0;

    if (std::fabs(s->volume - 1.0f) > 0.001f) {
        std::vector<uint8_t> tmp(static_cast<size_t>(frames) * s->bytesPerFrame);
        std::memcpy(tmp.data(), src, tmp.size());
        if (s->format == AAUDIO_FORMAT_PCM_I16) {
            int16_t *p = reinterpret_cast<int16_t *>(tmp.data());
            int samples = frames * s->channels;
            for (int i = 0; i < samples; i++) p[i] = static_cast<int16_t>(p[i] * s->volume);
        } else if (s->format == AAUDIO_FORMAT_PCM_FLOAT) {
            float *p = reinterpret_cast<float *>(tmp.data());
            int samples = frames * s->channels;
            for (int i = 0; i < samples; i++) p[i] *= s->volume;
        }
        src = tmp.data();
    }

    while (total < frames) {
        int64_t n = AAudioStream_write(s->stream, src + total * s->bytesPerFrame,
                                       frames - total, 2000000000LL); // 2s
        if (n < 0) {
            setError("AAudio write failed: " + std::to_string(n));
            return static_cast<jint>(n);
        }
        if (n == 0) continue;
        total += n;
    }
    return static_cast<jint>(total * s->bytesPerFrame);
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativePositionUs(JNIEnv *, jclass, jlong handle) {
    Sink *s = sinkOf(handle);
    if (!s) return -1;
    // 不使用 AAudioTimestamp：部分 NDK 版本的 timestamp 类型/API 级别不稳定。
    // framesWritten 足够支撑 Media3 的进度和 seek 恢复。
    int64_t frames = AAudioStream_getFramesWritten(s->stream);
    int64_t rel = frames - s->baseFrames;
    if (rel < 0) rel = 0;
    return static_cast<jlong>(rel * 1000000LL / s->sampleRate);
}

extern "C" JNIEXPORT void JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeSetVolume(
        JNIEnv *, jclass, jlong handle, jfloat volume) {
    Sink *s = sinkOf(handle);
    if (!s) return;
    s->volume = std::max(0.0f, std::min(1.0f, static_cast<float>(volume)));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeGetSampleRate(JNIEnv *, jclass, jlong handle) {
    Sink *s = sinkOf(handle); return s ? s->sampleRate : 0;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeGetChannels(JNIEnv *, jclass, jlong handle) {
    Sink *s = sinkOf(handle); return s ? s->channels : 0;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeGetFormat(JNIEnv *, jclass, jlong handle) {
    Sink *s = sinkOf(handle); return s ? s->format : 0;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_github_olddriverdoge_audiocpm_AaudioAudioSink_nativeLastError(JNIEnv *env, jclass) {
    std::lock_guard<std::mutex> lk(gLock);
    return env->NewStringUTF(gLastError.c_str());
}
