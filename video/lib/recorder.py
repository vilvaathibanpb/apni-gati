"""Drive the live app in a phone-sized headless Chromium and capture a smooth screencast.

Frames come from the Chrome DevTools screencast (one JPEG per repaint, with timestamps), so animations
are captured at their real speed. Long waits can be marked and later compressed ("2 min later").
"""
from __future__ import annotations

import asyncio
import base64
import json
import shutil
import subprocess
import time
from pathlib import Path

from playwright.async_api import Page, async_playwright

APP = "http://localhost:5173"
PHONE = {"width": 390, "height": 844}
DPR = 2

TOUCH_JS = """
(() => {
  if (window.__touchInstalled) return; window.__touchInstalled = true;
  const style = document.createElement('style');
  style.textContent = `.__tap{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
    background:rgba(210,22,31,.28);border:2px solid rgba(210,22,31,.55);pointer-events:none;z-index:2147483647;
    animation:__tap .55s ease-out forwards} @keyframes __tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}
    html{scroll-behavior:auto}`;
  document.documentElement.appendChild(style);
  window.addEventListener('pointerdown', e => {
    const d = document.createElement('div'); d.className='__tap'; d.style.left=e.clientX+'px'; d.style.top=e.clientY+'px';
    document.body.appendChild(d); setTimeout(()=>d.remove(), 700);
  }, true);
})();
"""


class Recorder:
    def __init__(self, name: str, out_dir: Path):
        self.name = name
        self.dir = out_dir / name
        if self.dir.exists():
            shutil.rmtree(self.dir)
        self.dir.mkdir(parents=True)
        self.frames: list[tuple[float, str]] = []
        self.marks: list[tuple[str, float]] = []
        self._n = 0
        self.t0: float | None = None

    async def __aenter__(self) -> "Recorder":
        self._pw = await async_playwright().start()
        self.browser = await self._pw.chromium.launch(args=["--force-device-scale-factor=2", "--high-dpi-support=1"])
        self.context = await self.browser.new_context(viewport=PHONE, device_scale_factor=DPR, is_mobile=True, has_touch=False, locale="en-IN")
        await self.context.add_init_script(TOUCH_JS)
        self.page: Page = await self.context.new_page()
        self.cdp = await self.context.new_cdp_session(self.page)
        self.cdp.on("Page.screencastFrame", self._on_frame)
        return self

    async def _on_frame(self, params: dict) -> None:
        ts = params["metadata"]["timestamp"]
        if self.t0 is None:
            self.t0 = ts
        path = self.dir / f"f{self._n:06d}.jpg"
        path.write_bytes(base64.b64decode(params["data"]))
        self.frames.append((ts - self.t0, path.name))
        self._n += 1
        try:
            await self.cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})
        except Exception:  # noqa: BLE001 - session may be closing
            pass

    async def start(self) -> None:
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": PHONE["width"] * DPR, "maxHeight": PHONE["height"] * DPR, "everyNthFrame": 1})
        await asyncio.sleep(0.3)

    def now(self) -> float:
        return 0.0 if self.t0 is None else time.time() - self.t0

    def mark(self, label: str) -> None:
        self.marks.append((label, self.now()))

    async def hold(self, seconds: float) -> None:
        # Nudge a repaint so the screencast keeps delivering frames during still moments.
        end = time.time() + seconds
        while time.time() < end:
            await self.page.evaluate("document.body.style.outline = document.body.style.outline ? '' : '0px solid transparent'")
            await asyncio.sleep(0.1)

    async def goto(self, path: str, wait: float = 1.2) -> None:
        await self.page.goto(APP + path, wait_until="networkidle")
        await self.page.evaluate("document.fonts.ready")
        await self.hold(wait)

    async def tap(self, locator, after: float = 0.6) -> None:
        loc = self.page.locator(locator) if isinstance(locator, str) else locator
        box = await loc.first.bounding_box()
        if box is None or box["y"] < 90 or box["y"] + box["height"] > PHONE["height"] - 40:
            # Bring it to the middle of the screen (clear of the sticky header) with a visible scroll.
            await self.scroll(int(box["y"] - PHONE["height"] / 2) if box else 0, 0.6)
            box = await loc.first.bounding_box()
        await self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        await self.hold(0.25)
        await self.page.mouse.down()
        await asyncio.sleep(0.06)
        await self.page.mouse.up()
        await self.hold(after)

    async def type(self, locator: str, text: str, delay_ms: int = 18) -> None:
        await self.page.locator(locator).first.click()
        await self.page.keyboard.type(text, delay=delay_ms)

    async def scroll(self, dy: int, duration: float = 1.0) -> None:
        steps = max(1, int(duration * 30))
        for i in range(steps):
            await self.page.mouse.wheel(0, dy / steps)
            await asyncio.sleep(duration / steps)
        await self.hold(0.3)

    async def scroll_to(self, locator, duration: float = 1.0, offset: int = 120) -> None:
        y = await self.page.locator(locator).first.evaluate("(el, o) => el.getBoundingClientRect().top - o", offset)
        await self.scroll(int(y), duration)

    async def wait_for(self, predicate_js: str, timeout: float = 400, poll: float = 1.0) -> None:
        end = time.time() + timeout
        while time.time() < end:
            if await self.page.evaluate(predicate_js):
                return
            await self.hold(poll)
        raise TimeoutError(predicate_js)

    async def __aexit__(self, *exc) -> None:
        try:
            await self.cdp.send("Page.stopScreencast")
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(0.3)
        (self.dir / "timeline.json").write_text(json.dumps({"frames": self.frames, "marks": self.marks}))
        await self.browser.close()
        await self._pw.stop()


def build_clip(rec_dir: Path, out: Path, compress: list[tuple[str, str, float]] | None = None, fps: int = 30) -> dict:
    """Frames -> constant-fps MP4. `compress` = [(start_mark, end_mark, seconds)] squeezes waits.

    Returns the mapped times of every mark (for overlays such as a "2 min later" badge).
    """
    rec_dir, out = rec_dir.resolve(), out.resolve()
    tl = json.loads((rec_dir / "timeline.json").read_text())
    frames = tl["frames"]
    marks = dict(tl["marks"])
    ranges = [(marks[a], marks[b], secs) for a, b, secs in (compress or [])]

    def remap(t: float) -> float:
        shift = 0.0
        for a, b, secs in ranges:
            if t <= a:
                break
            if t < b:
                return t - shift - (t - a) + (t - a) * secs / (b - a)
            shift += (b - a) - secs
        return t - shift

    mapped = [(remap(t), name) for t, name in frames]
    total = mapped[-1][0] + 0.5
    # Sample to constant fps: for each output frame, the latest source frame at or before that time.
    lines, j = [], 0
    n_out = int(total * fps)
    for k in range(n_out):
        t = k / fps
        while j + 1 < len(mapped) and mapped[j + 1][0] <= t:
            j += 1
        lines.append(mapped[j][1])
    listing = rec_dir / "concat.txt"
    with listing.open("w") as fh:
        for name in lines:
            fh.write(f"file '{name}'\nduration {1 / fps:.6f}\n")
        fh.write(f"file '{lines[-1]}'\n")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-vf", f"fps={fps},format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2",
                    "-c:v", "libx264", "-crf", "16", "-preset", "medium", str(out)], check=True, cwd=rec_dir)
    return {"duration": total, "marks": {k: remap(v) for k, v in marks.items()}}
