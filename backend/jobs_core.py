# -*- coding: utf-8 -*-
"""音频任务核心：转换 / 整理标签 / 替换封面 / 检查标签 / 单文件标签编辑。"""
import os, sys, re, json, time, uuid, queue, threading, subprocess, asyncio, errno
import multiprocessing, traceback, tempfile, hashlib, mimetypes, shutil
from typing import List, Tuple, Optional, Dict, Any, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from .config import MEDIA_EXTS, IMAGE_EXTS
from . import ffbin
from . import cancel
from .meta import probe_file_detail
from .ffmpeg import (execute, clean_text, parse_format_spec,
                     pick_audio_codec, execute_ffmpeg_with_progress,
                     collect_media_recursive, check_hwaccel_support, get_max_workers)

HWACCEL_ENABLED = False

def short_err(err, limit=300):
    """把 ffmpeg 的 stderr 压缩成一行可读错误（避免前端日志刷屏）。"""
    lines = [l.strip() for l in str(err or '').splitlines() if l.strip()]
    if not lines:
        return 'unknown'
    keys = ('Error', 'error', 'Invalid', 'Protocol', 'No such', 'Permission',
            'not found', 'Unsupported', 'failed', 'Failed', 'exists')
    picked = [l for l in lines if any(k in l for k in keys)]
    msg = ' | '.join(picked[-2:]) if picked else lines[-1]
    return msg[:limit]


def expand_only_files(only_files):
    """把「选中的文件/文件夹」统一展开成文件列表；None 表示未选择（走整目录递归）。"""
    if not only_files:
        return None
    out = []
    seen = set()
    for f in only_files:
        try:
            if os.path.isfile(f):
                if f not in seen:
                    seen.add(f); out.append(f)
            elif os.path.isdir(f):
                for g in collect_media_recursive(f, MEDIA_EXTS):
                    if g not in seen:
                        seen.add(g); out.append(g)
        except Exception:
            continue
    return out


