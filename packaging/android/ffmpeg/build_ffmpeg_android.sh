#!/usr/bin/env bash
# 构建 Android 音频专用 FFmpeg（静态单文件可执行），产物：libffmpegbin.so
#
# 用法：
#   ANDROID_NDK_HOME=/path/to/ndk ./build_ffmpeg_android.sh
# 可选环境变量：
#   FFMPEG_VERSION  默认 8.0.1
#   ANDROID_API     默认 24（与 minSdk 一致）
#   OUT             产物目录，默认 <脚本目录>/out
#   WORK            编译目录，默认 /tmp/ffmpeg-build
#
# 只编「音频」：解码本地音频全格式，编码 flac/aac(alac)/pcm，禁用网络、视频、ffprobe。
set -euo pipefail

VERSION=${FFMPEG_VERSION:-8.0.1}
API=${ANDROID_API:-24}
OUT=${OUT:-$(cd "$(dirname "$0")" && pwd)/out}
WORK=${WORK:-${TMPDIR:-/tmp}/ffmpeg-build}

# ---------------- NDK ----------------
NDK=${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}
if [ -z "$NDK" ]; then
  NDK=$(ls -d "${ANDROID_HOME:-/usr/local/lib/android/sdk}"/ndk/* 2>/dev/null | sort -V | tail -1)
fi
if [ -z "$NDK" ] || [ ! -d "$NDK" ]; then
  echo "!! 找不到 NDK，请设置 ANDROID_NDK_HOME" >&2
  exit 2
fi
echo "NDK: $NDK"
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
CC="$TOOLCHAIN/bin/aarch64-linux-android${API}-clang"
[ -x "$CC" ] || { echo "!! 找不到编译器 $CC" >&2; exit 2; }

# ---------------- 源码 ----------------
mkdir -p "$WORK" "$OUT"
cd "$WORK"
if [ ! -d "ffmpeg-$VERSION" ]; then
  if [ ! -f "ffmpeg-$VERSION.tar.xz" ]; then
    echo ">> 下载 ffmpeg $VERSION"
    curl -fL --retry 3 "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" -o "ffmpeg-$VERSION.tar.xz"
  fi
  tar xf "ffmpeg-$VERSION.tar.xz"
fi
cd "ffmpeg-$VERSION"

# ---------------- configure ----------------
echo ">> configure"
./configure \
  --target-os=android \
  --arch=aarch64 \
  --cpu=armv8-a \
  --enable-cross-compile \
  --cc="$CC" \
  --cxx="$TOOLCHAIN/bin/aarch64-linux-android${API}-clang++" \
  --ar="$TOOLCHAIN/bin/llvm-ar" \
  --nm="$TOOLCHAIN/bin/llvm-nm" \
  --ranlib="$TOOLCHAIN/bin/llvm-ranlib" \
  --strip="$TOOLCHAIN/bin/llvm-strip" \
  --sysroot="$TOOLCHAIN/sysroot" \
  --disable-everything \
  --disable-doc --disable-ffplay --disable-ffprobe \
  --enable-ffmpeg \
  --disable-network --disable-avdevice \
  --disable-bzlib --disable-lzma --disable-iconv \
  --disable-sdl2 --disable-xlib --disable-libxcb \
  --enable-protocol=file,pipe \
  --enable-filter=aresample,volume,anull,scale \
  --enable-decoder=aac,mp3,flac,alac,ape,wavpack,vorbis,opus,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_s16be,pcm_s24be,dsd_lsbf,dsd_msbf,dsd_lsbf_planar,dsd_msbf_planar,mjpeg,png \
  --enable-encoder=flac,alac,aac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_s16be,wavpack,mjpeg \
  --enable-demuxer=flac,mp3,wav,aiff,mov,ogg,ape,wv,dsf,dff,aac,image2 \
  --enable-muxer=flac,ipod,wav,aiff,mp3,image2 \
  --enable-parser=aac,mpegaudio,flac,vorbis,opus \
  --enable-bsf=aac_adtstoasc \
  --enable-small --disable-symver \
  --disable-shared --enable-static \
  --extra-cflags="-O3 -fPIC -DANDROID" \
  --extra-ldflags="-Wl,-z,max-page-size=16384 -Wl,--build-id=sha1"

# ---------------- 编译 ----------------
echo ">> make -j$(nproc)"
make -j"$(nproc)" ffmpeg
"$TOOLCHAIN/bin/llvm-strip" -s ffmpeg

# ---------------- 产物 ----------------
cp -f ffmpeg "$OUT/libffmpegbin.so"
echo ">> 产物:"
ls -l "$OUT/libffmpegbin.so"
file "$OUT/libffmpegbin.so"
readelf -l "$OUT/libffmpegbin.so" | awk '/LOAD/{print "LOAD align:", $NF}' | sort -u
