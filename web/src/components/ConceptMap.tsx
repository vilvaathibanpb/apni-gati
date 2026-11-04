import { useMemo } from 'react'
import type { GraphNode, MasteryRow } from '../lib/api'

const NODE_W = 132
const NODE_H = 40
const COL_GAP = 46
const ROW_GAP = 12
const TOP = 30
const PAD = 14

function wrap(name: string, max = 19): string[] {
  const words = name.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/\s+/)
  const lines: string[] = ['']
  for (const w of words) {
    const cur = lines[lines.length - 1]
    if ((cur + ' ' + w).trim().length <= max) lines[lines.length - 1] = (cur + ' ' + w).trim()
    else if (lines.length < 2) lines.push(w)
    else {
      lines[1] = (lines[1] + ' ' + w).trim()
    }
  }
  return lines.map((l, i) => (i === 1 && l.length > max ? l.slice(0, max - 1) + '…' : l))
}

export function masteryTone(m: { p: number; n: number } | undefined): 'red' | 'amber' | 'green' | 'grey' {
  if (!m || m.n === 0) return 'grey'
  if (m.p < 0.4) return 'red'
  if (m.p < 0.8) return 'amber'
  return 'green'
}

const FILL = { red: '#fbe6e5', amber: '#fdf1dc', green: '#e3f2e8', grey: '#f7f4ec' }
const STROKE = { red: '#d2161f', amber: '#c77700', green: '#2f7d4f', grey: '#d8d0bf' }
const TEXT = { red: '#9e0f17', amber: '#8a5300', green: '#215a38', grey: '#8089a3' }

interface Props {
  nodes: GraphNode[]
  mastery: MasteryRow[]
  chain?: string[]
  rootId?: string | null
  onPick?: (id: string) => void
}