# ============================================================
# 核心任务（同原版）
# ============================================================
def convert_album_v2(iopath, format_spec, output_dir=None, delete_source=True,
                     only_files=None, progress_cb=None):
    params = parse_format_spec(format_spec)
    codec, bits, sr, bitrate = params['codec'], params['bits'], params['sr'], params['bitrate']
    audio_codec = pick_audio_codec(codec, bits)
    only_files = expand_only_files(only_files)
    files = only_files if only_files is not None \
            else collect_media_recursive(iopath, MEDIA_EXTS)
    total = len(files)
    result = {"success": 0, "failed": 0, "skipped": 0, "files": []}
    if progress_cb:
        progress_cb({"event":"plan","phase":"convert","total":total,
                     "folder":iopath,"spec":format_spec,"codec":codec})
    # 编码器能力校验：mp3/ogg/opus 在 app 包里没有编译，PC/Termux 走 PATH 时通常有
    unsupported = None
    if not audio_codec:
        unsupported = '当前版本不支持 %s 输出（ffmpeg 未编译对应编码器）' % codec.upper()
    elif not ffbin.has_encoder(audio_codec):
        unsupported = '当前 ffmpeg 缺少 %s 编码器，无法输出 %s' % (audio_codec, codec.upper())
    if unsupported:
        for i, f in enumerate(files):
            result["failed"] += 1
            result["files"].append({"file": f, "status": "error", "error": unsupported})
            if progress_cb:
                progress_cb({"event":"file_done","index":i+1,"total":total,
                             "file":f,"status":"error","error":unsupported})
        return result
    for idx, input_file in enumerate(files):
        cancel.check()
        src_ext = os.path.splitext(input_file)[1].lower().lstrip('.')
        if src_ext == codec and not (bits or sr or bitrate):
            result["skipped"] += 1
            if progress_cb:
                progress_cb({"event":"file_skip","index":idx+1,"total":total,
                             "file":input_file,"reason":"same_codec"})
            continue
        detail = probe_file_detail(input_file)
        if progress_cb:
            progress_cb({"event":"probe","index":idx+1,"total":total,
                         "file":input_file,"detail":detail})
        if detail.get('error'):
            result["failed"] += 1
            result["files"].append({"file":input_file,"status":"error","error":detail['error']})
            if progress_cb:
                progress_cb({"event":"file_done","index":idx+1,"total":total,
                             "file":input_file,"status":"error","error":detail['error']})
            continue
        if output_dir:
            try:
                rel = os.path.relpath(input_file, iopath)
            except Exception:
                rel = os.path.basename(input_file)
            if rel.startswith('..'):      # 选中的文件不在当前目录下：避免输出路径逃逸
                rel = os.path.basename(input_file)
            rel_dir = os.path.dirname(rel)
            out_dir = os.path.join(output_dir, rel_dir) if rel_dir else output_dir
        else:
            out_dir = os.path.dirname(input_file)
        try: os.makedirs(out_dir, exist_ok=True)
        except Exception as e:
            result["failed"] += 1
            result["files"].append({"file":input_file,"status":"error","error":str(e)}); continue
        base = os.path.splitext(os.path.basename(input_file))[0]
        output_file = os.path.join(out_dir, f"{base}.{codec}")
        temp_file   = os.path.join(out_dir, f".{base}.ac2tmp.{codec}")
        cmd = ffbin.cmd('-y', '-i', input_file, '-map', '0',
               '-c:a', audio_codec, '-c:v', 'copy')
        if codec in ('mp3','m4a','aac'):
            cmd += ['-b:a', f'{bitrate}k'] if bitrate else ['-b:a','320k']
        else:
            if bits:
                fmt_bits = 16 if bits <= 16 else 32   # flac/alac 只接受 s16/s32
                cmd += ['-sample_fmt', f's{fmt_bits}']
            if sr:
                cmd += ['-ar', str(sr)]
        if codec in ('mp3','m4a'): cmd += ['-id3v2_version','3']
        cmd += [temp_file]
        total_sec = 0.0
        try: total_sec = float(detail.get('format',{}).get('duration') or 0)
        except Exception: pass
        cb = (lambda pct, i=idx: progress_cb({"event":"file_progress","index":i+1,
                                              "total":total,"file":input_file,"percent":pct})) \
             if progress_cb else None
        ok, err = execute_ffmpeg_with_progress(cmd, total_sec, cb,
                                              cancel_check=cancel.is_cancelled)
        if ok and os.path.exists(temp_file):
            try:
                try:
                    os.replace(temp_file, output_file)
                except OSError:
                    shutil.move(temp_file, output_file)
                if delete_source and os.path.abspath(input_file) != os.path.abspath(output_file):
                    try: os.remove(input_file)
                    except Exception: pass
                result["success"] += 1
                result["files"].append({"file":input_file,"output":output_file,"status":"ok"})
                if progress_cb:
                    progress_cb({"event":"file_done","index":idx+1,"total":total,
                                 "file":input_file,"output":output_file,"status":"ok"})
            except Exception as e:
                result["failed"] += 1
                result["files"].append({"file":input_file,"status":"error","error":str(e)})
                if progress_cb:
                    progress_cb({"event":"file_done","index":idx+1,"total":total,
                                 "file":input_file,"status":"error","error":str(e)})
        else:
            if os.path.exists(temp_file):
                try: os.remove(temp_file)
                except Exception: pass
            msg = short_err(err)
            result["failed"] += 1
            result["files"].append({"file":input_file,"status":"error","error":msg})
            if progress_cb:
                progress_cb({"event":"file_done","index":idx+1,"total":total,
                             "file":input_file,"status":"error","error":msg})
    return result

def render_name_pattern(pattern: str, fields: dict, fallback: str) -> str:
    if not pattern:
        pattern = "{album_artist} - {title} - {composer} - {album}"
    safe = {k: clean_text(v) if isinstance(v, str) else (v or '') for k, v in fields.items()}
    try:
        name = pattern.format(**{k: safe.get(k,'') for k in
            ['artist','album_artist','title','album','composer','track','disc',
             'filename','year','genre']})
    except Exception:
        name = fallback
    name = (name or '').strip() or fallback
    return re.sub(r'[\\/:*?"<>|]', '_', name)

