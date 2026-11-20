# -*- coding: utf-8 -*-
"""App 更新检查：GitHub Releases，严格超时，不把网络故障抛给启动流程。

生产版查 ``releases/latest``（非 prerelease）；测试版（Action/debug、.dev 包）
查 ``releases/tags/debug-latest``。测试通道的 APK 资产名由 CI 写成
``Audio-CPM-<versionName>-<versionCode>-debug.apk``，所以同一 versionName
重新打包也能靠 versionCode 判断是否更新。

这里只做“检查 + 给出资产链接”，下载由前端调用 Android DownloadManager；
网络不可用时返回 ok=false，调用方可以完全忽略，不会阻塞 app 启动。
"""
import asyncio
import copy
import json
import os
import re
import time
from datetime import datetime, timezone

import httpx

from .config import DATA_DIR

REPO = "olddriverdoge/Audio-CPM"
RELEASES_API = "https://api.github.com/repos/%s/releases" % REPO
DEFAULT_RELEASE_FEED = RELEASES_API + "/latest"
DEFAULT_TEST_FEED = RELEASES_API + "/tags/debug-latest"
CACHE_FILE = os.path.join(DATA_DIR, "ac2_update_cache.json")
CACHE_TTL = max(30, int(os.environ.get("AC2_UPDATE_CACHE_TTL", "600") or 600))
HTTP_TIMEOUT = max(1.0, float(os.environ.get("AC2_UPDATE_HTTP_TIMEOUT", "4") or 4))

_ASSET_RE = re.compile(
    r"^Audio-CPM-(?P<version>[0-9]+(?:\.[0-9]+)*)(?:-(?P<code>[0-9]+))?(?:-debug)?\.apk$",
    re.IGNORECASE,
)
_CACHE = {}


def _channel_feeds():
    """允许测试/自托管环境覆盖，但默认只指向本仓库的两个固定 feed。"""
    return {
        "release": os.environ.get("AC2_UPDATE_RELEASE_FEED", DEFAULT_RELEASE_FEED).strip()
        or DEFAULT_RELEASE_FEED,
        "test": os.environ.get("AC2_UPDATE_TEST_FEED", DEFAULT_TEST_FEED).strip()
        or DEFAULT_TEST_FEED,
    }


def _config():
    version = (os.environ.get("AC2_APP_VERSION") or "").strip()
    code_raw = (os.environ.get("AC2_APP_VERSION_CODE") or "0").strip()
    try:
        code = int(code_raw)
    except Exception:
        code = 0
    channel = (os.environ.get("AC2_UPDATE_CHANNEL") or "release").strip().lower()
    if channel not in ("release", "test"):
        channel = "release"
    return version, code, channel


def app_meta():
    """当前安装包元信息，供 /api/capabilities 与更新检查共用。"""
    version, code, channel = _config()
    return {
        "app_version": version,
        "app_version_code": code,
        "update_channel": channel,
        "app_package": (os.environ.get("AC2_APP_PACKAGE") or "").strip(),
    }


def _parse_version(value):
    parts = []
    for p in re.split(r"[^0-9]+", str(value or "")):
        if p:
            try:
                parts.append(int(p))
            except Exception:
                pass
    return tuple(parts)


def _asset_version(name):
    """返回 (versionName, versionCode或0)；非版本化资产返回 (None, 0)。"""
    m = _ASSET_RE.match(str(name or "").strip())
    if not m:
        return None, 0
    code = 0
    if m.group("code"):
        try:
            code = int(m.group("code"))
        except Exception:
            code = 0
    return m.group("version"), code


def _asset_key(asset):
    version, code = _asset_version(asset.get("name"))
    return (code, _parse_version(version), str(asset.get("updated_at") or ""))


def _is_newer(latest_version, latest_code, current_version, current_code):
    if latest_version is None:
        return False
    if latest_code > 0 and current_code > 0:
        return latest_code > current_code
    return _parse_version(latest_version) > _parse_version(current_version)


def _short_body(body):
    return str(body or "").strip()[:4000]


def _asset_payload(asset):
    if not asset:
        return None
    return {
        "name": asset.get("name") or "",
        "url": asset.get("browser_download_url") or "",
        "size": asset.get("size") or 0,
        "updated_at": asset.get("updated_at") or asset.get("created_at") or "",
    }


