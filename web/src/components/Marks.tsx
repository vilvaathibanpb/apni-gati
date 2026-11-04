import type { Box, Problem } from '../lib/api'

/** Deterministic pseudo-random from a seed, so marks look hand-drawn but stable between renders. */
function rng(seed: number) {
  let s = seed * 9301 + 49297
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

type Pt = [number, number]

/** Smooth a polyline with Catmull-Rom -> cubic bezier. */
function smooth(pts: Pt[]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

/** A loose, slightly overshooting ellipse like a teacher circling a mistake. */
export function handEllipse(box: Box, seed: number, pad: number): string {
  const r = rng(seed)
  const [x1, y1, x2, y2] = box
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const rx = (x2 - x1) / 2 + pad * 1.4
  const ry = (y2 - y1) / 2 + pad
  const start = -Math.PI * (0.62 + r() * 0.1)
  const sweep = Math.PI * 2 * (1.08 + r() * 0.06)
  const n = 22
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = start + (sweep * i) / n
    const wobble = 1 + (r() - 0.5) * 0.07 + (i / n) * 0.06 // spiral out a touch so the end doesn't meet the start
    pts.push([cx + Math.cos(t) * rx * wobble, cy + Math.sin(t) * ry * wobble])
  }
  return smooth(pts)
}

/** Shift a mark to the left of the box when there's no room on the right. */
function markX(box: Box, size: number, width: number, gap: number): number {
  return box[2] + gap + size * 1.1 <= width ? box[2] + gap : Math.max(0, box[0] - gap - size * 1.1)
}

export function tickPath(box: Box, size: number, width = Infinity): string {
  const [, y1, , y2] = box
  const x = markX(box, size, width, size * 0.25)
  const y = (y1 + y2) / 2
  return `M${x},${y - size * 0.05} Q${x + size * 0.18},${y + size * 0.2} ${x + size * 0.32},${y + size * 0.42} Q${x + size * 0.55},${y - size * 0.15} ${x + size * 1.05},${y - size * 0.7}`
}

export function crossPaths(box: Box, size: number, width = Infinity): [string, string] {
  const [, y1, , y2] = box
  const x = markX(box, size, width, size * 0.3)
  const y = (y1 + y2) / 2 - size * 0.4
  return [
    `M${x},${y} Q${x + size * 0.45},${y + size * 0.38} ${x + size * 0.85},${y + size * 0.82}`,
    `M${x + size * 0.82},${y + size * 0.02} Q${x + size * 0.4},${y + size * 0.4} ${x + size * 0.04},${y + size * 0.86}`,
  ]
}

export function answerBox(p: Problem): Box {
  return (p.answer_ink_px ?? p.answer_px ?? p.box_px) as Box
}

export function errorBox(p: Problem): Box {
  if (p.error_step !== null && p.error_step !== undefined && p.steps[p.error_step]) {
    const s = p.steps[p.error_step]
    return (s.ink_px ?? s.box_px) as Box
  }
  return answerBox(p)
}

interface MarksProps {
  problems: Problem[]
  size: [number, number]
  playKey: number
  selected: number | null
  onSelect: (i: number) => void
}

/** SVG overlay drawn from grading geometry. Coordinates are page-image pixels. */
export function MarksOverlay({ problems, size, playKey, selected, onSelect }: MarksProps) {
  const [w, h] = size
  const unit = Math.max(w, h) / 100 // 1% of the long side
  const sw = Math.max(2, unit * 0.55)
  const step = 0.45
  return (
    <svg key={playKey} viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
      <defs>
        <filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={Math.max(1, unit * 0.18)} />
        </filter>
      </defs>
      {problems.map((p, i) => {
        const delay = 0.25 + i * step
        const ans = answerBox(p)
        const ansH = Math.max(ans[3] - ans[1], unit * 3)
        const size = Math.min(Math.max(ansH * 1.15, unit * 3.2), unit * 9)
        const isSel = selected === i
        const common = { fill: 'none', stroke: '#d2161f', strokeWidth: isSel ? sw * 1.35 : sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, filter: 'url(#ink)', pathLength: 1 }
        const [bx1, by1, bx2, by2] = p.box_px
        return (
          <g key={i} onClick={() => onSelect(i)} style={{ cursor: 'pointer' }}>
            {/* generous hit area */}
            <rect x={bx1} y={by1} width={Math.max(1, bx2 - bx1)} height={Math.max(1, by2 - by1)} fill={isSel ? 'rgba(210,22,31,0.06)' : 'transparent'} stroke={isSel ? 'rgba(210,22,31,0.35)' : 'none'} strokeDasharray={`${unit} ${unit * 0.6}`} strokeWidth={sw * 0.4} rx={unit} />
            {p.status === 'correct' && <path d={tickPath(ans, size, w)} {...common} className="mark-path" style={{ ['--len' as string]: 1, ['--delay' as string]: `${delay}s`, ['--dur' as string]: '0.45s' }} />}
            {p.status === 'wrong' && (
              <>
                <path d={handEllipse(errorBox(p), i + 7, unit * 1.1)} {...common} className="mark-path" style={{ ['--len' as string]: 1, ['--delay' as string]: `${delay}s`, ['--dur' as string]: '0.75s' }} />
                {crossPaths(ans, size * 0.85, w).map((d, k) => (
                  <path key={k} d={d} {...common} className="mark-path" style={{ ['--len' as string]: 1, ['--delay' as string]: `${delay + 0.75 + k * 0.18}s`, ['--dur' as string]: '0.22s' }} />
                ))}
                {p.diagnosis?.pen_note && <PenNote text={p.diagnosis.pen_note} ans={ans} size={size} unit={unit} w={w} h={h} delay={delay + 1.2} />}
              </>
            )}
            {p.status === 'needs_review' && (
              <text x={markX(ans, size * 0.6, w, size * 0.3)} y={(ans[1] + ans[3]) / 2 + size * 0.35} fontFamily="Caveat, cursive" fontWeight={700} fontSize={size * 1.3} fill="#c77700" className="mark-pop" style={{ ['--delay' as string]: `${delay}s` }}>
                ?
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** The teacher's scribbled note: right of the cross if it fits, otherwise under (or above) the answer. */
function PenNote({ text, ans, size, unit, w, h, delay }: { text: string; ans: Box; size: number; unit: number; w: number; h: number; delay: number }) {
  const fs = Math.min(size * 0.85, unit * 5)
  const tw = text.length * fs * 0.42
  let x = ans[2] + size * 1.35
  let y = (ans[1] + ans[3]) / 2 + fs * 0.3
  if (x + tw > w - unit) {
    x = Math.max(unit, Math.min(ans[0], w - unit - tw))
    y = ans[3] + fs * 1.05 <= h - unit ? ans[3] + fs * 1.05 : ans[1] - fs * 0.35
  }
  return (
    <text x={x} y={y} fontFamily="Caveat, cursive" fontWeight={700} fontSize={fs} fill="#d2161f" className="mark-pop" style={{ ['--delay' as string]: `${delay}s` }}>
      {text}
    </text>
  )
}