def manage_single_tags_v2(input_file: str, name_pattern: Optional[str]) -> str:
    """整理单个文件：mutagen 改标签（不再走 ffmpeg）→ 按 pattern 改名。"""
    file_name, extension = os.path.splitext(os.path.basename(input_file))
    detail = probe_file_detail(input_file)
    if detail.get('error'):
        raise Exception(detail['error'])
    tags = {k.lower(): v for k, v in (detail.get('tags') or {}).items()}
    cps = clean_text(tags.get('composer', ''))
    default_label = ''
    parent = os.path.basename(os.path.dirname(input_file))
    if ' - ' in parent:
        default_label = parent.split(' - ')[0].strip()
    raw_artist = tags.get('artist', default_label)
    existing_aartist = clean_text(tags.get('album_artist', ''))
    # 没有 composer 的普通歌曲也必须能重命名：退回 artist / album artist，
    # 而不是把整个目录任务直接判失败；已有 album_artist 时不要覆盖它。
    if not cps:
        cps = clean_text(raw_artist) or existing_aartist or default_label or file_name
        aats = existing_aartist or (default_label or '')
    else:
        aats = raw_artist if raw_artist and raw_artist != cps else (default_label or '')

    edits = {'artist': cps}
    if aats:
        edits['album_artist'] = aats
    if tags.get('comment'):
        cc = re.sub(r'^downloaded from .+?:\s*http.+', '', tags['comment'],
                    flags=re.IGNORECASE | re.DOTALL).strip()
        if cc:
            edits['comment'] = cc
    r = edit_tags_file(input_file, edits, [])
    if not r.get('ok'):
        raise Exception('写入标签失败: ' + (r.get('error') or ''))

    fields = {'artist': cps, 'album_artist': aats, 'title': tags.get('title', ''),
              'album': tags.get('album', ''), 'composer': cps, 'track': tags.get('track', ''),
              'disc': tags.get('disc', ''), 'filename': file_name,
              'year': tags.get('date', '') or tags.get('year', ''), 'genre': tags.get('genre', '')}
    new_base = render_name_pattern(name_pattern, fields, file_name)
    new_name = os.path.join(os.path.dirname(input_file), f"{new_base}{extension}")
    if os.path.abspath(new_name) == os.path.abspath(input_file):
        return input_file
    if os.path.exists(new_name):
        base, ext = os.path.splitext(new_name)
        i = 1
        while os.path.exists(new_name) and i <= 999:
            new_name = f"{base}_{i}{ext}"
            i += 1
    os.rename(input_file, new_name)
    return new_name

def preview_rename(iopath, name_pattern=None, only_files=None, limit=30):
    """只读预览：按重命名规则算出新旧文件名，不写标签、不动文件。"""
    exts = MEDIA_EXTS
    only = expand_only_files(only_files)
    if only is not None:
        files = [f for f in only if os.path.splitext(f)[1].lower() in exts]
    else:
        files = collect_media_recursive(iopath, exts)
    items, seen = [], {}
    for f in files[:max(1, int(limit or 30))]:
        try:
            detail = probe_file_detail(f)
            if detail.get('error'):
                items.append({'file': f, 'error': detail['error']})
                continue
            tags = {k.lower(): v for k, v in (detail.get('tags') or {}).items()}
            cps = clean_text(tags.get('composer', ''))
            parent = os.path.basename(os.path.dirname(f))
            default_label = parent.split(' - ')[0].strip() if ' - ' in parent else ''
            raw_artist = tags.get('artist', default_label)
            aats = raw_artist if raw_artist and raw_artist != cps else (default_label or '')
            base, ext = os.path.splitext(os.path.basename(f))
            fields = {'artist': cps or tags.get('artist', ''), 'album_artist': aats,
                      'title': tags.get('title', ''), 'album': tags.get('album', ''),
                      'composer': cps, 'track': tags.get('track', ''), 'disc': tags.get('disc', ''),
                      'filename': base, 'year': tags.get('date', '') or tags.get('year', ''),
                      'genre': tags.get('genre', '')}
            new_base = render_name_pattern(name_pattern, fields, base)
            new_name = new_base + ext
            # 重名会被自动加 _1/_2，预览里提前标出来
            n = seen.get(new_name.lower(), 0) + 1
            seen[new_name.lower()] = n
            if n > 1:
                new_name = '%s_%d%s' % (new_base, n - 1, ext)
            items.append({'file': os.path.basename(f), 'new': new_name})
        except Exception as e:
            items.append({'file': os.path.basename(f), 'error': short_err(e)})
    return {'total': len(files), 'shown': len(items), 'items': items}


