import type { SyllabusConceptProgress, SyllabusProgressSummary, Track } from '../lib/api'
import { Badge } from '../ui'

export const TRACK_ORDER: Track[] = ['challenge', 'on_track', 'practice', 'placement']

/** Labels mirror homework.TRACKS on the server (used when only the key is known). */
export const TRACK_LABEL: Record<Track, string> = {
  placement: 'Placement check',
  challenge: 'Ready for challenge',
  on_track: 'On track',
  practice: 'Needs practice',
}

const TRACK_TONE: Record<Track, 'leaf' | 'ink' | 'amber' | 'grey'> = {
  challenge: 'leaf',
  on_track: 'ink',
  practice: 'amber',
  placement: 'grey',
}

export const TRACK_DOT: Record<Track, string> = {
  challenge: 'bg-leaf',
  on_track: 'bg-ink',
  practice: 'bg-amber',
  placement: 'bg-ink-3',
}

export function TrackBadge({ track, label, className = '' }: { track: Track | string; label?: string; className?: string }) {
  const t = (track in TRACK_TONE ? track : 'placement') as Track
  return <Badge tone={TRACK_TONE[t]} className={className}>{label ?? TRACK_LABEL[t]}</Badge>
}

/** Progress over the class syllabus: mastered (solid) + learning (light). */
export function SyllabusBar({ p, compact }: { p: SyllabusProgressSummary | undefined; compact?: boolean }) {
  if (!p || !p.total) return compact ? null : <div className="text-xs text-ink-3">No syllabus set</div>
  const learn = Math.round((100 * p.learning) / p.total)
  return (
    <div className={compact ? 'w-full' : ''}>
      <div className={`flex overflow-hidden rounded-full bg-paper-2 ${compact ? 'h-1.5' : 'h-2'}`} role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Syllabus mastered">
        <div className="h-full bg-leaf transition-all duration-700" style={{ width: `${p.percent}%` }} />
        <div className="h-full bg-amber/45 transition-all duration-700" style={{ width: `${learn}%` }} />
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between text-[11px] text-ink-3">
          <span><b className="text-ink">{p.mastered}</b>/{p.total} topics mastered{p.learning ? ` · ${p.learning} learning` : ''}</span>
          <span className="font-semibold tabular-nums text-ink-2">{p.percent}%</span>
        </div>
      )}
    </div>
  )
}

export const MASTERED_P = 0.8

export function conceptState(c: SyllabusConceptProgress): 'mastered' | 'learning' | 'new' {
  if (c.p !== null && c.p >= MASTERED_P) return 'mastered'
  if (c.n > 0) return 'learning'
  return 'new'
}

export function ConceptChip({ c }: { c: SyllabusConceptProgress }) {
  const st = conceptState(c)
  const cls = st === 'mastered' ? 'border-leaf/30 bg-leaf-soft text-leaf' : st === 'learning' ? 'border-amber/30 bg-amber-soft text-amber' : 'border-line bg-paper-2 text-ink-3'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`} title={c.p !== null ? `p = ${c.p} · ${c.n} attempt${c.n === 1 ? '' : 's'}` : 'Not started'}>
      {c.name}
    </span>
  )
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function fmtDate(ts: number | undefined) {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
