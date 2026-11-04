"""Assemble the 3:00 demo video from rendered scenes and recorded app clips.

  uv run python compose.py            # render everything and write out/apni-gati-demo.mp4 (+ timing sheet)
  uv run python compose.py 5 6        # re-render only segments 5 and 6, then re-assemble
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

from lib.recorder import build_clip
from lib.render import render_scene, render_still

HERE = Path(__file__).parent
FR = HERE / "frames"
OUT = HERE / "out"
SEG = OUT / "segments"
FPS = 30


PHONE_CX = 1526  # centre of the phone screen in the 1920x1080 frame


def shot(d: float, z: float, cy: float, cx: float = PHONE_CX, t_in: float = 1.4, out_before: float = 1.4, ramp: float = 1.0) -> list:
    """Camera keyframes (t, zoom, centre_x, centre_y): wide -> push in on the product -> back out before the cut."""
    t_out = d - out_before
    return [(0, 1, 960, 540), (t_in, 1, 960, 540), (t_in + ramp, z, cx, cy), (t_out - ramp, z, cx, cy), (t_out, 1, 960, 540), (d, 1, 960, 540)]


def _piecewise(keys: list, idx: int) -> str:
    """ffmpeg expression over input time `it`: smoothstep between consecutive keyframes."""
    expr = f"{keys[-1][idx]}"
    for (t0, *v0), (t1, *v1) in reversed(list(zip(keys, keys[1:]))):
        a, b = v0[idx - 1], v1[idx - 1]
        if t1 <= t0:
            continue
        u = f"((it-{t0})/{t1 - t0})"
        seg = f"({a}+({b - a})*{u}*{u}*(3-2*{u}))" if a != b else f"{a}"
        expr = f"if(lt(it,{t1}),{seg},{expr})"
    return expr


def camera_filter(keys: list) -> str:
    """Zoom/pan the composed 1920x1080 frame (rendered at 2x to keep moves smooth and sharp)."""
    z = _piecewise(keys, 1)
    cx = _piecewise(keys, 2)
    cy = _piecewise(keys, 3)
    x = f"max(0,min(iw-iw/zoom,2*({cx})-iw/zoom/2))"
    y = f"max(0,min(ih-ih/zoom,2*({cy})-ih/zoom/2))"
    return f"scale=3840:2160:flags=lanczos,zoompan=z='{z}':x='{x}':y='{y}':d=1:s=1920x1080:fps={FPS}"


def real_wait(clip: str, a: str = "wait_start", b: str = "wait_end") -> str:
    marks = dict(json.loads((FR / clip / "timeline.json").read_text())["marks"])
    s = marks[b] - marks[a]
    return f"sped up · took {round(s / 60)} min" if s >= 75 else f"sped up · took {round(s)} s"


# kind, duration, spec
SEGMENTS: list[dict] = [
    {"scene": "hook", "dur": 14},
    {"scene": "loop", "dur": 10},
    {"clip": "setup", "dur": 11, "camera": shot(11, 1.7, 560), "compress": [("wait_start", "wait_end", 2.0)], "fast": [("wait_start", "wait_end")],
     "panel": {"step": "Step 1 · once", "title": "Set up the class once.",
               "body": "Children, their class and language. Paste the syllabus in plain words: Muse Wonder maps it onto an NCERT concept graph and says honestly what it couldn't match.",
               "chips": "Muse Wonder"}},
    {"clip": "homework", "dur": 10, "camera": shot(10, 1.6, 520, t_in=1.2, out_before=1.2), "trim": (0, 15.5), "compress": [("wait_start", "wait_end", 3.0)], "fast": [("wait_start", "wait_end")],
     "panel": {"step": "Step 2 · every evening", "title": "One tap. A different homework for every child.",
               "body": "Built from each child's own knowledge graph and written in their language. Every answer is checked with real maths.",
               "chips": "Muse Spark,~sympy"}},
    {"clip": "hwopen", "dur": 15, "camera": shot(15, 1.8, 520),
     "panel": {"step": "Step 2 · every evening", "title": "Same class. Gentler for Anitha, harder for Lakshmi.",
               "body": "Both are in Class 5. Anitha needs practice: 10 short questions on the gap underneath. Lakshmi is ready for a challenge: 6 multi-step problems. Same evening.",
               "chips": "Muse Spark,~sympy"}},
    {"clip": "child", "dur": 14, "camera": shot(14, 1.8, 520), "trim": (0, 20.0), "compress": [("wait_start", "wait_end", 3.0)], "fast": [("wait_start", "wait_end")],
     "panel": {"step": "Step 3 · at home", "title": "Done in the notebook. Sent from the family phone.",
               "body": "Each child has their own link: questions in Tamil, Hindi or English, and one big button to photograph the page. No app, no login."}},
    {"scene": "pipeline", "dur": 6},
    {"clip": "childmarked", "dur": 16, "keep_caption": True,
     "camera": [(0, 1, 960, 540), (1.2, 1, 960, 540), (2.3, 1.7, 600, 640), (7.0, 1.7, 600, 640), (8.4, 1.8, PHONE_CX, 420), (14.2, 1.8, PHONE_CX, 520), (15.2, 1, 960, 540), (16, 1, 960, 540)],
     "panel": {"step": "Step 4 · red pen", "title": "Marked against the answer key.",
               "chips": "SAM 3.1,Muse Spark,~sympy", "aside": "../assets/anitha_marked.jpg",
               "asidecap": "Anitha: 7 of 10. Two mistakes circled with \"add, don't join!\", one question not done."}},
    {"clip": "detail", "dur": 14, "camera": shot(14, 1.8, 460),
     "panel": {"step": "Step 4 · red pen", "title": "Not just wrong: why.",
               "body": "She wrote 50 + 6 as 506: joining the parts instead of adding them. The child gets a hint in her language that never gives the answer, and the teacher sees every check behind the mark.",
               "chips": "Muse Spark,Muse Wonder"}},
    {"clip": "progress", "dur": 22, "camera": shot(22, 1.7, 500), "compress": [("wait_start", "wait_end", 2.5)], "fast": [("wait_start", "wait_end")],
     "panel": {"step": "Step 5 · progress", "title": "Her knowledge graph updates.",
               "body": "Progress across the syllabus moves as topics are earned. A Muse Wonder agent reads all of her work and traces it to the root, grouping in tens, then writes questions to test it. Her next homework starts there.",
               "chips": "Muse Wonder"}},
    {"clip": "stack", "dur": 8, "camera": shot(8, 1.6, 540, t_in=1.0, out_before=1.0, ramp=0.8), "compress": [("wait_start", "wait_end", 3.0)], "fast": [("wait_start", "wait_end")],
     "panel": {"step": "And for the teacher", "title": "Mark a whole stack of notebooks.",
               "body": "Photos or one flip-through video. Each page is matched to the child by the name on it.", "chips": "SAM 3.1,Muse Spark"}},
    {"clip": "reading", "dur": 9, "camera": shot(9, 1.6, 540, t_in=1.0, out_before=1.0, ramp=0.8), "compress": [("wait_start", "wait_end", 2.5)], "fast": [("wait_start", "wait_end")], "label": "Demo audio: synthetic voice",
     "panel": {"step": "And for the teacher", "title": "Reading aloud, in their own language.",
               "body": "Every skipped or misread word is caught, with the pattern behind it.", "chips": "Muse Voice Transcribe,Muse Spark"}},
    {"clip": "plan", "dur": 8, "camera": shot(8, 1.6, 540, t_in=1.0, out_before=1.0, ramp=0.8), "compress": [("wait_start", "wait_end", 2.5), ("wait2_start", "wait2_end", 2.5)], "fast": [("wait_start", "wait_end"), ("wait2_start", "wait2_end")],
     "panel": {"step": "And for the teacher", "title": "Group lessons and printable worksheets.",
               "body": "Children grouped by what they're ready to learn, not by class. Worksheets drawn, then read back and verified.", "chips": "Muse Wonder,Muse Image"}},
    {"scene": "trust", "dur": 12},
    {"scene": "end", "dur": 11},
]


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


async def build_segment(i: int, s: dict) -> Path:
    out = SEG / f"{i:02d}.mp4"
    if "scene" in s:
        await render_scene(s["scene"], s["dur"], out)
        return out

    clip = FR / f"{s['clip']}.mp4"
    info = build_clip(FR / s["clip"], clip, s.get("compress"))
    t0, t1 = s.get("trim", (0, info["duration"]))
    src_len = t1 - t0
    speed = src_len / s["dur"]

    panel = OUT / f"panel_{i:02d}.mp4"
    params = dict(s["panel"])
    cam = s.get("camera")
    if cam and not s.get("keep_caption"):
        zoomed = [k for k in cam if k[1] > 1]
        params["hide"] = f"{zoomed[0][0] - 0.9:.2f},{zoomed[-1][0] + 0.3:.2f}"  # fade out as the push starts, back as it ends
    await render_scene("panel", s["dur"] if "hide" in params else 1.2, panel, params=params)
    bezel = FR / "bezel.png"
    if not bezel.exists():
        await render_still("panel", bezel, params={"bezel": "1"}, transparent=True)

    # badges: "sped up" while a compressed wait plays; optional bottom-left label for the whole segment
    badges = []
    for a, b in s.get("fast", []):
        ta, tb = (info["marks"][a] - t0) / speed, (info["marks"][b] - t0) / speed
        png = OUT / f"badge_{i:02d}_{a}.png"
        await render_still("badge", png, params={"fast": real_wait(s["clip"], a, b)}, transparent=True)
        badges.append((png, max(0, ta - 0.4), tb + 0.4))
    if s.get("label"):
        png = OUT / f"label_{i:02d}.png"
        await render_still("badge", png, params={"label": s["label"]}, transparent=True)
        badges.append((png, 0, s["dur"]))

    inputs = ["-i", str(panel), "-i", str(clip), "-i", str(bezel)]
    for png, _, _ in badges:
        inputs += ["-i", str(png)]
    d = s["dur"]
    fc = [
        f"[0:v]tpad=stop_mode=clone:stop_duration={d},trim=0:{d},setpts=PTS-STARTPTS[bg]",
        f"[1:v]trim={t0}:{t1},setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS},scale=432:936:flags=lanczos,tpad=stop_mode=clone:stop_duration=2,trim=0:{d},setpts=PTS-STARTPTS[ph]",
        "[bg][ph]overlay=1310:72[v1]",
        "[v1][2:v]overlay=0:0[v2]",
    ]
    last = "v2"
    for k, (_, a, b) in enumerate(badges):
        fc.append(f"[{last}][{3 + k}:v]overlay=0:0:enable='between(t,{a:.2f},{b:.2f})'[b{k}]")
        last = f"b{k}"
    if s.get("camera"):
        fc.append(f"[{last}]{camera_filter(s['camera'])}[cam]")
        last = "cam"
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(fc), "-map", f"[{last}]",
         "-t", str(d), "-r", str(FPS), "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", str(out)])
    return out


def timing_sheet() -> list[dict]:
    rows, t = [], 0.0
    for i, s in enumerate(SEGMENTS):
        rows.append({"n": i, "start": t, "end": t + s["dur"], "what": s.get("scene") or s["clip"], "title": (s.get("panel") or {}).get("title", "")})
        t += s["dur"]
    return rows


async def main(only: list[int]) -> None:
    SEG.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(SEGMENTS):
        if only and i not in only:
            continue
        p = await build_segment(i, s)
        print("segment", i, s.get("scene") or s["clip"], p.name)
    listing = OUT / "segments.txt"
    listing.write_text("".join(f"file '{(SEG / f'{i:02d}.mp4').resolve()}'\n" for i in range(len(SEGMENTS))))
    final = OUT / "apni-gati-demo.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
         "-vf", "fade=t=in:st=0:d=0.6", "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(final)])
    (OUT / "timing.json").write_text(json.dumps(timing_sheet(), indent=1))
    print("wrote", final)


if __name__ == "__main__":
    asyncio.run(main([int(a) for a in sys.argv[1:]]))
