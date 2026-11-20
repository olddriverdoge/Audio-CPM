"""Browser interaction regression suite for Audio-CPM.

This runs the real frontend in Chromium against the real backend, using the
isolated fixture tree.  It deliberately avoids Android-only bridge calls;
those are covered by the API fallback tests and must still be verified on a
real device.
"""
from __future__ import annotations

import os
import shutil
import time
import traceback
from pathlib import Path
from typing import Any, Dict

from playwright.sync_api import sync_playwright


class CheckFailure(AssertionError):
    pass


class UiRegression:
    def __init__(self, base_url: str, fixture: Dict[str, str], shot_dir: Path):
        self.base = base_url.rstrip("/")
        self.fx = fixture
        self.shot_dir = Path(shot_dir)
        self.shot_dir.mkdir(parents=True, exist_ok=True)
        self.results = []
        self.console_errors = []
        self.page_errors = []
        self._idx = 0
        # 默认不截图：日常回归用 DOM/文本断言，报告里只保留结构化结果。
        self.screenshots = os.environ.get("AC2_UI_SCREENSHOTS", "0") == "1"

    def require(self, cond: bool, msg: str):
        if not cond:
            raise CheckFailure(msg)

    def ok(self, name: str, detail: str = ""):
        self.results.append({"name": name, "ok": True, "detail": detail})

    def fail(self, name: str, detail: str):
        self.results.append({"name": name, "ok": False, "detail": detail})

    def shot(self, stem: str) -> str:
        if not self.screenshots:
            return ""
        self._idx += 1
        path = self.shot_dir / f"{self._idx:02d}-{stem}.png"
        try:
            self.page.screenshot(path=str(path), full_page=False)
        except Exception:
            return ""
        return str(path)

    def check(self, name: str, fn, shot: str = ""):
        try:
            detail = fn() or ""
            if isinstance(detail, dict):
                detail = str(detail)[:300]
            self.ok(name, str(detail))
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
            if shot:
                try:
                    self.shot(shot)
                except Exception:
                    pass
            self.fail(name, detail)

    def fresh_page(self, context=None):
        if context is not None:
            self.context.close()
            self.context = context
        self.page = self.context.new_page()
        self.page.set_default_timeout(9000)
        self.page.on("console", self._on_console)
        self.page.on("pageerror", self._on_pageerror)
        self.page.goto(self.base + "/?defaults=0", wait_until="load", timeout=20000)
        self.page.evaluate("localStorage.clear()")
        self.page.reload(wait_until="load", timeout=20000)
        self.page.wait_for_function(
            "typeof App !== 'undefined' && document.querySelectorAll('#scene-tabs .scene-chip').length > 0",
            timeout=15000,
        )
        self.page.wait_for_timeout(900)

    def _on_console(self, msg):
        if msg.type == "error":
            text = msg.text or ""
            # Auditioning a directory with no embedded cover intentionally gets
            # a 404 from /api/thumb; a missing favicon is equally harmless.
            if "favicon" in text.lower() or "404 (Not Found)" in text:
                return
            self.console_errors.append(text)

    def _on_pageerror(self, err):
        self.page_errors.append(str(err))

    def click_scene(self, scene_id: str):
        self.page.locator(f'.sh-card[data-id="{scene_id}"]').click()
        self.page.wait_for_timeout(650)

    def raise_browse(self):
        # In multi-window scenes the target/task windows can cover the left
        # side of the browser.  Clicking the visible right side of the title
        # bar is the same gesture a user uses to bring a window forward.
        head = self.page.locator("#fw-browse-head")
        box = head.bounding_box()
        x = max(4, (box["width"] if box else 800) - 90)
        head.click(position={"x": x, "y": 8})
        self.page.wait_for_timeout(250)

    def open_dir(self, uri: str):
        self.raise_browse()
        loc = self.page.locator(f'#view1 .item.dir[data-dir-path="{uri}"]')
        loc.wait_for(state="visible", timeout=8000)
        loc.click()
        self.page.wait_for_timeout(650)

    def wait_file(self, uri: str):
        loc = self.page.locator(f'#view1 .item.file[data-path="{uri}"]')
        loc.wait_for(state="visible", timeout=8000)
        return loc

    # ---------- tests ----------
    def test_home_and_settings(self):
        def home():
            self.require(self.page.locator("#scene-home").is_visible(), "scene home hidden")
            self.require(self.page.locator("#sh-grid .sh-card").count() == 3, "expected 3 built-in scenes")
            self.require(self.page.locator("#btn-player-cfg").is_visible(), "settings button missing")
            return "3 scene cards"
        self.check("home renders built-in scenes", home, "home")

        def settings_hint():
            self.page.locator("#btn-player-cfg").click()
            self.page.locator("#player-sheet").wait_for(state="visible", timeout=5000)
            hint = self.page.locator(".lang-hint").inner_text().strip()
            self.require(hint.startswith("Can't find your language?"), f"hint: {hint}")
            self.require("http://127.0.0.1:8765/" in hint, "URL missing from hint")
            self.require("auto-translate" in hint, "auto-translate missing")
            link = self.page.locator("#lang-hint-open")
            self.require(link.count() == 1, "language hint link missing")
            self.require(link.get_attribute("href") == "http://127.0.0.1:8765/",
                         f"language link href: {link.get_attribute('href')!r}")
            self.require(link.get_attribute("target") == "_blank", "language link should open a browser tab")
            bg = self.page.locator("#bg-status").inner_text().strip()
            self.require("仅 Android App 内可配置后台运行" in bg, f"browser background status: {bg!r}")
            self.require(self.page.locator("#bg-allow").is_disabled(), "browser background action should be disabled")
            return hint
        self.check("settings language hint is English", settings_hint, "settings-hint")

        def hint_survives_locale():
            before = self.page.locator(".lang-hint").inner_text().strip()
            # Changing the locale reloads the page by design (I18n.setLocale).
            # Dispatch through the DOM and wait for the reload rather than
            # expecting select_option to survive it.
            self.page.evaluate(
                "() => { const s = document.getElementById('lang-select'); "
                "s.value = 'ja-JP'; s.dispatchEvent(new Event('change')); }"
            )
            self.page.wait_for_timeout(1200)
            self.page.wait_for_load_state("load", timeout=10000)
            if not self.page.locator("#player-sheet").is_visible():
                self.page.locator("#btn-player-cfg").click()
                self.page.locator("#player-sheet").wait_for(state="visible", timeout=5000)
            after = self.page.locator(".lang-hint").inner_text().strip()
            self.require(after == before, f"hint changed after locale switch: {after!r}")
            # The surrounding UI should actually switch languages.
            heading = self.page.locator("#player-sheet h3").first.inner_text()
            self.require(heading != "设置", f"settings heading did not translate: {heading!r}")
            self.page.evaluate(
                "() => { const s = document.getElementById('lang-select'); "
                "s.value = 'zh-CN'; s.dispatchEvent(new Event('change')); }"
            )
            self.page.wait_for_timeout(1200)
            self.page.wait_for_load_state("load", timeout=10000)
            return f"{heading} -> hint unchanged"
        self.check("hint stays English after language switch", hint_survives_locale, "locale-switch")

        if self.page.locator("#player-sheet").is_visible():
            self.page.locator("#cfg-cancel").click()
            self.page.wait_for_timeout(250)

    def test_update_ui(self):
        def settings_update():
            if not self.page.locator("#player-sheet").is_visible():
                self.page.locator("#btn-player-cfg").click()
                self.page.locator("#player-sheet").wait_for(state="visible", timeout=5000)
            current = self.page.locator("#upd-current").inner_text().strip()
            channel = self.page.locator("#upd-channel-badge").inner_text().strip()
            self.require(current == "v0.5.3", f"current version: {current!r}")
            self.require("正式版" in channel, f"channel: {channel!r}")
            self.page.locator("#upd-check").click()
            self.page.wait_for_function(
                "() => { const b=document.querySelector('#upd-check'); "
                "return b && !b.disabled && document.querySelector('#upd-status').textContent.includes('已是最新版本'); }",
                timeout=10000,
            )
            status = self.page.locator("#upd-status").inner_text().strip()
            self.require("0.5.3" in status, f"status: {status!r}")
            # 模拟 Android 桥，验证语言链接走外部浏览器、后台状态与按钮可用；
            # 这里只做 DOM/返回值断言，不截图。
            self.page.evaluate("""() => {
                window.__langUrl = '';
                window.AudioCpmNative = {
                    openExternalUrl: url => { window.__langUrl = url; return '{"ok":true}'; },
                    backgroundStatus: () => '{"ok":true,"battery_optimized":true,"ignoring_battery":false,"manufacturer":"Xiaomi"}',
                    requestBackground: () => '{"ok":true}',
                    openAppSettings: () => '{"ok":true}',
                    openBatterySettings: () => '{"ok":true}',
                    downloadUpdate: () => '{"ok":false}'
                };
                BackgroundKeeper.refresh();
            }""")
            self.page.locator("#lang-hint-open").click()
            self.require(self.page.evaluate("window.__langUrl") == "http://127.0.0.1:8765/",
                         "language link did not reach native browser bridge")
            bg = self.page.locator("#bg-status").inner_text().strip()
            self.require("电池优化未关闭" in bg, f"battery status: {bg!r}")
            self.require("受限" in self.page.locator("#bg-badge").inner_text(), "battery badge")
            self.require(not self.page.locator("#bg-allow").is_disabled(), "background action should be enabled with bridge")
            # 配置导出：只断言 POST 成功与下载链接，不截图。
            self.page.locator("#cfg-export").click()
            self.page.wait_for_function(
                "() => !document.querySelector('#cfg-export-link').classList.contains('hidden')",
                timeout=8000,
            )
            state = self.page.locator("#cfg-export-state").inner_text().strip()
            self.require("已导出" in state, f"export state: {state!r}")
            href = self.page.locator("#cfg-export-link").get_attribute("href") or ""
            self.require(href.endswith("/api/ui/defaults/export"), f"export link: {href!r}")
            if self.page.locator("#player-sheet").is_visible():
                self.page.locator("#cfg-cancel").click()
                self.page.locator("#player-sheet").wait_for(state="hidden", timeout=3000)
            return f"{current} / {channel} / {status}"
        self.check("update settings shows current version and up-to-date", settings_update, "update-settings")

        def banner_component():
            self.page.evaluate(
                """() => UpdateChecker.paint({
                    ok: true, channel: 'test', current_version: '0.5.3',
                    latest_version: '0.5.4', latest_version_code: 84,
                    update_available: true,
                    asset: {name: 'Audio-CPM-0.5.4-84-debug.apk',
                      url: 'https://github.com/olddriverdoge/Audio-CPM/releases/download/debug-latest/Audio-CPM-0.5.4-84-debug.apk'},
                    release: {body: 'fixture notes', published_at: '2026-11-20T10:00:00Z'}
                })"""
            )
            banner = self.page.locator("#update-banner")
            self.require(banner.is_visible(), "update banner hidden")
            self.require("0.5.4" in banner.inner_text(), f"banner: {banner.inner_text()!r}")
            self.page.locator("#ub-close").click()
            self.require(not banner.is_visible(), "update banner did not dismiss")
            return "banner shown and dismissed"
        self.check("update banner renders and dismisses", banner_component, "update-banner")

    def test_scene_modules_and_task_panels(self):
        def modules():
            self.click_scene("builtin-convert")
            for sel in ("#fw-browse", "#fw-task", "#log-float"):
                self.page.locator(sel).wait_for(state="visible", timeout=5000)
            return "browse + task + log visible"
        self.check("convert scene opens expected modules", modules, "convert-scene")

        def task_tabs():
            self.require(self.page.locator("#ui-convert").is_visible(), "convert panel hidden")
            self.page.locator('input[name="task"][value="tags"]').check()
            self.page.wait_for_timeout(150)
            self.require(self.page.locator("#ui-tags").is_visible(), "tags panel not shown")
            self.require(self.page.locator("#ui-convert").is_visible() is False, "convert panel stayed visible")
            self.page.locator('input[name="task"][value="cover"]').check()
            self.page.wait_for_timeout(150)
            self.require(self.page.locator("#ui-cover").is_visible(), "cover panel not shown")
            self.page.locator('input[name="task"][value="convert"]').check()
            return "convert/tags/cover panels toggle"
        self.check("task type switches panels", task_tabs)

        def columns_sheet():
            # The column editor is part of the browsing header; it used to be
            # easy to leave unbound after refactors.
            self.raise_browse()
            edit = self.page.locator("#view1 .col-edit")
            self.require(edit.count() > 0, "column edit button missing")
            edit.first.click()
            self.page.locator("#cols-sheet").wait_for(state="visible", timeout=3000)
            self.page.locator("#cols-close").click()
            self.page.wait_for_timeout(200)
            self.require(self.page.locator("#cols-sheet").is_visible() is False, "columns sheet did not close")
            return "open/close"
        self.check("column settings sheet opens", columns_sheet)

    def test_browse_play_meta_spectrum(self):
        self.click_scene("builtin-listen")
        self.page.locator("#fw-browse").wait_for(state="visible", timeout=5000)

        def navigate():
            self.open_dir(self.fx["ui_root"])
            # 文件夹图标优先显示目录内第一张图，而不是固定的 📁。
            icon = self.page.locator(
                f'#view1 .item.dir[data-dir-path="{self.fx["ui_album_a"]}"] .dir-icon img'
            )
            icon.wait_for(state="attached", timeout=3000)
            src = icon.evaluate("e => e.currentSrc || e.src || e.getAttribute('data-thumb')")
            self.require("/api/folder_cover" in (src or ""), f"folder cover src: {src!r}")
            self.open_dir(self.fx["ui_album_a"])
            self.wait_file(self.fx["ui_track1"])
            return "ui/Album A visible"
        self.check("browse nested directories", navigate, "browse-album")

        def play():
            # Click near the left edge so this is "start from 0", not seek to
            # the middle of the row (which can finish a short fixture quickly).
            self.wait_file(self.fx["ui_track1"]).locator('.name').click()
            self.page.wait_for_timeout(350)
            cur = self.page.evaluate("typeof Player !== 'undefined' ? Player.current : null")
            self.require(cur == self.fx["ui_track1"], f"Player.current: {cur}")
            title = self.page.locator("#pb-title").inner_text()
            self.require("Track One" in title, f"player title: {title}")
            self.require(self.page.locator(f'#view1 .item.file.playing[data-path="{self.fx["ui_track1"]}"]').count() == 1,
                        "playing row not highlighted")
            return title
        self.check("click audio row starts playback", play, "playback")

        def grid_bar():
            self.page.locator("#s1-view-btn").click()
            self.page.wait_for_timeout(450)
            self.require(self.page.locator("#view1 .grid").count() > 0, "grid view did not render")
            # 底部播放条已经剔除，网格视图也不能再冒出来。
            self.require(self.page.locator("#player-bar").is_visible() is False,
                        "bottom player bar reappeared in grid view")
            self.require(self.page.locator("#pb-title").inner_text().lower().find("track one") >= 0,
                        "grid player title mismatch")
            self.shot("grid")
            # Return to list for the metadata/spectrum checks.
            self.page.locator("#s1-view-btn").click()
            self.page.wait_for_timeout(350)
            return "grid + bottom player bar removed"
        self.check("grid view keeps bottom player bar removed", grid_bar)

        def folder_grid():
            # 网格模式的目录封面也走 /api/folder_cover；没有图片时回落到音频封面。
            self.page.evaluate("(p) => App.browse(p)", self.fx["ui_root"])
            self.page.wait_for_timeout(500)
            self.page.locator("#s1-view-btn").click()
            self.page.wait_for_timeout(450)
            imgs = self.page.locator(
                f'.tile[data-dir-path="{self.fx["ui_album_a"]}"] .tile-cover.dir img'
            )
            self.require(imgs.count() == 1, "grid folder cover image missing")
            src = imgs.first.evaluate("e => e.currentSrc || e.src || e.getAttribute('data-thumb')")
            self.require("/api/folder_cover" in (src or ""), f"grid folder cover src: {src!r}")
            self.page.locator("#s1-view-btn").click()
            self.page.wait_for_timeout(300)
            return "grid folder cover"
        self.check("grid directory uses folder cover", folder_grid)

        def meta():
            # 前面的播放/网格操作可能让 2 秒的测试音频自动切到下一首；
            # 打开元数据前重新播放 Track One，断言针对确定的文件。
            self.page.evaluate("(p) => PlayMgr.play(p)", self.fx["ui_track1"])
            self.page.wait_for_timeout(350)
            self.page.locator("#module-fab").click()
            self.page.locator("#module-menu").wait_for(state="visible", timeout=3000)
            self.page.locator('#module-menu [data-mod="meta"]').click()
            self.page.locator("#meta-float").wait_for(state="visible", timeout=5000)
            self.page.wait_for_timeout(500)
            body = self.page.locator("#meta3").inner_text()
            self.require("Track One" in body or "Track One.flac" in body, f"metadata body: {body[:160]}")
            self.require("Test Artist" in body, "artist metadata missing")
            return "metadata visible"
        self.check("metadata float opens for played track", meta, "metadata")

        def spectrum():
            # Playing a row auto-opens the spectrum/waterfall module; the old
            # edge fab is intentionally hidden by the workbench CSS.
            self.page.locator("#spectrum-float").wait_for(state="visible", timeout=5000)
            self.page.wait_for_timeout(500)
            self.require(self.page.locator("#sf-canvas").is_visible(), "spectrum canvas hidden")
            tabs = self.page.locator("#spectrum-float .sf-tab").count()
            self.require(tabs == 2, f"expected spectrum/waterfall tabs, got {tabs}")
            return "2 tabs + canvas"
        self.check("spectrum float opens", spectrum, "spectrum")

        def play_style():
            # 切到 Album B 的带内嵌封面文件，确保背景图不是依赖目录 cover.jpg。
            self.page.evaluate("(p) => App.browse(p)", self.fx["ui_album_b"])
            self.raise_browse()
            self.wait_file(self.fx["ui_covered"]).locator('.name').click()
            self.page.wait_for_timeout(400)
            self.page.evaluate("() => App.openModule('play')")
            self.page.locator("#play-float").wait_for(state="visible", timeout=5000)
            self.page.wait_for_function(
                "() => document.querySelector('#play-float').classList.contains('has-cover')"
                " && document.querySelector('#pf-cover').classList.contains('on')",
                timeout=10000,
            )
            bg = self.page.evaluate(
                "() => getComputedStyle(document.querySelector('#pf-bg')).backgroundImage"
            )
            self.require("api/cover" in bg, f"cover backdrop: {bg[:160]}")
            pf = self.page.evaluate(
                "() => { const s = getComputedStyle(document.querySelector('#pf-bg'));"
                " return {opacity: s.opacity, filter: s.filter, inset: s.inset}; }"
            )
            self.require(float(pf["opacity"]) >= 0.95, f"cover backdrop too transparent: {pf}")
            self.require("blur(24px)" not in (pf["filter"] or ""), f"cover backdrop still heavily blurred: {pf}")
            toggle = self.page.locator("#pf-q-toggle")
            self.require(toggle.get_attribute("aria-expanded") == "true", "queue should start expanded")
            toggle.click()
            self.page.wait_for_function(
                "() => document.querySelector('#play-float').classList.contains('queue-collapsed')",
                timeout=3000,
            )
            self.require(not self.page.locator("#pf-queue").is_visible(), "queue still visible after collapse")
            self.require(toggle.get_attribute("aria-expanded") == "false", "aria-expanded after collapse")
            self.require(self.page.evaluate("localStorage.getItem('ac3_play_queue_collapsed')") == "true",
                         "queue collapse state not persisted")
            toggle.click()
            self.page.wait_for_timeout(200)
            self.require(self.page.locator("#pf-queue").is_visible(), "queue did not expand")
            self.require(toggle.get_attribute("aria-expanded") == "true", "aria-expanded after expand")
            return "cover backdrop + persisted queue toggle"
        self.check("play panel cover backdrop and collapsible queue", play_style, "play-style")

    def test_play_manager_navigation(self):
        self.click_scene("builtin-listen")
        self.page.locator("#fw-browse").wait_for(state="visible", timeout=5000)
        self.page.evaluate("(p) => App.browse(p)", self.fx["ui_album_a"])
        self.wait_file(self.fx["ui_track2"]).locator('.name').click()
        self.page.wait_for_timeout(350)
        self.require(self.page.evaluate("Player.current") == self.fx["ui_track2"], "track2 not playing")

        def next_folder():
            self.page.evaluate("() => App.playNext(false)")
            self.page.wait_for_timeout(700)
            cur = self.page.evaluate("Player.current")
            path = self.page.evaluate("App.path")
            self.require(path == self.fx["ui_album_b"], f"next folder path: {path}")
            self.require(cur == self.fx["ui_covered"], f"next folder current: {cur}")
            return "order continues in next folder"
        self.check("order mode continues into next folder", next_folder)

        def open_panel():
            self.page.evaluate("() => App.openModule('play')")
            self.page.locator("#play-float").wait_for(state="visible", timeout=5000)
            self.page.wait_for_function(
                "() => document.querySelector('#play-float').classList.contains('has-cover')",
                timeout=10000,
            )
            title = self.page.locator("#pf-q-toggle .pf-qtitle").inner_text()
            self.require(title == "播放列表", f"playlist title: {title}")
            self.require(self.page.locator("#pf-vol").count() == 0, "old play-manager volume slider still present")
            self.require(self.page.locator("#af-vol").count() == 1, "audio output gain slider missing")
            btn_bg = self.page.evaluate("getComputedStyle(document.querySelector('#pf-play')).backgroundColor")
            wave_bg = self.page.evaluate("getComputedStyle(document.querySelector('#pf-wave')).backgroundColor")
            self.require("0.3" in (btn_bg or ""), f"transport button not 30% glass: {btn_bg}")
            self.require("0.3" in (wave_bg or ""), f"waveform box not 30% glass: {wave_bg}")
            self.require(self.page.locator("#player-bar").is_visible() is False, "bottom progress bar visible")
            self.require(not self.page.locator("#pf-cover").is_visible(), "top-left cover thumbnail still visible")
            # 封面缩略图隐藏后，原“点封面进元数据”的入口改到标题。
            self.page.locator("#pf-title").click()
            self.page.wait_for_timeout(250)
            self.require(self.page.locator("#meta-float").is_visible(), "title did not open metadata")
            if self.page.locator("#mf-min").is_visible():
                self.page.locator("#mf-min").click()
                self.page.wait_for_timeout(150)
            return "playlist title + 30% glass + gain moved + no cover thumb + title meta entry"
        self.check("play manager uses playlist label and 30% glass controls", open_panel)

        def stopped_folder_view():
            # 停止状态：播放列表直接列出当前目录的文件夹 + 音频，不再借用目录选择器。
            self.page.evaluate("() => Player.close()")
            self.page.evaluate("(p) => App.browse(p)", self.fx["ui_root"])
            self.page.wait_for_timeout(500)
            if not self.page.locator("#pf-queue").is_visible():
                self.page.locator("#pf-q-toggle").click()
                self.page.wait_for_timeout(250)
            folder_rows = self.page.locator("#pf-queue .pf-qdir").count()
            self.require(folder_rows >= 3, f"stopped playlist folders: {folder_rows}")
            count = self.page.locator("#pf-qcount").inner_text()
            self.require("文件夹" in count, f"stopped count missing folders: {count!r}")
            self.require(self.page.locator("#pf-q-up").count() == 0, "old up button still present")
            self.require(self.page.locator("#pf-q-pick").count() == 0, "old folder-pick button still present")
            self.require(self.page.locator("#pf-dir-picker").count() == 0, "old folder picker still present")
            # 点文件夹直接进入，点音频直接播放，不依赖文件浏览模块的额外点击。
            self.page.locator(f'#pf-queue .pf-qdir[data-dir="{self.fx["ui_album_a"]}"]').click()
            self.page.wait_for_function(
                f"() => App.path === {self.fx['ui_album_a']!r}", timeout=5000)
            self.page.wait_for_timeout(250)
            self.require(self.page.locator("#pf-queue .pf-qdir").count() == 0,
                         "subfolder rows should be empty in Album A")
            self.require(self.page.locator("#pf-queue .pf-q[data-path]").count() >= 2,
                         "stopped folder view missing audio rows")
            self.page.locator(f'#pf-queue .pf-q[data-path="{self.fx["ui_track1"]}"]').click()
            self.page.wait_for_timeout(350)
            self.require(self.page.evaluate("Player.current") == self.fx["ui_track1"], "audio click did not play")
            # 播放/暂停态维持音频队列，不出现文件夹行。
            if self.page.evaluate("Player.isPlaying()"):
                self.page.evaluate("Player.toggle()")
            self.page.wait_for_timeout(150)
            self.require(self.page.locator("#pf-queue .pf-qdir").count() == 0,
                         "audio queue mixed with folders in pause state")
            # 停止后回到文件夹浏览视图，而不是停在音频队列。
            self.page.evaluate("Player.close()")
            self.page.evaluate("(p) => App.browse(p)", self.fx["ui_root"])
            self.page.wait_for_timeout(450)
            self.require(self.page.locator("#pf-queue .pf-qdir").count() >= 3,
                         "stopped state did not return to folder view")
            return "stopped folder view + direct folder/audio click"
        self.check("stopped playlist shows folders and direct actions", stopped_folder_view)

        def swipe_nav():
            def swipe_queue(dx):
                box = self.page.locator("#pf-queue").bounding_box()
                self.require(box and box["width"] > 120, f"queue box: {box}")
                x0 = box["x"] + (70 if dx > 0 else box["width"] - 70)
                y0 = box["y"] + min(18, box["height"] - 1)
                self.page.mouse.move(x0, y0)
                self.page.mouse.down()
                self.page.mouse.move(x0 + dx, y0, steps=6)
                self.page.mouse.up()
                self.page.wait_for_timeout(600)
            # 从 Album A 右滑回根；从根进 Album B 后左滑也回根。
            self.page.evaluate("(p) => App.browse(p)", self.fx["ui_album_a"])
            self.page.wait_for_timeout(300)
            swipe_queue(130)
            self.require(self.page.evaluate("App.path") == self.fx["ui_root"],
                         f"swipe-right did not go parent: {self.page.evaluate('App.path')}")
            self.page.locator(f'#pf-queue .pf-qdir[data-dir="{self.fx["ui_album_b"]}"]').click()
            self.page.wait_for_function(
                f"() => App.path === {self.fx['ui_album_b']!r}", timeout=5000)
            swipe_queue(-140)
            self.require(self.page.evaluate("App.path") == self.fx["ui_root"],
                         f"swipe-left did not go parent: {self.page.evaluate('App.path')}")
            return "swipe right/left both return parent"
        self.check("playlist swipe navigation returns parent in both directions", swipe_nav)

        def favorite_sync():
            self.page.evaluate("(p) => App.browse(p)", self.fx["ui_album_b"])
            self.page.wait_for_timeout(300)
            self.page.locator("#pf-fav-add").click()
            self.page.wait_for_timeout(250)
            favs = self.page.evaluate("App.favoriteList()")
            self.require(self.fx["ui_album_b"] in favs, f"favorite not added: {favs}")
            self.require(self.page.locator("#pf-fav-bar .pf-fav-chip").count() >= 1, "favorite chip missing")
            return "favorite still synced from direct folder view"
        self.check("playlist favorite sync", favorite_sync)

        def embedded_spectrum():
            # 固定一首带封面的短曲，展开频谱后再做交互断言。
            self.page.evaluate("(p) => PlayMgr.play(p)", self.fx["ui_covered"])
            self.page.wait_for_timeout(300)
            if self.page.evaluate("Player.isPlaying()"):
                self.page.evaluate("Player.toggle()")
            self.page.wait_for_timeout(250)
            self.page.wait_for_function(
                "() => document.querySelector('#play-float').classList.contains('has-cover')",
                timeout=8000,
            )
            self.page.locator("#pf-q-toggle").click()
            self.page.wait_for_timeout(650)
            self.require(self.page.evaluate("document.querySelector('#spectrum-float').parentElement.id") == "pf-sf-host",
                        "spectrum not embedded in play manager")
            self.require(self.page.locator("#pf-sf-sec").is_visible(), "spectrum section hidden")
            self.require(self.page.locator("#sf-canvas").is_visible(), "embedded spectrum canvas hidden")
            self.require(self.page.evaluate("getComputedStyle(document.querySelector('#sf-canvas')).opacity") == "0.5",
                        "embedded canvas is not 50% transparent")
            bg = self.page.evaluate("getComputedStyle(document.querySelector('#pf-bg')).opacity")
            self.require(float(bg) >= 0.95, f"cover background lost behind spectrum: {bg}")
            self.require(self.page.locator("#pf-sf-sec .pf-sf-mode").count() == 2, "spectrum mode tabs missing")
            self.page.locator('#pf-sf-sec .pf-sf-mode[data-sf-mode="spectrum"]').click()
            self.page.wait_for_timeout(200)
            box = self.page.locator("#sf-canvas").bounding_box()
            self.require(box and box["width"] > 120, f"embedded canvas box: {box}")
            # 频谱/声谱展开时，左右滑切换两种模式。
            self.page.mouse.move(box["x"] + box["width"] * .72, box["y"] + box["height"] * .55)
            self.page.mouse.down()
            self.page.mouse.move(box["x"] + box["width"] * .22, box["y"] + box["height"] * .55, steps=6)
            self.page.mouse.up()
            self.page.wait_for_timeout(300)
            self.require(self.page.evaluate("Spectrum.mode") == "waterfall", "swipe-left did not switch to waterfall")
            self.page.mouse.move(box["x"] + box["width"] * .25, box["y"] + box["height"] * .55)
            self.page.mouse.down()
            self.page.mouse.move(box["x"] + box["width"] * .75, box["y"] + box["height"] * .55, steps=6)
            self.page.mouse.up()
            self.page.wait_for_timeout(250)
            self.require(self.page.evaluate("Spectrum.mode") == "spectrum", "swipe-right did not switch back to spectrum")
            # 长按配置：背景必须半透明，不再是 90% 纯黑。
            self.page.mouse.move(box["x"] + box["width"] * .7, box["y"] + box["height"] * .6)
            self.page.mouse.down()
            self.page.wait_for_timeout(650)
            self.page.mouse.up()
            self.page.wait_for_timeout(200)
            self.require(self.page.locator("#sf-sub").is_visible(), "long-press config not shown")
            chips = self.page.locator("#sf-sub .sf-chip").count()
            self.require(chips >= 8, f"long-press config chips: {chips}")
            sub_bg = self.page.evaluate("getComputedStyle(document.querySelector('#sf-sub')).backgroundColor")
            self.require("0.38" in (sub_bg or ""), f"long-press config still opaque black: {sub_bg}")

            # 用原生桥的假帧验证柱子真的画进 canvas；CSS opacity 再把它压到 50%。
            self.page.evaluate("""() => {
              window.__ac2OrigHifiActive = Player.hifiActive;
              window.__ac2OrigHifiPlaying = Player.hifiPlaying;
              Player.hifiActive = () => true;
              Player.hifiPlaying = () => true;
              const mk = n => Array.from({length:n}, (_, i) => 0.15 + 0.85 * Math.abs(Math.sin(i * 0.31)));
              window.AudioCpmNative = {spectrum: () => JSON.stringify({
                ok: true, sampleRate: 48000,
                bands: mk(96), levels: mk(96), bars: mk(48), linbars: mk(48), spec: mk(128)
              })};
              Spectrum.setMode('spectrum');
              Spectrum.resumeStream();
            }""")
            self.page.wait_for_timeout(900)
            pixels = self.page.evaluate("""() => {
              const c = document.querySelector('#sf-canvas');
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              let n = 0, max = 0;
              for (let i = 0; i < d.length; i += 4) { if (d[i+3] > 0) n++; if (d[i+3] > max) max = d[i+3]; }
              return {w: c.width, h: c.height, n, max};
            }""")
            self.require(pixels["n"] > 100, f"spectrum bars did not draw pixels: {pixels}")
            self.page.locator('#pf-sf-sec .pf-sf-mode[data-sf-mode="waterfall"]').click()
            self.page.wait_for_timeout(700)
            self.require(self.page.evaluate("getComputedStyle(document.querySelector('#sf-canvas')).opacity") == "0.5",
                        "waterfall canvas is not 50% transparent")
            # 收尾：还原本用例伪造的 HiFi 状态，避免影响后续面板。
            self.page.evaluate("""() => {
              Player.hifiActive = window.__ac2OrigHifiActive;
              Player.hifiPlaying = window.__ac2OrigHifiPlaying;
              delete window.AudioCpmNative;
              Spectrum.setMode('spectrum');
            }""")
            return "embedded spectrum + swipe mode + 50% bars/waterfall + transparent long-press config"
        self.check("spectrum embedded, swipe mode, 50% visuals and config", embedded_spectrum)

        def idle_dim():
            # 用 8 秒长音轨撑过 5 秒倒计时；展开频谱，验证内部保持默认 50%。
            self.page.evaluate("(p) => PlayMgr.play(p)", self.fx["ui_long"])
            self.page.wait_for_timeout(350)
            if not self.page.locator("#pf-sf-sec").is_visible():
                self.page.locator("#pf-q-toggle").click()
                self.page.wait_for_timeout(300)
            self.page.wait_for_timeout(5600)
            self.require(self.page.evaluate("document.querySelector('#play-float').classList.contains('pf-idle-dim')"),
                         "play manager did not dim after 5 seconds")
            for sel in ("#pf-head", ".pf-now", ".pf-transport", "#pf-qhead", ".pf-sf-head"):
                op = self.page.evaluate("(s) => getComputedStyle(document.querySelector(s)).opacity", sel)
                self.require(float(op) <= 0.11, f"{sel} not at 10% opacity: {op}")
            self.require(self.page.evaluate("getComputedStyle(document.querySelector('#sf-canvas')).opacity") == "0.5",
                         "spectrum canvas was dimmed with the chrome")
            self.require(self.page.locator("#pf-idle-guard").is_visible(), "idle guard not visible")
            # 第一次点击只唤醒，不触发下面的停止按钮。
            stop = self.page.locator("#pf-stop").bounding_box()
            self.require(stop and stop["width"] > 0, f"stop button box: {stop}")
            cur_before = self.page.evaluate("Player.current")
            self.page.mouse.click(stop["x"] + stop["width"] / 2, stop["y"] + stop["height"] / 2)
            self.page.wait_for_timeout(450)
            self.require(not self.page.evaluate("document.querySelector('#play-float').classList.contains('pf-idle-dim')"),
                         "click did not restore play manager")
            self.require(self.page.evaluate("Player.current") == cur_before, "first click activated a locked control")
            self.require(self.page.locator("#pf-idle-guard").is_visible() is False, "idle guard stayed visible")
            op = self.page.evaluate("getComputedStyle(document.querySelector('#pf-head')).opacity")
            self.require(float(op) >= 0.9, f"play manager did not restore opacity: {op}")
            return "5s idle dim + lock + click wake"
        self.check("play manager 5s idle dim and lock", idle_dim)

        def gain_panel():
            self.page.evaluate("() => App.openModule('audio')")
            self.page.locator("#audio-float").wait_for(state="visible", timeout=5000)
            self.require(self.page.locator("#af-vol").is_visible(), "audio gain slider not visible")
            self.page.locator("#af-vol").fill("0.35")
            self.page.locator("#af-vol").dispatch_event("input")
            self.page.wait_for_timeout(200)
            vol = self.page.evaluate("Player.getVolume()")
            self.require(abs(float(vol) - 0.35) < 0.02, f"Player volume: {vol}")
            self.require(self.page.locator("#af-vol-val").inner_text().strip() == "35%", "gain label mismatch")
            return "gain slider controls playback volume"
        self.check("audio output gain controls volume", gain_panel)

    def test_selection_and_delete(self):
        self.click_scene("builtin-organize")
        self.page.locator("#fw-browse").wait_for(state="visible", timeout=5000)

        def select_row():
            # 前一个用例可能在 Album B；直接回到 ui 根目录，再让真实点击
            # 目录行进入 Trash。避免把测试的随机当前路径当成产品回归。
            self.page.evaluate("(p) => App.browse(p)", self.fx["ui_root"])
            self.page.wait_for_timeout(500)
            self.open_dir(self.fx["ui_trash"])
            target = self.page.locator(f'#view1 .item.file[data-path="{self.fx["ui_delete_me"]}"]')
            target.wait_for(state="visible", timeout=5000)
            # The checkbox is intentionally invisible until selection mode.
            # A long press is the real touch gesture that enters that mode.
            target.click(position={"x": 4, "y": 15}, delay=650)
            self.page.locator("#sel-tools").wait_for(state="visible", timeout=3000)
            self.require("1" in self.page.locator("#sel-info").inner_text(), "selection count")
            self.shot("selection")
            return self.page.locator("#sel-info").inner_text()
        self.check("checkbox selects file and reveals tools", select_row, "selection")

        def delete():
            self.page.once("dialog", lambda d: d.accept())
            self.page.locator("#btn-del").click()
            self.page.wait_for_timeout(1200)
            path = Path(self.fx["ui_delete_me"][6:])
            self.require(not path.exists(), f"file still on disk: {path}")
            self.require(self.page.locator(f'#view1 .item.file[data-path="{self.fx["ui_delete_me"]}"]').count() == 0,
                        "deleted row still rendered")
            self.shot("deleted")
            return "disk and DOM removed"
        self.check("delete selected file with confirmation", delete, "deleted")

    def test_convert_task(self):
        self.click_scene("builtin-convert")
        self.page.locator("#fw-browse").wait_for(state="visible", timeout=5000)

        def setup():
            self.open_dir(self.fx["ui_root"])
            self.open_dir(self.fx["ui_convert_in"])
            # Browsing raises the file browser, which can fully cover the task
            # window in the built-in convert scene.  Raise the task window
            # before touching its controls, just like using the module dock.
            self.page.evaluate("App.openModule('task')")
            self.page.wait_for_timeout(250)
            self.page.locator("#fw-task").wait_for(state="visible", timeout=4000)
            self.require(self.page.locator("#ui-convert").is_visible(), "convert panel hidden")
            self.page.select_option("#fmt-select", "FLAC-16-44")
            self.page.fill("#output-dir", self.fx["ui_out"])
            self.page.locator("#delete-source").uncheck()
            return self.page.locator("#fmt-select").input_value()
        self.check("convert task setup", setup)

        def start():
            self.page.locator("#start-btn").click()
            # Wait for the actual SSE-driven finish, not a fixed sleep.
            self.page.wait_for_function(
                "(() => { const t = document.querySelector('#progress-status'); "
                "return t && (t.textContent.includes('完成') || t.textContent.includes('出错')); })()",
                timeout=30000,
            )
            status = self.page.locator("#progress-status").inner_text()
            self.require("完成" in status, f"task did not finish: {status}")
            out = Path(self.fx["ui_out"][6:]) / "Track To Convert.flac"
            self.require(out.is_file(), f"converted file missing: {out}")
            self.require(self.page.locator("#task-status").inner_text().strip() in ("✔", "✓"), "task-status not success")
            self.shot("convert-result")
            return out.name
        self.check("convert task via UI completes", start, "convert-result")

    def test_audio_panel(self):
        def open_panel():
            self.page.locator("#module-fab").click()
            self.page.locator("#module-menu").wait_for(state="visible", timeout=3000)
            self.page.locator('#module-menu [data-mod="audio"]').click()
            self.page.locator("#audio-float").wait_for(state="visible", timeout=5000)
            self.page.wait_for_timeout(600)
            body = self.page.locator("#af-body").inner_text()
            self.require("网页" in body or "原生" in body or "不可用" in body, f"audio panel body: {body[:200]}")
            return "panel shows web/native limitation"
        self.check("audio panel opens on cloud", open_panel, "audio-panel")

    def test_scene_save(self):
        self.click_scene("builtin-convert")
        self.page.locator("#scene-add").click()
        self.page.locator("#scene-save-overlay").wait_for(state="visible", timeout=4000)

        def save():
            self.page.once("dialog", lambda d: d.accept("Cloud Regression Scene"))
            self.page.locator(".ss-new").click()
            self.page.wait_for_timeout(500)
            # createScene() intentionally caps names at 20 chars.
            self.require(
                self.page.locator("#scene-tabs .scene-chip", has_text="Cloud Regression Sce").count() == 1,
                "saved scene chip missing",
            )
            return "scene persisted in localStorage"
        self.check("save current layout as scene", save, "scene-save")

    def test_defaults_import(self):
        def run():
            bundle = {
                "schema": "audio-cpm-ui-defaults",
                "schemaVersion": 1,
                "exportedAt": "2026-11-21T00:00:00.000Z",
                "defaultScenes": [{
                    "id": "builtin-convert",
                    "name": "文件转码",
                    "desc": "文件选择 · 批处理 · 日志",
                    "modules": ["browse", "task", "log"],
                    "geo": {"fw-browse": {"x": 4, "y": 70, "w": 420, "h": 300, "scale": 1}},
                    "uiScale": 1,
                    "canvas": {"x": 12, "y": -8},
                }],
                "prefs": {"ac2_autoplay": True},
            }
            # 模拟刚安装：没有场景覆盖、没有偏好、没有注入标记。
            self.page.evaluate("""() => {
              localStorage.removeItem('ac3_scene_overrides');
              localStorage.removeItem('ac2_autoplay');
              localStorage.removeItem('ac3_defaults_applied');
            }""")
            changed = self.page.evaluate("""async (b) => {
              const realFetch = window.fetch;
              window.fetch = (url, opts) => String(url).includes('/defaults.json')
                ? Promise.resolve(new Response(JSON.stringify(b), {
                    status: 200, headers: {'Content-Type': 'application/json'}
                  }))
                : realFetch(url, opts);
try { return await Defaults.apply(true); } finally { window.fetch = realFetch; }
            }""", bundle)
            self.require(changed >= 2, f"defaults changed {changed}")
            ov = self.page.evaluate("() => JSON.parse(localStorage.getItem('ac3_scene_overrides') || '{}')")
            self.require("builtin-convert" in ov, "default scene not injected")
            self.require(ov["builtin-convert"]["geo"]["fw-browse"]["w"] == 420, "default scene geo lost")
            self.require(self.page.evaluate("() => localStorage.getItem('ac2_autoplay')") == "true",
                         "default pref not injected")
            again = self.page.evaluate("""async (b) => {
              const realFetch = window.fetch;
              window.fetch = (url, opts) => String(url).includes('/defaults.json')
                ? Promise.resolve(new Response(JSON.stringify(b), {
                    status: 200, headers: {'Content-Type': 'application/json'}
                  }))
                : realFetch(url, opts);
try { return await Defaults.apply(true); } finally { window.fetch = realFetch; }
            }""", bundle)
            self.require(again == 0, f"defaults applied twice: {again}")
            return "scene geo + pref injected once"
        self.check("UI defaults import is one-shot and non-destructive", run)

    def test_real_defaults_and_orientation(self):
        """真实仓库 defaults.json + 390x844 竖屏 -> 844x390 横屏。

        不截屏：只用 DOM 矩形判断模块是否都在视口内、是否互相重叠，
        以及默认网格/列宽/场景覆盖是否真的来自 defaults.json。
        """
        ctx = self.browser.new_context(
            locale="zh-CN", viewport={"width": 390, "height": 844}, device_scale_factor=1
        )
        self.context = ctx
        self.page = ctx.new_page()
        self.page.set_default_timeout(9000)
        page = self.page

        def boot():
            page.goto(self.base + "/", wait_until="load", timeout=20000)
            page.evaluate("localStorage.clear()")
            page.reload(wait_until="load", timeout=20000)
            page.wait_for_function(
                "typeof App !== 'undefined' && document.querySelectorAll('#scene-tabs .scene-chip').length > 0",
                timeout=15000,
            )
            page.wait_for_timeout(900)
            return "loaded real defaults"
        self.check("real defaults bundle loads", boot)

        def defaults():
            marker = page.evaluate("() => localStorage.getItem('ac3_defaults_applied')")
            self.require(bool(marker), "defaults marker missing")
            ov = page.evaluate("() => JSON.parse(localStorage.getItem('ac3_scene_overrides') || '{}')")
            self.require(len([k for k in ov if k.startswith('builtin-')]) == 3,
                         f"builtin overrides: {list(ov)}")
            self.require(any(k.get('viewport') for k in ov.values()), "scene viewport not recorded")
            self.require(page.evaluate("() => JSON.parse(localStorage.getItem('ac2_view_mode') || 'null')") == "grid",
                         "default view mode not grid")
            cols = page.evaluate("() => JSON.parse(localStorage.getItem('ac2_columns') || '{}')")
            self.require(cols.get("widths", {}).get("name") == 167, f"column widths: {cols}")
            return "3 scenes + grid + name=167"
        self.check("real defaults populate scenes and prefs", defaults)

        def geometry_ok(tag):
            data = page.evaluate("""() => {
              const ids = ['fw-browse','fw-task','log-float','play-float','spectrum-float','tree-float'];
              const mods = App.openModules ? App.openModules() : [];
              const wins = mods.map(m => document.querySelector('#fw-' + m + ', #' + m + '-float')).filter(Boolean);
              const vw = innerWidth, vh = innerHeight;
              const pb = document.querySelector('#player-bar');
              const pbTop = pb && !pb.classList.contains('hidden') ? pb.getBoundingClientRect().top : vh;
              const rs = wins.map(w => {
                const r = w.getBoundingClientRect();
                return {id: w.id, x:r.x, y:r.y, w:r.width, h:r.height};
              });
              let overlaps = [];
              for (let i=0;i<rs.length;i++) for (let j=i+1;j<rs.length;j++) {
                const a=rs[i], b=rs[j];
                const iw=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
                const ih=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
                if (iw>12 && ih>12) overlaps.push([a.id,b.id,Math.round(iw),Math.round(ih)]);
              }
              const outside = rs.filter(r => r.x < -2 || r.y < -2 || r.x+r.w > vw+2 || r.y+r.h > pbTop+2);
              return {vw, vh, pbTop, rs, overlaps, outside};
            }""")
            self.require(len(data["rs"]) >= 2, f"{tag}: no windows {data}")
            self.require(not data["overlaps"], f"{tag}: overlaps {data['overlaps']} rects={data['rs']}")
            self.require(not data["outside"], f"{tag}: outside viewport {data['outside']} vw={data['vw']} pbTop={data['pbTop']}")
            return f"{tag}: {len(data['rs'])} windows clear"
        def portrait():
            page.locator('#scene-tabs .scene-chip, .sh-card[data-id="builtin-convert"]').first.click()
            page.wait_for_timeout(700)
            return geometry_ok("portrait")
        self.check("portrait scene windows fit without overlap", portrait)

        def landscape():
            page.set_viewport_size({"width": 844, "height": 390})
            page.wait_for_timeout(1100)
            return geometry_ok("landscape")
        self.check("landscape reflow keeps all windows visible and non-overlapping", landscape)

        def no_play_or_overwrite():
            self.require(page.locator("#view1 .play-btn").count() == 0, "list play button still present")
            page.locator("#scene-add").click()
            page.locator("#scene-save-overlay").wait_for(state="visible", timeout=4000)
            self.require(page.locator(".ss-overwrite").count() == 0, "overwrite button still present")
            text = page.locator("#scene-save-overlay").inner_text()
            self.require("覆盖" not in text, f"overwrite wording still present: {text[:120]}")
            page.locator("#ss-cancel").click()
            return "play button + overwrite button removed"
        self.check("file list play button and save-scene overwrite removed", no_play_or_overwrite)

    def test_mobile_layout(self):
        def run():
            mobile = self.browser.new_context(
                locale="zh-CN", viewport={"width": 390, "height": 844}, device_scale_factor=1
            )
            old_page = self.page
            self.context = mobile
            self.page = mobile.new_page()
            self.page.set_default_timeout(9000)
            self.page.on("console", self._on_console)
            self.page.on("pageerror", self._on_pageerror)
            self.page.goto(self.base + "/?defaults=0", wait_until="load", timeout=20000)
            self.page.wait_for_function("typeof App !== 'undefined'", timeout=15000)
            self.page.wait_for_timeout(800)
            self.page.locator("#btn-player-cfg").click()
            self.page.locator("#player-sheet").wait_for(state="visible", timeout=5000)
            hint = self.page.locator(".lang-hint").inner_text().strip()
            self.require("http://127.0.0.1:8765/" in hint, "hint missing on mobile")
            rect = self.page.locator("#player-sheet").bounding_box()
            self.require(rect and rect["x"] >= -1 and rect["x"] + rect["width"] <= 391,
                        f"settings sheet outside viewport: {rect}")
            self.shot("mobile")
            return f"sheet width {rect['width']:.0f}px"
        self.check("mobile viewport settings fits", run)

    def run(self):
        with sync_playwright() as p:
            launch_kwargs = {"headless": True}
            chromium = os.environ.get("AC2_CHROMIUM") or shutil.which("chromium")
            if chromium:
                launch_kwargs["executable_path"] = chromium
            self.browser = p.chromium.launch(**launch_kwargs)
            self.context = self.browser.new_context(locale="zh-CN", viewport={"width": 1280, "height": 900})
            self.fresh_page()
            try:
                self.test_home_and_settings()
                self.fresh_page()
                self.test_update_ui()
                self.fresh_page()
                self.test_scene_modules_and_task_panels()
                self.fresh_page()
                self.test_browse_play_meta_spectrum()
                self.fresh_page()
                self.test_play_manager_navigation()
                self.fresh_page()
                self.test_selection_and_delete()
                self.fresh_page()
                self.test_convert_task()
                self.fresh_page()
                self.test_audio_panel()
                self.fresh_page()
                self.test_scene_save()
                self.fresh_page()
                self.test_defaults_import()
                self.fresh_page()
                self.test_real_defaults_and_orientation()
                self.fresh_page()
                self.test_mobile_layout()
            finally:
                try:
                    self.context.close()
                except Exception:
                    pass
                self.browser.close()
        passed = sum(1 for r in self.results if r["ok"])
        return {
            "results": self.results,
            "passed": passed,
            "failed": len(self.results) - passed,
            "console_errors": self.console_errors,
            "page_errors": self.page_errors,
        }


def run_ui(base_url: str, fixture: Dict[str, str], shot_dir: Path) -> Dict[str, Any]:
    suite = UiRegression(base_url, fixture, shot_dir)
    return suite.run()