def manage_tags_v2(iopath, format=None, name_pattern=None,
                   only_files=None, progress_cb=None):
    """format 为空表示"所有音频格式"（前端已不再要求选目标格式）。"""
    global HWACCEL_ENABLED
    HWACCEL_ENABLED = check_hwaccel_support()
    exts = {f'.{format.lower()}'} if format else MEDIA_EXTS
    only_files = expand_only_files(only_files)
    if only_files is not None:
        files = [f for f in only_files if os.path.splitext(f)[1].lower() in exts]
    else:
        files = collect_media_recursive(iopath, exts)
    total = len(files)
    result = {"success": 0, "failed": 0, "files": []}
    if progress_cb:
        progress_cb({"event":"plan","phase":"tags","total":total,"folder":iopath,"spec":format})
    for idx, f in enumerate(files):
        cancel.check()
        if progress_cb:
            progress_cb({"event":"probe","index":idx+1,"total":total,
                         "file":f,"detail":probe_file_detail(f)})
        try:
            new_path = manage_single_tags_v2(f, name_pattern)
            result["success"] += 1
            result["files"].append({"file":f,"output":new_path,"status":"ok"})
            if progress_cb:
                progress_cb({"event":"file_done","index":idx+1,"total":total,
                             "file":f,"output":new_path,"status":"ok"})
        except Exception as e:
            result["failed"] += 1
            result["files"].append({"file":f,"status":"error","error":str(e)})
            if progress_cb:
                progress_cb({"event":"file_done","index":idx+1,"total":total,
                             "file":f,"status":"error","error":str(e)})
    return result

# 能内嵌封面的容器（wav/aiff 等放不了 attached_pic，直接跳过）
COVER_EXTS = {'.flac', '.mp3', '.m4a'}


def modify_cover_v2(iopath, formats=None, only_files=None, cover_path=None, progress_cb=None):
    """封面来源二选一：显式传入 cover_path（用户选的图），或退回"目录内第一张图片"。

    不再硬编码只认同文件夹封面：前端可以把任意目录的一张图选进来。
    """
    if cover_path:
        cover_path = os.path.abspath(cover_path)
        if not os.path.isfile(cover_path):
            raise Exception("封面文件不存在: %s" % cover_path)
        if os.path.splitext(cover_path)[1].lower() not in IMAGE_EXTS:
            raise Exception("封面必须是图片文件（jpg/png/bmp/webp）: %s" % cover_path)
    else:
        for name in os.listdir(iopath):
            if os.path.splitext(name)[1].lower() in IMAGE_EXTS:
                cover_path = os.path.join(iopath, name); break
        if not cover_path: raise Exception("未选择封面图片，且当前目录里也没有 jpg/png 等图片")
    exts = {f'.{formats.lower()}'} if formats else COVER_EXTS
    only_files = expand_only_files(only_files)
    if only_files is not None:
        files = [f for f in only_files if os.path.splitext(f)[1].lower() in exts]
    else:
        files = [os.path.join(iopath, n) for n in os.listdir(iopath)
                 if os.path.isfile(os.path.join(iopath, n))
                 and os.path.splitext(n)[1].lower() in exts]
    total = len(files)
    result = {"success": 0, "failed": 0, "files": []}
    if progress_cb:
        progress_cb({"event":"plan","phase":"cover","total":total,
                     "folder":iopath,"spec":formats,"cover":cover_path})
    for idx, f in enumerate(files):
        cancel.check()
        try:
            ext = os.path.splitext(f)[1]
            # ffmpeg 靠扩展名判断容器；临时文件若没有 .flac/.mp3/.m4a 扩展，
            # 会报 "Unable to find a suitable output format"，导致封面任务全失败。
            temp1 = os.path.join(iopath, f".{os.path.basename(f)}.ac2nocc{ext}")
            temp2 = os.path.join(iopath, f".{os.path.basename(f)}.ac2cc{ext}")
            execute(ffbin.cmd('-y','-i',f,'-map','0','-map','-0:v',
                     '-c','copy','-metadata','cover=', temp1))
            ok, err = execute(ffbin.cmd('-y','-i',temp1,'-i',cover_path,
                               '-map','0','-map','1','-c','copy',
                               '-disposition:1','attached_pic', temp2))
            if ok and os.path.exists(temp2):
                os.replace(temp2, f)
                result["success"] += 1
                result["files"].append({"file":f,"status":"ok"})
                if progress_cb:
                    progress_cb({"event":"file_done","index":idx+1,"total":total,
                                 "file":f,"status":"ok"})
            else:
                raise Exception(short_err(err))
            for t in (temp1, temp2):
                if os.path.exists(t):
                    try: os.remove(t)
                    except Exception: pass
        except Exception as e:
            result["failed"] += 1
            result["files"].append({"file":f,"status":"error","error":str(e)})
            if progress_cb:
                progress_cb({"event":"file_done","index":idx+1,"total":total,
                             "file":f,"status":"error","error":str(e)})
    return result

