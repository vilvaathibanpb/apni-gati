"""Contact sheet of N evenly spaced frames from a clip (for review)."""
import subprocess, sys
src, out, n = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 8
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], capture_output=True, text=True).stdout)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", f"fps={n / dur},scale=260:-1,tile={n}x1", "-frames:v", "1", out], check=True)
print(f"{dur:.1f}s")
