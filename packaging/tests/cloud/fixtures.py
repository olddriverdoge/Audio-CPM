"""Isolated fixtures for the cloud regression suite.

The suite never touches the user's real music directory.  Everything is
generated below a temporary root, and AC2_ROOT/AC2_DATA_DIR point there.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Dict


def _run(cmd, *, check=True):
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def _ffmpeg(ffmpeg: str, *args: str):
    return _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args])


def _tone(ffmpeg: str, path: Path, freq: int, duration: float, tags: Dict[str, str] | None = None):
    args = ["-f", "lavfi", "-i", f"sine=frequency={freq}:duration={duration}"]
    for key, value in (tags or {}).items():
        args += ["-metadata", f"{key}={value}"]
    if path.suffix.lower() == ".flac":
        args += ["-c:a", "flac"]
    elif path.suffix.lower() == ".wav":
        args += ["-c:a", "pcm_s16le"]
    elif path.suffix.lower() == ".m4a":
        args += ["-c:a", "aac", "-b:a", "128k"]
    else:
        raise ValueError(f"unsupported fixture audio extension: {path.suffix}")
    args.append(str(path))
    _ffmpeg(ffmpeg, *args)


def _color_image(ffmpeg: str, path: Path, color: str = "red", size: int = 640):
    _ffmpeg(
        ffmpeg,
        "-f", "lavfi", "-i", f"color=c={color}:s={size}x{size}:d=1",
        "-frames:v", "1", str(path),
    )


def _embed_cover(ffmpeg: str, audio: Path, image: Path, output: Path):
    _ffmpeg(
        ffmpeg,
        "-i", str(audio), "-i", str(image),
        "-map", "0:a", "-map", "1:v", "-c", "copy",
        "-disposition:v", "attached_pic", str(output),
    )


def build_fixture(root: Path, ffmpeg: str = "ffmpeg") -> Dict[str, str]:
    """Create deterministic API and UI fixtures and return their URI paths."""
    root = Path(root)
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)

    api = root / "api"
    ui = root / "ui"
    for p in (
        api / "in" / "Album A",
        api / "in" / "Album B",
        api / "in" / "Cover Only",
        api / "ops",
        api / "out",
        api / "work",
        api / "tasks",
        ui / "Album A",
        ui / "Album B",
        ui / "Trash",
        ui / "Convert In",
        ui / "out",
    ):
        p.mkdir(parents=True, exist_ok=True)

    cover = api / "in" / "Album A" / "cover.jpg"
    _color_image(ffmpeg, cover)

    track1 = api / "in" / "Album A" / "Track One.flac"
    _tone(ffmpeg, track1, 440, 2.0, {
        "title": "Track One", "artist": "Test Artist", "album": "Test Album",
        "track": "1", "date": "2026", "composer": "Test Composer",
    })
    track2 = api / "in" / "Album A" / "Track Two.wav"
    _tone(ffmpeg, track2, 880, 1.0, {
        "title": "Track Two", "artist": "Test Artist", "album": "Test Album",
        "track": "2", "composer": "Test Composer",
    })
    covered = api / "in" / "Album B" / "Track With Cover.flac"
    _embed_cover(ffmpeg, track1, cover, covered)
    # 目录封面回落用：目录里只有带内嵌封面的音频，没有独立图片文件。
    shutil.copy2(covered, api / "in" / "Cover Only" / "Only Audio.flac")
    (api / "in" / "Album B" / "readme.txt").write_text("not audio", encoding="utf-8")
    (api / "in" / "Album A" / "cover.jpg").write_bytes(cover.read_bytes())
    # Copy the source image too; the task tests can use either path.
    (api / "in" / "Album B" / "cover.jpg").write_bytes(cover.read_bytes())

    for name, src in (("Move Me.flac", track1), ("Copy Me.flac", track1), ("Delete Me.flac", track1)):
        shutil.copy2(src, api / "ops" / name)

    # Separate copies for task tests, so task ordering can never consume another
    # test's source file.
    shutil.copy2(track1, api / "tasks" / "Track One.flac")
    # Generate a genuine second FLAC with its own title/track tags; do not
    # clone track1 under a misleading name or previews will look wrong.
    _tone(ffmpeg, api / "tasks" / "Track Two.flac", 880, 1.0, {
        "title": "Track Two", "artist": "Test Artist", "album": "Test Album",
        "track": "2", "composer": "Test Composer",
    })
    shutil.copy2(covered, api / "tasks" / "Track With Cover.flac")
    shutil.copy2(cover, api / "tasks" / "cover.jpg")
    # A file without composer: the default rename pattern should still be
    # usable.  Cover this explicitly because a hard "no composer data" error
    # would make ordinary library files impossible to rename.
    _ffmpeg(
        ffmpeg, "-i", str(track1), "-map", "0", "-c", "copy",
        "-metadata", "composer=", str(api / "tasks" / "No Composer.flac"),
    )

    # UI fixtures: intentionally simpler, no task tests mutate this branch.
    shutil.copy2(track1, ui / "Album A" / "Track One.flac")
    shutil.copy2(track2, ui / "Album A" / "Track Two.wav")
    # 10 秒无操作自动淡化需要一首比等待时间更长的音频；放最前面，
    # 不改变原有 Track One → Track Two 的顺序断言。带内嵌封面，
    # 用来验证自动淡化不能把背景封面一起压到 10%。
    long_plain = ui / "Album A" / "A Long Tone.flac"
    _tone(ffmpeg, long_plain, 523, 16.0)
    long_covered = ui / "Album A" / "A Long Tone Cover.flac"
    _embed_cover(ffmpeg, long_plain, cover, long_covered)
    shutil.copy2(cover, ui / "Album A" / "cover.jpg")
    shutil.copy2(covered, ui / "Album B" / "Track With Cover.flac")
    (ui / "Album B" / "notes.txt").write_text("hello", encoding="utf-8")
    shutil.copy2(track1, ui / "Trash" / "Delete Me.flac")
    shutil.copy2(track1, ui / "Convert In" / "Track To Convert.flac")

    return {
        "root": str(root),
        "api_root": f"local:{api}",
        "ui_root": f"local:{ui}",
        "api_in": f"local:{api / 'in'}",
        "album_a": f"local:{api / 'in' / 'Album A'}",
        "album_b": f"local:{api / 'in' / 'Album B'}",
        "cover_only": f"local:{api / 'in' / 'Cover Only'}",
        "track1": f"local:{track1}",
        "track2": f"local:{track2}",
        "covered": f"local:{covered}",
        "cover_jpg": f"local:{cover}",
        "ops": f"local:{api / 'ops'}",
        "out": f"local:{api / 'out'}",
        "work": f"local:{api / 'work'}",
        "tasks": f"local:{api / 'tasks'}",
        "ui_album_a": f"local:{ui / 'Album A'}",
        "ui_album_b": f"local:{ui / 'Album B'}",
        "ui_long": f"local:{ui / 'Album A' / 'A Long Tone Cover.flac'}",
        "ui_track1": f"local:{ui / 'Album A' / 'Track One.flac'}",
        "ui_covered": f"local:{ui / 'Album B' / 'Track With Cover.flac'}",
        "ui_track2": f"local:{ui / 'Album A' / 'Track Two.wav'}",
        "ui_trash": f"local:{ui / 'Trash'}",
        "ui_convert_in": f"local:{ui / 'Convert In'}",
        "ui_out": f"local:{ui / 'out'}",
        "ui_delete_me": f"local:{ui / 'Trash' / 'Delete Me.flac'}",
        "ui_convert_track": f"local:{ui / 'Convert In' / 'Track To Convert.flac'}",
    }
