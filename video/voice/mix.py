"""Place the recorded voiceover lines at their scenes, duck the music under speech, burn in subtitles."""
import json, subprocess, asyncio
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.render import render_still

HERE = Path(__file__).parent
OUT = HERE.parent / "out"
timing = json.loads((OUT / "timing.json").read_text())

# (segment index, [(start_s, end_s) pieces in the recording], subtitle text) — pieces from Muse Voice Transcribe turns
CHUNKS = [
    (0, [(2.30, 12.30)], "Even in the same class, every child learns at a different pace. Some are still at Class 2 level, others are ready for more. Yet they all get the same homework."),
    (1, [(12.95, 19.45), (20.15, 23.20)], "Apni Gati means your own pace. The teacher sets up once, and every child gets homework that fits them. Everything you'll see next is the real, working app."),
    (2, [(25.35, 35.05)], "Add the children and paste the syllabus in plain words. Muse Wonder maps it onto the NCERT curriculum and tells you what it couldn't match."),
    (3, [(35.65, 45.65)], "Then one tap. Muse Spark writes a different homework for every child, from their own knowledge graph. Every answer is checked with real maths."),
    (4, [(47.90, 60.05)], "Anitha and Lakshmi sit in Class 5. Anitha gets ten gentle questions on the gap underneath. Lakshmi gets six harder, multi-step problems. Same class, same evening, in Tamil."),
    (5, [(65.90, 67.95), (68.25, 73.35)], "Anitha does it in her notebook. Her family opens her own link, with no app and no login, and sends one photo."),
    (6, [(74.80, 78.95)], "Muse Spark reads her handwriting, but the maths decides what's right."),
    (7, [(80.70, 84.20), (85.35, 90.10), (90.70, 94.60)], "Her page comes back marked in red pen, against the answer key. Seven out of ten: two mistakes circled with a note, one question not done. The teacher, the child and the family all see the same marks."),
    (8, [(96.40, 98.85), (104.75, 114.70)], "And not just wrong, but why. She wrote 50 + 6 as 506, joining the parts instead of adding them. Her hint nudges her without giving the answer, and the teacher sees every check."),
    (9, [(115.90, 127.40), (128.10, 129.90)], "Her knowledge graph updates, and her progress bar moves as topics are earned. A Muse Wonder agent reads all her work, traces it back to the root, grouping in tens, and writes questions to test it. Her next homework starts there."),
    (10, [(131.05, 135.10)], "The teacher can also mark a whole stack of notebooks at once."),
    (11, [(135.45, 140.85)], "Children read aloud in their own language, and every skipped or misread word is caught."),
    (12, [(142.40, 147.80)], "And Muse Wonder plans tomorrow's group lessons, with worksheets drawn by Muse Image."),
    (13, [(148.80, 154.60), (155.20, 157.30)], "We tested it: forty out of forty problems marked right, and anything unsure goes to the teacher. All of it runs on Meta's models."),
    (14, [(159.00, 166.15)], "One class. Forty children. Forty different paces, and now, forty different homeworks. This is Apni Gati."),
]
LEAD = 0.35  # seconds after the scene starts


def split_cues(text, start, dur):
    """Split a line into subtitle cues of at most ~11 words, timed by word share."""
    words = text.split()
    groups, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= 11 or (w[-1] in ".:?!" and len(cur) >= 6):
            groups.append(cur); cur = []
    if cur:
        if groups and len(cur) < 4:
            groups[-1] += cur
        else:
            groups.append(cur)
    cues, t = [], start
    for g in groups:
        d = dur * len(g) / len(words)
        cues.append((t, t + d, " ".join(g)))
        t += d
    return cues


async def main():
    parts, filt, cues = [], [], []
    k = 0
    for seg, pieces, text in CHUNKS:
        speech = sum(b - a for a, b in pieces) + 0.15 * (len(pieces) - 1)
        window = timing[seg]["end"] - timing[seg]["start"]
        at = timing[seg]["start"] + max(0.0, min(LEAD, window - speech - 0.15))
        t = at
        for a, b in pieces:
            filt.append(f"[in{k}]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st={b - a - 0.08:.2f}:d=0.08,adelay={int(t * 1000)}|{int(t * 1000)}[p{k}]")
            parts.append(f"[p{k}]"); k += 1
            t += (b - a) + 0.15
        cues += split_cues(text, at, t - at - 0.15)
        assert t <= timing[seg]["end"] + 0.45, (seg, t, timing[seg]["end"])
    filt.insert(0, f"[0:a]asplit={k}" + "".join(f"[in{j}]" for j in range(k)))
    # voice: clean up + loudness; music: ducked under the voice
    filt.append(f"{''.join(parts)}amix=inputs={len(parts)}:normalize=0,highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=9,apad=whole_dur=180[vo]")
    filt.append("[1:a]loudnorm=I=-23:TP=-3,volume=0.9[bgm]")
    filt.append("[vo]asplit[vo1][vo2]")
    filt.append("[bgm][vo1]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400:makeup=1[duck]")
    filt.append("[duck][vo2]amix=inputs=2:normalize=0,alimiter=limit=0.95,atrim=0:180[a]")
    (HERE / "audio_filter.txt").write_text(";\n".join(filt))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(HERE / "vo_raw.m4a"), "-i", str(OUT / "bgm.wav"),
                    "-/filter_complex", str(HERE / "audio_filter.txt"), "-map", "[a]", "-ar", "48000", str(HERE / "final_audio.wav")], check=True)

    # subtitles: one transparent PNG per cue, overlaid at its time
    subs = HERE / "subs"; subs.mkdir(exist_ok=True)
    for i, (a, b, txt) in enumerate(cues):
        await render_still("sub", subs / f"{i:03d}.png", params={"t": txt}, transparent=True)
    srt = []
    for i, (a, b, txt) in enumerate(cues, 1):
        f = lambda x: f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(round((x % 1) * 1000)):03d}"
        srt += [str(i), f"{f(a)} --> {f(b)}", txt, ""]
    (OUT / "apni-gati-demo.srt").write_text("\n".join(srt))
    inputs = ["-i", str(OUT / "apni-gati-demo.mp4"), "-i", str(HERE / "final_audio.wav")]
    vf, last = [], "0:v"
    for i, (a, b, _) in enumerate(cues):
        inputs += ["-i", str(subs / f"{i:03d}.png")]
        vf.append(f"[{last}][{i + 2}:v]overlay=0:0:enable='between(t,{a:.2f},{b:.2f})'[s{i}]")
        last = f"s{i}"
    (HERE / "video_filter.txt").write_text(";\n".join(vf))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-/filter_complex", str(HERE / "video_filter.txt"),
                    "-map", f"[{last}]", "-map", "1:a", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", "180", str(OUT / "apni-gati-demo-final.mp4")], check=True)
    print(len(cues), "subtitle cues ->", OUT / "apni-gati-demo-final.mp4")

asyncio.run(main())
