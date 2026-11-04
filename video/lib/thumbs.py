"""Screenshot every child's personal homework page (top part) for the end-card mosaic."""
import asyncio, json, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright
OUT = Path(__file__).resolve().parent.parent / "assets" / "thumbs"
async def main():
    rows = json.loads(urllib.request.urlopen("http://localhost:8000/api/classes/cl_demo/homework").read())
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--force-device-scale-factor=2"])
        pg = await b.new_page(viewport={"width": 390, "height": 760}, device_scale_factor=2)
        for i, r in enumerate(rows):
            if not r["homework"]:
                continue
            await pg.goto(f"http://localhost:5173/hw/{r['homework']['token']}", wait_until="networkidle")
            await pg.evaluate("document.fonts.ready"); await pg.wait_for_timeout(600)
            await pg.screenshot(path=str(OUT / f"{i:02d}.png"))
        await b.close()
asyncio.run(main())
