"""Record the live-app clips for the demo video.  Run: uv run python record_clips.py <clip> [...]

Clips (in story order; later clips depend on data created by earlier ones):
  setup      paste the syllabus, Muse Wonder maps it
  homework   one tap -> a different sheet for every child
  child      Anitha opens her link, sends a photo of her notebook, sees the red pen
  detail     teacher view: why it was wrong, hint in three languages, how it was checked
  progress   Anitha's progress, concept map, root-cause agent
  stack      mark a stack of notebook photos
  reading    oral reading test (synthetic demo audio)
  plan       TaRL lesson plan + verified worksheet
"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.request
from pathlib import Path

from lib.recorder import Recorder

HERE = Path(__file__).parent
FRAMES = HERE / "frames"
ASSETS = HERE / "assets"
API = "http://localhost:8000"

SYLLABUS = """Maths Mela, Classes 3 to 5 (NCERT)
Numbers up to 10,000 and place value
Addition and subtraction with regrouping, including borrowing across zero
Multiplication tables and multiplying 2-digit numbers
Division as sharing, and long division with remainders
Fractions: halves, quarters, equivalent fractions, comparing fractions
Decimals: tenths and hundredths
Money: rupees and paise"""


def api(path: str) -> dict | list:
    with urllib.request.urlopen(API + path) as r:
        return json.loads(r.read())


async def setup(r: Recorder) -> None:
    await r.goto("/class/cl_demo/setup", wait=1.5)
    await r.scroll_to("text=This term’s syllabus", duration=1.2, offset=90)
    await r.hold(0.8)
    area = r.page.locator("textarea").last
    await area.scroll_into_view_if_needed()
    await area.click()
    await area.fill("")
    for line in SYLLABUS.split("\n"):
        await r.page.keyboard.type(line, delay=8)
        await r.page.keyboard.press("Enter")
    await r.hold(0.8)
    await r.tap("text=Match to topics and save", after=0.5)
    r.mark("wait_start")
    await r.wait_for("!!document.body.innerText.match(/Saved/i)", timeout=180)
    r.mark("wait_end")
    await r.hold(1.0)
    await r.scroll_to("text=Saved", duration=1.0, offset=110)
    await r.hold(2.5)
    await r.scroll(420, 1.6)
    await r.hold(2.0)


async def homework(r: Recorder) -> None:
    await r.goto("/class/cl_demo", wait=1.2)
    await r.tap("text=Give homework", after=1.2)
    await r.tap("text=Make tonight’s homework", after=0.8)
    r.mark("wait_start")
    await r.wait_for("document.querySelectorAll('a[href*=\"wa.me\"], button').length > 0 && !!document.body.innerText.match(/Ready for challenge/i) && !document.body.innerText.match(/is writing/i)", timeout=400)
    r.mark("wait_end")
    await r.hold(2.0)
    await r.scroll(330, 1.4)
    await r.hold(1.5)
    # Open Anitha's questions (needs practice), then Lakshmi's (challenge)
    for name in ("Anitha", "Lakshmi"):
        card = r.page.locator("article, div.card").filter(has_text=name).filter(has_text="Questions").first
        await card.scroll_into_view_if_needed()
        await r.scroll_to(f"text={name}", duration=0.9, offset=90)
        await r.hold(1.2)
        await r.tap(card.locator("text=Questions").first, after=1.0)
        await r.scroll(360, 1.6)
        await r.hold(2.2)
    await r.scroll(-4000, 1.4)
    await r.hold(1.0)


async def hwopen(r: Recorder) -> None:
    """Teacher looks inside two very different sheets."""
    await r.goto("/class/cl_demo/homework", wait=1.0)
    for name in ("Anitha", "Lakshmi"):
        card = r.page.locator("div.card").filter(has=r.page.locator("a", has_text=name))
        await r.scroll_to(f"a:has-text('{name}')", duration=1.0, offset=110)
        await r.hold(1.6)
        await r.tap(card.locator("button", has_text="Questions"), after=1.0)
        await r.scroll(300, 1.8)
        await r.hold(1.6)
        await r.scroll(300, 1.8)
        await r.hold(1.4)


async def child(r: Recorder) -> None:
    rows = api("/api/classes/cl_demo/homework")
    anitha = next(x for x in rows if x["student"]["name"] == "Anitha")
    token = anitha["homework"]["token"]
    await r.goto(f"/hw/{token}", wait=1.8)
    await r.scroll(500, 2.2)
    await r.hold(1.0)
    await r.scroll(900, 1.8)
    await r.hold(0.8)
    cam = r.page.locator("button[aria-label='Take a photo of your notebook']")
    await r.scroll_to("button[aria-label='Take a photo of your notebook']", duration=1.0, offset=300)
    await r.hold(0.6)
    async with r.page.expect_file_chooser() as fc:
        await r.tap(cam, after=0.1)
    chooser = await fc.value
    await chooser.set_files(str(ASSETS / "anitha_notebook.jpg"))
    await r.hold(1.5)
    await r.tap("text=Send to my teacher", after=0.5)
    r.mark("wait_start")
    await r.wait_for("!!document.body.innerText.match(/question by question/i)", timeout=400, poll=1.0)
    r.mark("wait_end")
    await r.hold(4.5)
    await r.scroll(520, 2.0)
    await r.hold(2.0)
    await r.scroll(700, 2.0)
    await r.hold(2.0)


async def childmarked(r: Recorder) -> None:
    """The child's page once the red pen has finished: score, marks drawing on the photo, per-question results."""
    rows = api("/api/classes/cl_demo/homework")
    token = next(x for x in rows if x["student"]["name"] == "Anitha")["homework"]["token"]
    await r.goto(f"/hw/{token}", wait=6.0)
    await r.scroll(380, 2.2)
    await r.hold(3.0)
    await r.scroll(620, 2.2)
    await r.hold(2.5)


