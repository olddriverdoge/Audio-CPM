# -*- coding: utf-8 -*-
"""后台任务调度：线程 + 队列 + SSE + 取消 + 并发上限 + 持久化。

- 取消：POST /api/task/{id}/cancel → 置 cancel 事件；ffmpeg 子进程被 terminate/kill，临时文件清理
- 并发：全局信号量（AC2_TASK_CONCURRENCY，默认 1），超限排队（status=queued）
- 持久化：DATA_DIR/ac2_tasks.json；重启后 running/queued 标记为 interrupted
"""
import json
import os
import queue
import threading
import time
import traceback
import uuid

from .config import TASKS_FILE
from . import cancel

tasks = {}
tasks_lock = threading.Lock()
_sem = threading.Semaphore(max(1, int(os.environ.get('AC2_TASK_CONCURRENCY', '1'))))
_last_persist = 0.0
PERSIST_FIELDS = ('id', 'description', 'status', 'created', 'started', 'finished', 'percent', 'error')


def _persist(force=False):
    global _last_persist
    now = time.time()
    if not force and now - _last_persist < 2.0:
        return
    _last_persist = now
    try:
        with tasks_lock:
            data = []
            for tid, t in tasks.items():
                item = {k: t.get(k) for k in PERSIST_FIELDS}
                item['id'] = tid
                data.append(item)
        tmp = TASKS_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'tasks': data}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, TASKS_FILE)
    except Exception:
        pass


def load_tasks():
    """启动时调用：读取历史任务，把 running/queued 标成 interrupted。"""
    try:
        with open(TASKS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        items = data.get('tasks') if isinstance(data, dict) else []
    except Exception:
        return []
    out = []
    changed = False
    for it in (items or []):
        if not isinstance(it, dict) or not it.get('id'):
            continue
        st = it.get('status')
        if st in ('running', 'queued'):
            it['status'] = 'interrupted'
            it['error'] = '上次未完成（进程已退出）'
            changed = True
        out.append(it)
    if changed:
        try:
            tmp = TASKS_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump({'tasks': out}, f, ensure_ascii=False, indent=1)
            os.replace(tmp, TASKS_FILE)
        except Exception:
            pass
    return out


def list_tasks(limit=20):
    out = []
    try:
        with open(TASKS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        out = (data.get('tasks') or [])[-limit:]
    except Exception:
        out = []
    # 合并内存中正在跑的状态
    with tasks_lock:
        for tid, t in tasks.items():
            for it in out:
                if it.get('id') == tid:
                    it['status'] = t.get('status')
                    it['percent'] = t.get('percent', 0)
                    break
            else:
                out.append({k: t.get(k) for k in PERSIST_FIELDS} | {'id': tid})
    return out[-limit:]


def _finish(tid, status, result=None, error=None):
    with tasks_lock:
        t = tasks.get(tid)
        if not t:
            return
        t['status'] = status
        t['result'] = result
        t['finished'] = time.time()
        if error:
            t['error'] = error
    _persist(force=True)


def create_task(task_fn, description):
    tid = uuid.uuid4().hex[:12]
    q = queue.Queue()
    ev = threading.Event()
    with tasks_lock:
        tasks[tid] = {
            'queue': q, 'status': 'queued', 'description': description,
            'result': None, 'created': time.time(), 'started': None,
            'finished': None, 'cancel': ev, 'percent': 0,
        }
    _persist(force=True)

    def run():
        got = _sem.acquire(timeout=3600)
        if not got:
            _finish(tid, 'error', error='等待排队超时')
            q.put({'type': 'error', 'data': {'error': '等待排队超时'}})
            q.put(None)
            return
        try:
            with tasks_lock:
                t = tasks.get(tid)
                cancelled_at_start = bool(t and t['cancel'].is_set())
                if t and not cancelled_at_start:
                    t['status'] = 'running'
                    t['started'] = time.time()
            if cancelled_at_start:
                _finish(tid, 'cancelled')
                q.put({'type': 'cancelled', 'data': {}})
                q.put(None)
                return
            _persist(force=True)
            cancel.set_current(ev)

            def cb(event):
                try:
                    pct = event.get('percent')
                    if pct is None and event.get('total'):
                        idx = event.get('index') or 0
                        pct = int(idx / max(1, event['total']) * 100)
                    with tasks_lock:
                        t = tasks.get(tid)
                        if t is not None and pct is not None:
                            t['percent'] = int(pct)
                    _persist()
                except Exception:
                    pass
                q.put({'type': 'progress', 'data': event})

            try:
                result = task_fn(cb)
                if ev.is_set():
                    _finish(tid, 'cancelled', result)
                    q.put({'type': 'cancelled', 'data': {'result': result}})
                else:
                    _finish(tid, 'done', result)
                    q.put({'type': 'done', 'data': result})
            except cancel.Cancelled:
                _finish(tid, 'cancelled')
                q.put({'type': 'cancelled', 'data': {}})
            except Exception as e:
                tb = traceback.format_exc()
                _finish(tid, 'error', {'error': str(e), 'traceback': tb}, error=str(e))
                q.put({'type': 'error', 'data': {'error': str(e), 'traceback': tb}})
            finally:
                cancel.clear()
                q.put(None)
        finally:
            try:
                _sem.release()
            except Exception:
                pass

    threading.Thread(target=run, daemon=True).start()
    return tid


def cancel_task(tid):
    with tasks_lock:
        t = tasks.get(tid)
        if not t:
            return {'ok': False, 'error': 'task not found'}
        t['cancel'].set()
        st = t.get('status')
    if st == 'queued':
        _finish(tid, 'cancelled')
        try:
            t['queue'].put({'type': 'cancelled', 'data': {}})
            t['queue'].put(None)
        except Exception:
            pass
    _persist(force=True)
    return {'ok': True, 'status': 'cancelled' if st == 'queued' else 'cancelling'}
