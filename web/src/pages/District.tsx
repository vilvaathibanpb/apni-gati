import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { api, type GraphNode } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { BackBar, Empty, ErrorNote, H1, SectionTitle, SimulatedBadge, Spinner } from '../ui'

// sequential single-hue ramp (red pen) for counts; ordered ink ramp for NCERT class of frontier
const HEAT = ['#fdf0ef', '#f8cfcc', '#f0a29d', '#e46b64', '#d2161f', '#9e0f17']
const GRADE = ['#c9d3ea', '#a4b3d8', '#7c8fc2', '#5670a8', '#36508a', '#1d2b53']

function heat(n: number, max: number) {
  if (!n) return 'transparent'
  return HEAT[Math.min(HEAT.length - 1, Math.floor((n / max) * (HEAT.length - 1) + 0.0001))]
}

export default function DistrictPage() {
  const d = useAsync(api.district, [])
  const g = useAsync(api.graph, [])
  const nodes = useMemo(() => Object.fromEntries((g.data?.nodes ?? []).map((n) => [n.id, n])) as Record<string, GraphNode>, [g.data])

  if (d.loading) return <Spinner />
  if (d.error || !d.data) return <ErrorNote error={d.error ?? 'No data'} onRetry={d.reload} />
  const { schools, top_misconceptions: top } = d.data
  const max = Math.max(1, ...schools.flatMap((s) => top.map((m) => s.misconceptions[m.id] ?? 0)))
  const grades = [...new Set((g.data?.nodes ?? []).map((n) => n.grade))].sort((a, b) => a - b)
  const district = schools.find((s) => !s.simulated)?.district ?? schools[0]?.district

  return (
    <div>
      <BackBar to="/" label="Classes" />
      <H1 sub={`${district ? `${district} · ` : ''}What children across schools are getting wrong, and how far behind they are.`}>District view</H1>
      {schools.length === 0 && <Empty title="No schools yet" icon={<BarChart3 size={28} />}>Schools appear here once they’re added on the server.</Empty>}

      {schools.length > 0 && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {schools.map((s) => {
              const share = s.n_students ? s.two_plus_grades_behind / s.n_students : 0
              return (
                <div key={s.id} className={`card px-4 py-3 ${s.simulated ? 'border-dashed' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{s.name}</div>
                      <div className="text-xs text-ink-3">{s.block ? `${s.block} · ` : ''}{s.n_students} children</div>
                    </div>
                    {!!s.simulated && <SimulatedBadge />}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className={`text-2xl font-bold tabular-nums ${s.two_plus_grades_behind ? 'text-pen' : ''}`}>{s.two_plus_grades_behind}</span>
                    <span className="text-xs text-ink-2">2+ grades behind{s.n_students ? ` · ${Math.round(share * 100)}%` : ''}</span>
                  </div>
                  <FrontierBar frontiers={s.frontiers} nodes={nodes} grades={grades} />
                </div>
              )
            })}
          </div>
          {grades.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-2">
              <span className="font-semibold text-ink-3">Learning frontier at:</span>
              {grades.map((gr, i) => (
                <span key={gr} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GRADE[Math.min(i, GRADE.length - 1)] }} /> Class {gr}</span>
              ))}
            </div>
          )}

          <SectionTitle>Top misconceptions by school</SectionTitle>
          {top.length === 0 ? (
            <Empty title="No misconceptions recorded yet">They appear once notebook pages have been marked.</Empty>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full border-separate border-spacing-[2px] text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-ink-3">Misconception</th>
                    {schools.map((s) => (
                      <th key={s.id} className="min-w-[72px] px-1 py-2 align-bottom text-[11px] font-semibold text-ink-2" title={s.name}>
                        <div className="line-clamp-2 leading-tight">{s.name}</div>
                        {!!s.simulated && <div className="text-[9px] font-medium text-ink-3">simulated</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {top.map((m) => (
                    <tr key={m.id}>
                      <td className="sticky left-0 z-10 max-w-[170px] bg-card px-3 py-1.5">
                        <div className="text-[13px] font-medium leading-tight">{m.name}</div>
                        <div className="text-[10px] text-ink-3">{nodes[m.concept_id] ? `Class ${nodes[m.concept_id].grade} · ` : ''}{m.total} total</div>
                      </td>
                      {schools.map((s) => {
                        const n = s.misconceptions[m.id] ?? 0
                        const dark = n / max > 0.55
                        return (
                          <td key={s.id} className="rounded-md text-center tabular-nums" style={{ background: n ? heat(n, max) : '#f7f4ec' }} title={`${s.name}: ${n} × ${m.name}`}>
                            <span className={`text-[13px] font-semibold ${n ? (dark ? 'text-white' : 'text-ink') : 'text-ink-3/50'}`}>{n || '·'}</span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-ink-3">Counts are diagnosed errors from marked notebook pages. Schools marked “Simulated data” are synthetic, generated to show how the view scales.</p>
        </>
      )}
    </div>
  )
}

function FrontierBar({ frontiers, nodes, grades }: { frontiers: Record<string, number>; nodes: Record<string, GraphNode>; grades: number[] }) {
  const byGrade: Record<number, number> = {}
  let total = 0
  for (const [cid, n] of Object.entries(frontiers)) {
    const gr = nodes[cid]?.grade
    if (gr === undefined) continue
    byGrade[gr] = (byGrade[gr] ?? 0) + n
    total += n
  }
  if (!total) return <div className="mt-2 text-[11px] text-ink-3">No learning frontiers yet</div>
  return (
    <div className="mt-2">
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {grades.map((gr, i) =>
          byGrade[gr] ? <div key={gr} style={{ width: `${(byGrade[gr] / total) * 100}%`, background: GRADE[Math.min(i, GRADE.length - 1)] }} title={`Class ${gr}: ${byGrade[gr]} children`} /> : null,
        )}
      </div>
      <div className="mt-1 text-[10px] text-ink-3">Frontier of {total} children with gaps</div>
    </div>
  )
}
