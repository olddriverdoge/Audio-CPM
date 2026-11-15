# -*- coding: utf-8 -*-
"""任务取消令牌（线程局部）：长任务在循环里调 check()/is_cancelled()。"""
import threading


class Cancelled(Exception):
    pass


_local = threading.local()


def current():
    return getattr(_local, 'ev', None)


def set_current(ev):
    _local.ev = ev


def clear():
    _local.ev = None


def is_cancelled():
    ev = current()
    return bool(ev is not None and ev.is_set())


def check():
    if is_cancelled():
        raise Cancelled('cancelled')
