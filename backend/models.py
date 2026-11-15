# -*- coding: utf-8 -*-
"""请求体模型。"""
from typing import List, Optional, Dict

from pydantic import BaseModel

class StartTaskReq(BaseModel):
    task: str
    path: str
    format: Optional[str] = None
    output_dir: Optional[str] = ""
    delete_source: Optional[bool] = True
    name_pattern: Optional[str] = ""
    also_tags: Optional[bool] = False
    only_files: Optional[List[str]] = None

class EditTagsReq(BaseModel):
    path: str
    tags: Dict[str, str] = {}
    remove: List[str] = []


class PlayReq(BaseModel):
    path: str
    player: Optional[str] = ''
    activity: Optional[str] = ''

class MoveReq(BaseModel):
    sources: List[str]
    target: str
    conflict: str = 'skip'

class MkdirReq(BaseModel):
    parent: str
    name: str

class RmdirReq(BaseModel):
    path: str

class RenameDirReq(BaseModel):
    path: str
    new_name: str

class DeleteReq(BaseModel):
    paths: List[str]
