"""Render animated HTML scenes frame by frame (deterministic timing via window.seek)."""
from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlencode

from playwright.async_api import async_playwright

SCENES = Path(__file__).resolve().parent.parent / "scenes"
FPS = 30


async def render_scene(name: str, seconds: float, out: Path, params: dict | None = None, fps: int = FPS) -> Path:
    frames = out.with_suffix("")
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir(parents=True)
    url = (SCENES / f"{name}.html").as_uri() + (("?" + urlencode(params)) if params else "")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})
        await page.goto(url, wait_until="load")
        await page.evaluate("document.fonts.ready")
        await page.wait_for_timeout(300)
        n = int(round(seconds * fps))
        for i in range(n):
            await page.evaluate(f"window.seek({i / fps})")
            await page.screenshot(path=str(frames / f"f{i:05d}.jpg"), type="jpeg", quality=93)
        await browser.close()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(frames / "f%05d.jpg"),
                    "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", str(out)], check=True)
    shutil.rmtree(frames)
    return out


async def render_still(name: str, out: Path, t: float = 99.0, params: dict | None = None, transparent: bool = False) -> Path:
    url = (SCENES / f"{name}.html").as_uri() + (("?" + urlencode(params)) if params else "")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})
        await page.goto(url, wait_until="load")
        await page.evaluate("document.fonts.ready")
        await page.wait_for_timeout(300)
        await page.evaluate(f"window.seek && window.seek({t})")
        await page.screenshot(path=str(out), type="png", omit_background=transparent)
        await browser.close()
    return out


if __name__ == "__main__":
    import sys

    name, secs = sys.argv[1], float(sys.argv[2])
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else SCENES.parent / "frames" / f"scene_{name}.mp4"
    asyncio.run(render_scene(name, secs, out))
    print(out)
