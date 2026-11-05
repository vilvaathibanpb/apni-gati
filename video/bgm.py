"""Original, procedurally synthesised background music for the demo (no third-party samples or licences).

Calm four-chord loop (Cmaj7 - Am7 - Fmaj7 - G6, 80 bpm): warm pads, a soft plucked arpeggio and a sine bass,
with a gentle reverb. Sparse under the opening hook, fuller during the walkthrough, a lift on the end card,
then a fade. Writes out/bgm.wav (full level) for later mixing under the voiceover.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, lfilter

SR = 44100
DUR = 180.0
OUT = Path(__file__).parent / "out"
rng = np.random.default_rng(7)

BEAT = 60 / 80
CHORD_LEN = 8 * BEAT  # two bars of 4/4
CHORDS = [  # (bass, voicing)
    (36, [55, 59, 60, 64]),      # Cmaj7 (G B C E over C)
    (33, [55, 57, 60, 64]),      # Am7
    (29, [53, 57, 60, 64]),      # Fmaj7
    (31, [55, 59, 62, 64]),      # G6
]


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n: int, attack: float, release: float) -> np.ndarray:
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    e[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return e


def lowpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    b, a = butter(order, cutoff / (SR / 2))
    return lfilter(b, a, x)


def pad_note(f: float, seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    out = np.zeros_like(t)
    for cents in (-7, 0, 7):  # gentle chorus
        ff = f * 2 ** (cents / 1200)
        vib = 0.0015 * np.sin(2 * np.pi * (0.17 + 0.03 * cents / 7) * t)
        ph = 2 * np.pi * ff * t * (1 + vib)
        out += np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    return out / 3


def pluck(f: float, seconds: float = 1.6) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    body = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.55) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.18)
    click = np.minimum(1, t / 0.004)
    return body * click


def section_gain(t: np.ndarray, layer: str) -> np.ndarray:
    """Arrangement over the video timeline (seconds)."""
    g = np.ones_like(t)
    if layer == "pad":
        g = np.interp(t, [0, 2.5, 13, 15, 158, 161, 170, 172.5, 176, 180], [0, .75, .75, .9, .9, .8, .8, 1.0, .9, 0])
    elif layer == "arp":
        g = np.interp(t, [0, 12, 15, 157, 160, 169, 172, 176, 179.5], [0, 0, 1, 1, .65, .65, .9, .7, 0])
    elif layer == "bass":
        g = np.interp(t, [0, 13, 16, 157, 160, 176, 180], [0, 0, 1, 1, .8, .7, 0])
    return g


def build() -> np.ndarray:
    n = int(DUR * SR)
    t = np.arange(n) / SR
    L, R = np.zeros(n), np.zeros(n)
    k = 0
    start = 0.0
    while start < DUR:
        bass, voicing = CHORDS[k % len(CHORDS)]
        seg = CHORD_LEN + 2.0  # overlap into the next chord for a smooth crossfade
        i0 = int(start * SR)
        m = min(int(seg * SR), n - i0)
        e = env(int(seg * SR), 1.4, 2.2)[:m]
        # pad: spread voices across the stereo field
        for j, note in enumerate(voicing):
            v = pad_note(hz(note), seg)[:m] * e * 0.16
            pan = 0.25 + 0.5 * j / (len(voicing) - 1)
            L[i0:i0 + m] += v * (1 - pan)
            R[i0:i0 + m] += v * pan
        # bass
        b = np.sin(2 * np.pi * hz(bass + 12) * np.arange(m) / SR) * env(int(seg * SR), 0.6, 2.0)[:m] * 0.05
        L[i0:i0 + m] += b * section_gain(t[i0:i0 + m], "bass")
        R[i0:i0 + m] += b * section_gain(t[i0:i0 + m], "bass")
        # arpeggio: eighth notes over the voicing (+ octave), a few gently skipped, soft velocities
        tones = voicing + [voicing[1] + 12, voicing[3] + 12]
        pattern = [0, 2, 4, 1, 3, 5, 2, 4]
        for s in range(16):
            if rng.random() < 0.18:
                continue
            ts = start + s * BEAT / 2
            if ts >= DUR:
                break
            p = pluck(hz(tones[pattern[s % 8]] + 12)) * (0.06 + 0.03 * rng.random())
            j0 = int(ts * SR)
            mm = min(len(p), n - j0)
            p = p[:mm] * section_gain(t[j0:j0 + mm], "arp")
            pan = 0.35 if s % 2 else 0.65
            L[j0:j0 + mm] += p * (1 - pan)
            R[j0:j0 + mm] += p * pan
        start += CHORD_LEN
        k += 1

    pad_gain = section_gain(t, "pad")
    L, R = lowpass(L, 2600) * pad_gain, lowpass(R, 2600) * pad_gain

    # simple stereo reverb: decaying filtered noise impulse
    ir_len = int(2.6 * SR)
    decay = np.exp(-np.arange(ir_len) / (0.55 * SR))
    irL = lowpass(rng.standard_normal(ir_len), 5000) * decay
    irR = lowpass(rng.standard_normal(ir_len), 5000) * decay
    irL /= np.sqrt((irL ** 2).sum())
    irR /= np.sqrt((irR ** 2).sum())
    wetL, wetR = fftconvolve(L, irL)[:n], fftconvolve(R, irR)[:n]
    L, R = 0.78 * L + 0.32 * wetL, 0.78 * R + 0.32 * wetR

    # keep it light on laptop speakers: no rumble under ~70 Hz
    bh, ah = butter(2, 70 / (SR / 2), btype="high")
    L, R = lfilter(bh, ah, L), lfilter(bh, ah, R)
    stereo = np.stack([L, R], axis=1)
    stereo -= stereo.mean(axis=0)
    stereo /= np.abs(stereo).max() / 0.89  # peak about -1 dBFS
    fade = np.ones(n)
    fade[-int(4 * SR):] = np.linspace(1, 0, int(4 * SR)) ** 2
    return stereo * fade[:, None]


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    audio = build()
    wavfile.write(OUT / "bgm.wav", SR, (audio * 32767).astype(np.int16))
    print("wrote", OUT / "bgm.wav", f"{len(audio) / SR:.1f}s")