def check_tags_v2(iopath, format='flac', only_files=None, progress_cb=None):
    only_files = expand_only_files(only_files)
    files = only_files if only_files is not None \
            else collect_media_recursive(iopath, {f'.{format.lower()}'})
    total = len(files)
    result = {"files": [], "total": total}
    if progress_cb:
        progress_cb({"event":"plan","phase":"check","total":total,"folder":iopath,"spec":format})
    for idx, f in enumerate(files):
        cancel.check()
        d = probe_file_detail(f)
        result["files"].append(d)
        if progress_cb:
            progress_cb({"event":"probe","index":idx+1,"total":total,"file":f,"detail":d})
    return result

# ============================================================
# 编辑标签
# ============================================================
EASY_KEYS = {
    'title': 'title', 'artist': 'artist', 'album': 'album',
    'album_artist': 'albumartist', 'albumartist': 'albumartist',
    'composer': 'composer', 'track': 'tracknumber', 'tracknumber': 'tracknumber',
    'disc': 'discnumber', 'discnumber': 'discnumber', 'year': 'date', 'date': 'date',
    'genre': 'genre', 'comment': 'comment', 'copyright': 'copyright',
    'encoded_by': 'encodedby', 'lyrics': 'lyrics',
}


def _easy_key(k):
    k = str(k or '').strip()
    return EASY_KEYS.get(k.lower(), k)


def edit_tags_file(path: str, tags_edit: Dict[str, str], tags_remove: List[str]) -> dict:
    """标签写入只走 mutagen：copy → 写临时文件 → 校验 → os.replace（失败不动原文件）。"""
    if not os.path.isfile(path):
        return {"ok": False, "error": "file not found"}
    try:
        import mutagen
    except Exception:
        return {"ok": False, "error": "mutagen not installed"}
    ext = os.path.splitext(path)[1].lower()
    if ext in ('.ape', '.wv', '.dsf', '.dff'):
        return {"ok": False, "error": "该格式暂不支持写入标签"}
    tmp = os.path.join(os.path.dirname(path), f".{os.path.basename(path)}.ac2edit")
    warnings = []
    try:
        shutil.copy2(path, tmp)
        f = mutagen.File(tmp, easy=True)
        if f is None:
            return {"ok": False, "error": "无法解析该文件的标签"}
        for k in (tags_remove or []):
            key = _easy_key(k)
            try:
                del f[key]
            except (KeyError, ValueError):
                pass
        for k, v in (tags_edit or {}).items():
            key = _easy_key(k)
            val = '' if v is None else str(v)
            try:
                if val.strip() == '':
                    try:
                        del f[key]
                    except KeyError:
                        pass
                else:
                    f[key] = val
            except Exception as e:
                warnings.append(f"{k}: {str(e)[:80]}")
        f.save()
        chk = mutagen.File(tmp, easy=True)
        if chk is None:
            raise RuntimeError('写入后无法重新解析')
        for k, v in (tags_edit or {}).items():
            if v is None or str(v).strip() == '':
                continue
            got = chk.get(_easy_key(k))
            if isinstance(got, (list, tuple)):
                got = ' / '.join(str(x) for x in got)
            if got is None:
                warnings.append(f"{k}: 写入后未读回")
        os.replace(tmp, path)
        if warnings:
            return {"ok": True, "warnings": warnings[:5]}
        return {"ok": True}
    except Exception as e:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass
        return {"ok": False, "error": str(e)[:300]}
