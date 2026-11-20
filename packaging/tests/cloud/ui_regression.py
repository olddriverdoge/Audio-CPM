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

    def require(self, cond: bool, msg: str):
        if not cond:
            raise CheckFailure(msg)

    def ok(self, name: str, detail: str = ""):
        self.results.append({"name": name, "ok": True, "detail": detail})

    def fail(self, name: str, detail: str):
        self.results.append({"name": name, "ok": False, "detail": detail})

    def shot(self, stem: str) -> str:
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
        self.page.goto(self.base + "/", wait_until="load", timeout=20000)
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
            self.shot("update-settings")
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
            self.open_dir(self.fx["ui_album_a"])
            self.wait_file(self.fx["ui_track1"])
            return "ui/Album A visible"
        self.check("browse nested directories", navigate, "browse-album")

        def play():
            # Click near the left edge so this is "start from 0", not seek to
            # the middle of the row (which can finish a short fixture quickly).
            self.wait_file(self.fx["ui_track1"]).click(position={"x": 4, "y": 15})
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
            self.page.locator("#player-bar").wait_for(state="visible", timeout=4000)
            self.require(self.page.locator("#pb-title").inner_text().lower().find("track one") >= 0,
                        "grid player title mismatch")
            self.shot("grid")
            # Return to list for the metadata/spectrum checks.
            self.page.locator("#s1-view-btn").click()
            self.page.wait_for_timeout(350)
            return "grid + bottom player bar"
        self.check("grid view reveals player bar", grid_bar)

        def meta():
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

    def test_selection_and_delete(self):
        self.click_scene("builtin-organize")
        self.page.locator("#fw-browse").wait_for(state="visible", timeout=5000)

        def select_row():
            self.open_dir(self.fx["ui_root"])
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
            self.page.goto(self.base + "/", wait_until="load", timeout=20000)
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
                self.test_selection_and_delete()
                self.fresh_page()
                self.test_convert_task()
                self.fresh_page()
                self.test_audio_panel()
                self.fresh_page()
                self.test_scene_save()
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
