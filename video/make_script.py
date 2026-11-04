"""Write the timed voiceover script (Markdown) and a teleprompter subtitle file (SRT) for the demo video."""
import json
from pathlib import Path

OUT = Path(__file__).parent / "out"

LINES = [
    ("hook", "Even in one class, every child learns at a different pace. Some are still at Class 2 level; others are ready for more. Yet they all get the same homework."),
    ("loop", "Apni Gati means \"your own pace\". The teacher sets up once. After that, every child gets homework that fits them, every evening."),
    ("setup", "Add the children, and paste the syllabus in plain words. Muse Wonder maps it onto the NCERT curriculum, and tells you what it couldn't match."),
    ("homework", "Then, one tap. Muse Spark writes a different homework for every child, from their own knowledge graph. Every answer is checked with real maths."),
    ("hwopen", "Anitha and Lakshmi sit in the same Class 5. Anitha gets ten gentle questions on the gap underneath. Lakshmi gets six harder, multi-step problems. Same class, same evening, in Tamil."),
    ("child", "Anitha does it in her notebook. Her family opens her own link, with no app and no login, and sends one photo."),
    ("pipeline", "Muse Spark reads her handwriting. But the maths decides what's right."),
    ("childmarked", "Her page comes back marked in red pen, against the answer key. Seven out of ten: two mistakes circled with a note, one question not done. The teacher, the child and the family all see the same marks."),
    ("detail", "And not just wrong, but why. She wrote fifty plus six as five-oh-six, joining the parts instead of adding them. Her hint nudges her without giving the answer, and the teacher sees every check."),
    ("progress", "Her knowledge graph updates, and her progress bar moves as topics are earned. A Muse Wonder agent reads all her work, traces it back to the root, grouping in tens, and writes quick questions to test it. Her next homework starts there."),
    ("stack", "The teacher can also mark a whole stack of notebooks at once."),
    ("reading", "Children read aloud in their own language, and every skipped or misread word is caught."),
    ("plan", "And Muse Wonder plans tomorrow's group lessons, with worksheets drawn by Muse Image."),
    ("trust", "We tested it: forty out of forty problems marked right, and anything unsure goes to the teacher. All of it runs on Meta's models."),
    ("end", "One class. Forty children. Forty different paces, and now, forty different homeworks. This is Apni Gati."),
]


def ts(t: float, srt: bool = False) -> str:
    m, s = divmod(t, 60)
    if srt:
        h, m = divmod(int(m), 60)
        return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s % 1) * 1000)):03d}"
    return f"{int(m)}:{int(s):02d}"


def main() -> None:
    timing = json.loads((OUT / "timing.json").read_text())
    assert [r["what"] for r in timing] == [w for w, _ in LINES], "script out of sync with video segments"
    md = ["# Apni Gati: voiceover script (3:00)", "",
          "Read each line while its time window plays. Words per second are shown so you can pace yourself (about 2.3 is comfortable).",
          "Start each line about half a second into its window. Short silences are fine.", "",
          "| Time | On screen | Say | Pace |", "|---|---|---|---|"]
    srt = []
    for k, (row, (_, text)) in enumerate(zip(timing, LINES), 1):
        dur = row["end"] - row["start"]
        words = len(text.split())
        md.append(f"| {ts(row['start'])}–{ts(row['end'])} | {row['title'] or row['what']} | {text} | {words / dur:.1f} w/s |")
        srt += [str(k), f"{ts(row['start'] + 0.4, True)} --> {ts(row['end'] - 0.2, True)}", text, ""]
    total = sum(len(t.split()) for _, t in LINES)
    md += ["", f"Total: {total} words in 180 s.", "",
           "Recording tips: quiet room, phone or headset mic about 15 cm away, one take per line is fine. Record as one file, or one file per line named 00.m4a, 01.m4a… and I'll place each at its time."]
    (OUT / "VOICEOVER.md").write_text("\n".join(md))
    (OUT / "voiceover.srt").write_text("\n".join(srt))
    print("\n".join(md))


if __name__ == "__main__":
    main()