export function ConceptMap({ nodes, mastery, chain = [], rootId, onPick }: Props) {
  const layout = useMemo(() => {
    const grades = [...new Set(nodes.map((n) => n.grade))].sort((a, b) => a - b)
    const strandOrder = [...new Set(nodes.map((n) => n.strand))]
    const cols = grades.map((g) => nodes.filter((n) => n.grade === g).sort((a, b) => strandOrder.indexOf(a.strand) - strandOrder.indexOf(b.strand)))
    const pos: Record<string, { x: number; y: number }> = {}
    const place = () =>
      cols.forEach((col, ci) =>
        col.forEach((n, ri) => {
          pos[n.id] = { x: PAD + ci * (NODE_W + COL_GAP), y: TOP + ri * (NODE_H + ROW_GAP) }
        }),
      )
    place()
    // two barycentre passes to reduce edge crossings
    for (let pass = 0; pass < 2; pass++) {
      cols.forEach((col, ci) => {
        if (ci === 0) return
        const bary = (n: GraphNode) => {
          const ys = n.prereqs.map((p) => pos[p]?.y).filter((y): y is number => y !== undefined)
          return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : (pos[n.id]?.y ?? 0)
        }
        col.sort((a, b) => bary(a) - bary(b))
      })
      place()
    }
    const maxRows = Math.max(...cols.map((c) => c.length), 1)
    return { grades, pos, width: PAD * 2 + grades.length * NODE_W + (grades.length - 1) * COL_GAP, height: TOP + maxRows * (NODE_H + ROW_GAP) + PAD }
  }, [nodes])

  const m = useMemo(() => Object.fromEntries(mastery.map((r) => [r.concept_id, r])), [mastery])
  const inChain = new Set(chain)

  const edge = (from: string, to: string) => {
    const a = layout.pos[from]
    const b = layout.pos[to]
    if (!a || !b) return ''
    const sx = a.x + NODE_W
    const sy = a.y + NODE_H / 2
    const tx = b.x
    const ty = b.y + NODE_H / 2
    if (tx > sx) {
      const dx = (tx - sx) / 2
      return `M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`
    }
    // same column (or backwards): loop around the right side
    const bulge = NODE_W * 0.35 + Math.abs(ty - sy) * 0.15
    return `M${sx},${sy} C${sx + bulge},${sy} ${b.x + NODE_W + bulge},${ty} ${b.x + NODE_W},${ty}`
  }

  // chain goes from observed failure down to the root; draw root -> ... -> failure so it reads left-to-right
  const chainPairs: [string, string][] = []
  for (let i = chain.length - 1; i > 0; i--) chainPairs.push([chain[i], chain[i - 1]])

  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-xl bg-white/70 no-scrollbar">
      <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} className="block">
        {layout.grades.map((g, i) => (
          <g key={g}>
            <rect x={PAD + i * (NODE_W + COL_GAP) - 8} y={4} width={NODE_W + 16} height={layout.height - 8} rx={12} fill={i % 2 ? '#fbf8f1' : '#f6f2e8'} />
            <text x={PAD + i * (NODE_W + COL_GAP) + NODE_W / 2} y={20} textAnchor="middle" fontSize={11} fontWeight={700} fill="#8089a3" letterSpacing="0.08em">
              CLASS {g}
            </text>
          </g>
        ))}
        {nodes.flatMap((n) => n.prereqs.map((p) => <path key={`${p}-${n.id}`} d={edge(p, n.id)} fill="none" stroke="#d8d0bf" strokeWidth={1.1} />))}
        {chainPairs.map(([a, b], i) => (
          <g key={`c${i}`}>
            <path d={edge(a, b)} fill="none" stroke="#d2161f" strokeOpacity={0.18} strokeWidth={7} strokeLinecap="round" />
            <path d={edge(a, b)} fill="none" stroke="#d2161f" strokeWidth={2.4} strokeLinecap="round" className="chain-flow" />
          </g>
        ))}
        {nodes.map((n) => {
          const p = layout.pos[n.id]
          const tone = masteryTone(m[n.id])
          const lines = wrap(n.name)
          const hot = inChain.has(n.id)
          const root = n.id === rootId
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => onPick?.(n.id)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
              <title>{`${n.name} (Class ${n.grade})${m[n.id] ? ` · P(known) ${Math.round(m[n.id].p * 100)}%` : ' · no evidence'}`}</title>
              <rect width={NODE_W} height={NODE_H} rx={9} fill={FILL[tone]} stroke={hot ? '#d2161f' : STROKE[tone]} strokeWidth={hot ? 2.2 : 1} strokeDasharray={tone === 'grey' && !hot ? '3 3' : undefined} />
              {lines.map((l, i) => (
                <text key={i} x={9} y={lines.length === 1 ? NODE_H / 2 + 4 : 16 + i * 13} fontSize={10.5} fontWeight={hot ? 700 : 500} fill={hot ? '#9e0f17' : TEXT[tone]}>
                  {l}
                </text>
              ))}
              {m[n.id] && m[n.id].n > 0 && (
                <text x={NODE_W - 6} y={11} textAnchor="end" fontSize={8.5} fontWeight={700} fill={TEXT[tone]}>
                  {Math.round(m[n.id].p * 100)}
                </text>
              )}
              {root && (
                <path
                  d={`M${NODE_W * 0.1},-5 C${-14},2 ${-12},${NODE_H + 8} ${NODE_W / 2},${NODE_H + 7} C${NODE_W + 14},${NODE_H + 6} ${NODE_W + 12},-8 ${NODE_W * 0.4},-6`}
                  fill="none"
                  stroke="#d2161f"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  pathLength={1}
                  className="mark-path"
                  style={{ ['--len' as string]: 1, ['--dur' as string]: '0.8s', ['--delay' as string]: '0.3s' }}
                />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function MapLegend() {
  const items: [keyof typeof FILL, string][] = [
    ['red', 'gap (<40%)'],
    ['amber', 'shaky (<80%)'],
    ['green', 'secure'],
    ['grey', 'no evidence'],
  ]
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
      {items.map(([t, l]) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border" style={{ background: FILL[t], borderColor: STROKE[t] }} /> {l}
        </span>
      ))}
      <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-pen" /> root-cause chain</span>
    </div>
  )
}