def _release_payload(release):
    if not release:
        return None
    return {
        "tag": release.get("tag_name") or "",
        "name": release.get("name") or release.get("tag_name") or "",
        "body": _short_body(release.get("body")),
        "html_url": release.get("html_url") or "",
        "published_at": release.get("published_at") or release.get("created_at") or "",
        "prerelease": bool(release.get("prerelease")),
    }


def _result(channel, current_version, current_code, release=None, asset=None,
            update_available=False, reason="", error=None, message=""):
    version, code = _asset_version(asset.get("name")) if asset else (None, 0)
    result = {
        "ok": error is None,
        "channel": channel,
        "current_version": current_version or "",
        "current_version_code": current_code,
        "latest_version": version or "",
        "latest_version_code": code,
        "update_available": bool(update_available and asset),
        "reason": reason,
        "release": _release_payload(release),
        "asset": _asset_payload(asset),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    if error is not None:
        result["error"] = error
        result["message"] = message
    return result


def _select_asset(release, channel):
    assets = [
        a for a in (release or {}).get("assets", [])
        if str(a.get("name") or "").lower().endswith(".apk")
    ]
    if channel == "test":
        candidates = [a for a in assets if "debug" in str(a.get("name") or "").lower()]
    else:
        candidates = [a for a in assets if "debug" not in str(a.get("name") or "").lower()]
    candidates = [a for a in candidates if _asset_version(a.get("name"))[0]]
    return max(candidates, key=_asset_key) if candidates else None


def _cache_get(channel):
    item = _CACHE.get(channel)
    if not item:
        _load_cache()
        item = _CACHE.get(channel)
    if not item:
        return None
    if time.time() - float(item.get("ts") or 0) > CACHE_TTL:
        return None
    return copy.deepcopy(item.get("payload") or {})


def _cache_put(channel, payload):
    _CACHE[channel] = {"ts": time.time(), "payload": copy.deepcopy(payload)}
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_CACHE, f, ensure_ascii=False)
    except Exception:
        pass


def _load_cache():
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            _CACHE.update(data)
    except Exception:
        pass


async def _fetch_release(url):
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Audio-CPM-update-check",
    }
    timeout = httpx.Timeout(HTTP_TIMEOUT, connect=min(2.5, HTTP_TIMEOUT))
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
        return await client.get(url)


async def check_update(channel=None, force=False):
    """检查更新；任何异常均转成结构化失败结果，不抛出。"""
    current_version, current_code, configured_channel = _config()
    selected = (channel or configured_channel or "release").strip().lower()
    if selected not in ("release", "test"):
        selected = configured_channel

    if not current_version:
        return _result(selected, current_version, current_code, error="current_version_missing",
                       message="当前构建未提供版本号")

    if not force:
        cached = _cache_get(selected)
        if cached:
            cached["cache_hit"] = True
            return cached

    feed = _channel_feeds().get(selected, DEFAULT_RELEASE_FEED)
    try:
        response = await asyncio.wait_for(_fetch_release(feed), timeout=HTTP_TIMEOUT + 1.0)
        if response.status_code == 404:
            return _result(selected, current_version, current_code, error="no_release",
                           message="暂时没有可用的发布记录")
        if response.status_code == 403:
            return _result(selected, current_version, current_code, error="rate_limit",
                           message="GitHub API 暂时限流，稍后再试")
        if response.status_code != 200:
            return _result(selected, current_version, current_code, error="http_%s" % response.status_code,
                           message="GitHub 返回 HTTP %s" % response.status_code)
        release = response.json()
    except asyncio.TimeoutError:
        return _result(selected, current_version, current_code, error="timeout",
                       message="检查更新超时，不影响使用")
    except httpx.TimeoutException:
        return _result(selected, current_version, current_code, error="timeout",
                       message="检查更新超时，不影响使用")
    except Exception as exc:
        return _result(selected, current_version, current_code, error="network",
                       message="检查更新失败：%s" % str(exc)[:180])

    asset = _select_asset(release, selected)
    if not asset:
        return _result(selected, current_version, current_code, release=release,
                       error="no_apk", message="发布记录里没有可下载的 APK")

    latest_version, latest_code = _asset_version(asset.get("name"))
    update = _is_newer(latest_version, latest_code, current_version, current_code)
    result = _result(
        selected, current_version, current_code, release=release, asset=asset,
        update_available=update,
        reason="newer" if update else "up_to_date",
    )
    _cache_put(selected, result)
    return result