async def detail(r: Recorder) -> None:
    hw = next(x for x in api("/api/classes/cl_demo/homework") if x["student"]["name"] == "Anitha")["homework"]
    await r.goto(f"/page/{hw['page_id']}", wait=4.0)
    await r.scroll_to("text=Problems", duration=1.2, offset=100)
    await r.hold(1.0)
    wrong = r.page.locator("button").filter(has_text="expected").first
    await r.tap(wrong, after=1.8)
    sheet = r.page.locator("[role=dialog] .overflow-y-auto").first

    async def sheet_scroll(dy: int) -> None:
        for _ in range(20):
            await sheet.evaluate(f"el => el.scrollBy(0, {dy / 20})")
            await r.hold(0.04)

    await r.hold(1.5)
    await sheet_scroll(330)
    await r.hold(1.0)
    for lang in ("தமிழ்", "हिन्दी", "English"):
        await r.tap(r.page.locator("[role=dialog] button", has_text=lang), after=1.6)
    await sheet_scroll(420)
    await r.tap(r.page.locator("[role=dialog] button", has_text="How we checked"), after=0.8)
    await sheet_scroll(520)
    await r.hold(3.5)


async def progress(r: Recorder) -> None:
    await r.goto("/student/st_anitha", wait=2.0)
    await r.scroll_to("text=Syllabus progress", duration=1.2, offset=80)
    await r.hold(2.5)
    await r.scroll_to("text=Concept map", duration=1.2, offset=70)
    await r.hold(2.0)
    await r.tap("text=Find root cause", after=0.5)
    r.mark("wait_start")
    await r.wait_for("!!document.body.innerText.match(/Earliest gap/i)", timeout=300)
    r.mark("wait_end")
    await r.hold(1.0)
    await r.scroll_to("text=Concept map", duration=1.0, offset=70)
    await r.hold(3.0)
    await r.scroll_to("text=Earliest gap", duration=1.2, offset=90)
    await r.hold(3.0)
    await r.scroll(600, 1.6)
    await r.hold(2.5)


async def stack(r: Recorder) -> None:
    await r.goto("/class/cl_demo/capture", wait=1.2)
    async with r.page.expect_file_chooser() as fc:
        await r.tap("text=From gallery", after=0.1)
    chooser = await fc.value
    await chooser.set_files([str(ASSETS / f"stack_{i}.jpg") for i in range(1, 5)])
    await r.hold(1.5)
    send = r.page.locator("button").filter(has_text="Mark").last
    await r.tap(send, after=1.0)
    r.mark("wait_start")
    await r.wait_for("document.querySelectorAll(\"a[href^='/page/']\").length >= 4", timeout=500, poll=1.5)
    r.mark("wait_end")
    await r.hold(1.5)
    first = r.page.locator("a[href^='/page/']").first
    await r.tap(first, after=3.5)
    await r.scroll(380, 1.5)
    await r.hold(2.0)


async def reading(r: Recorder) -> None:
    await r.goto("/class/cl_demo/reading", wait=1.2)
    await r.page.locator("select").first.select_option(value="st_kavin")
    await r.hold(0.8)
    await r.tap(r.page.locator("button", has_text="Tamil").first, after=0.6)
    para = r.page.locator("button").filter(has_text="paragraph").first
    if await para.count():
        await r.tap(para, after=1.2)
    await r.scroll(260, 1.0)
    await r.hold(1.5)
    async with r.page.expect_file_chooser() as fc:
        await r.tap("text=Upload an existing recording", after=0.1)
    chooser = await fc.value
    await chooser.set_files(str(ASSETS / "reading_demo.m4a"))
    await r.hold(1.0)
    await r.tap(r.page.locator("button", has_text="Assess reading"), after=0.5)
    r.mark("wait_start")
    await r.wait_for("!!document.body.innerText.match(/What the child read/i)", timeout=200)
    r.mark("wait_end")
    await r.hold(3.0)
    await r.scroll(450, 1.6)
    await r.hold(2.5)


async def plan(r: Recorder) -> None:
    await r.goto("/class/cl_demo/plan", wait=1.2)
    await r.tap("text=Plan tomorrow’s class", after=0.5)
    r.mark("wait_start")
    await r.wait_for("!!document.body.innerText.match(/Make worksheet/i)", timeout=300)
    r.mark("wait_end")
    await r.hold(1.5)
    await r.scroll(500, 1.6)
    await r.hold(2.0)
    await r.tap(r.page.locator("text=Make worksheet").first, after=0.5)
    r.mark("wait2_start")
    await r.wait_for("!!document.querySelector('img[src*=\"worksheets\"]')", timeout=300)
    r.mark("wait2_end")
    await r.page.locator("img[src*='worksheets']").first.scroll_into_view_if_needed()
    await r.hold(3.5)


CLIPS = {f.__name__: f for f in (setup, homework, hwopen, child, childmarked, detail, progress, stack, reading, plan)}


async def main(names: list[str]) -> None:
    for name in names:
        async with Recorder(name, FRAMES) as r:
            await r.start()
            await CLIPS[name](r)
        print("recorded", name, len(r.frames), "frames", r.marks)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or list(CLIPS)))
