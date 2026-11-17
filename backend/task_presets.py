# -*- coding: utf-8 -*-
"""任务预设（转码/标签等参数）的读写；与前端工作台“场景（Scene）”无关。"""
import os
import json

from .config import TASK_PRESETS_FILE

# ============================================================
# 预设
# ============================================================
DEFAULT_TASK_PRESETS = {
    "转FLAC-24-48": {"task":"convert","format":"FLAC-24-48","output_dir":"","delete_source":True,"also_tags":False},
    "转FLAC-16-44": {"task":"convert","format":"FLAC-16-44","output_dir":"","delete_source":True,"also_tags":False},
    "转FLAC-24-96": {"task":"convert","format":"FLAC-24-96","output_dir":"","delete_source":True,"also_tags":False},
    "转MP3-320":    {"task":"convert","format":"MP3-320","output_dir":"","delete_source":True,"also_tags":False},
    "整理标签":      {"task":"tags","format":"flac","name_pattern":"{album_artist} - {title} - {composer} - {album}"},
    "替换封面":      {"task":"cover","format":"flac"},
    "检查标签":      {"task":"check","format":"flac"},
}

def load_task_presets():
    if os.path.exists(TASK_PRESETS_FILE):
        try:
            with open(TASK_PRESETS_FILE,'r',encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get('presets'), dict):
                return data
        except Exception: pass
    return {"presets": dict(DEFAULT_TASK_PRESETS)}

def save_task_presets(data):
    with open(TASK_PRESETS_FILE,'w',encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
