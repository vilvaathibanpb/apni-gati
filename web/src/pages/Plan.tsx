import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BadgeCheck, CalendarDays, Clock, Download, FileImage, Package, Printer, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { api, worksheetFromRow, type PlanGroup, type Worksheet } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { AgentProgress, BackBar, Badge, Empty, ErrorNote, H1, SectionTitle, Spinner, timeAgo } from '../ui'

const GROUP_COLORS = ['#d2161f', '#1d2b53', '#c77700', '#2f7d4f', '#7a3fa0']

export default function PlanPage() {
  const { id = '' } = useParams()
  const klass = useAsync(() => api.klass(id), [id])
  const plan = useAsync(() => api.plan(id), [id])
  const make = useAction(api.makePlan)

  const generate = async () => {
    const r = await make.run(id)
    if (r) await plan.reload()
  }

  const p = plan.data

  return (
    <div>
      <BackBar to={`/class/${id}`} label={klass.data?.name ?? 'Class'} />
      <H1 sub="Teaching at the Right Level: children grouped by what they’re ready to learn, not by the grade they’re enrolled in.">Tomorrow’s maths period</H1>

      {plan.loading ? (
        <Spinner />
      ) : make.running ? (
        <AgentProgress
          title="Muse Wonder is grouping children by learning level…"
          elapsed={make.elapsed}
          expected="30–90 s"
          steps={['Finding each child’s learning frontier', 'Merging into at most four groups', 'Collecting frequent misconceptions per group', 'Designing activities with free local materials', 'Writing practice items in Indian contexts', 'Verifying every practice answer with sympy']}
        />
      ) : (
        <>
          <ErrorNote error={plan.error ?? make.error} onRetry={plan.error ? plan.reload : undefined} />
          {!p ? (
            <Empty title="No plan yet" icon={<CalendarDays size={28} />}>
              {klass.data && klass.data.students.length === 0 ? 'Add children to this class first.' : 'Muse Wonder groups the class by learning frontier and writes a lesson for each group.'}
            </Empty>
          ) : null}
          <button onClick={generate} className={`btn mt-3 w-full ${p ? 'btn-ghost' : 'btn-primary py-3.5'}`}>
            {p ? <RefreshCw size={17} /> : <Sparkles size={18} />} {p ? 'Re-plan tomorrow’s class' : 'Plan tomorrow’s class'}
          </button>
        </>
      )}

      {p && !make.running && (
        <>
          <div className="mt-2 text-right text-xs text-ink-3">Planned {timeAgo(p.created)}</div>
          {p.rotation && (
            <div className="card ruled mt-3 px-5 py-4 pl-10">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Rotation</div>
              <p className="mt-1 text-[15px] leading-8">{p.rotation}</p>
            </div>
          )}
          {p.groups.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
              {p.groups.map((g, i) => (
                <a key={g.key} href={`#g-${g.key}`} className="shrink-0 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold" style={{ color: GROUP_COLORS[i % GROUP_COLORS.length] }}>
                  {g.title} · {g.students.length}
                </a>
              ))}
            </div>
          )}
          <SectionTitle>Groups</SectionTitle>
          <div className="space-y-4">
            {p.groups.map((g, i) => (
              <GroupCard key={g.key} classId={id} g={g} color={GROUP_COLORS[i % GROUP_COLORS.length]} initialSheet={worksheetFromRow(p.worksheets?.[g.key])} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function GroupCard({ classId, g, color, initialSheet }: { classId: string; g: PlanGroup; color: string; initialSheet: Worksheet | null }) {
  const [sheet, setSheet] = useState<Worksheet | null>(initialSheet)
  const ws = useAction(api.worksheet)
  const makeSheet = async () => {
    const r = await ws.run(classId, g.key)
    if (r) setSheet(r)
  }

  return (
    <article id={`g-${g.key}`} className="card scroll-mt-20 overflow-hidden">
      <div className="h-1.5" style={{ background: color }} />
      <div className="px-5 pb-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="hand text-[1.9rem] font-bold leading-none" style={{ color }}>{g.title}</h3>
          {g.activity_minutes ? <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-3"><Clock size={12} /> {g.activity_minutes} min</span> : null}
        </div>
        {g.focus_concept && (
          <div className="mt-1.5 text-sm">
            <span className="font-semibold">{g.focus_concept.name}</span>
            <span className="text-ink-3"> · NCERT Class {g.focus_concept.grade} · {g.focus_concept.ncert_ref}</span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {g.students.map((s) => (
            <Link key={s.id} to={`/student/${s.id}`} className="rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium hover:border-ink/30">
              {s.name} <span className="text-ink-3">C{s.grade}</span>
            </Link>
          ))}
          {g.students.length === 0 && <span className="text-xs text-ink-3">No children assigned</span>}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-ink-2"><b className="text-ink">Why: </b>{g.why}</p>

        {g.materials?.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Package size={14} className="text-ink-3" />
            {g.materials.map((m, i) => <span key={i} className="rounded-md bg-paper-2 px-2 py-0.5 text-xs">{m}</span>)}
          </div>
        )}

        {g.steps?.length > 0 && (
          <ol className="mt-4 space-y-2">
            {g.steps.map((st, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="hand flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: color }}>{i + 1}</span>
                <span className="pt-0.5">{st}</span>
              </li>
            ))}
          </ol>
        )}

        {g.teacher_script_local && (
          <div className="mt-4 rounded-xl border-l-4 bg-paper-2/70 px-4 py-3" style={{ borderColor: color }}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Say to the group</div>
            <p className="mt-1 text-[16px] leading-relaxed">{g.teacher_script_local}</p>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Practice</div>
            <div className="flex gap-1.5">
              {g.practice.length > 0 && <Badge tone="leaf"><BadgeCheck size={11} /> {g.practice.length} verified</Badge>}
              {g.practice_rejected > 0 && <Badge tone="amber"><ShieldAlert size={11} /> {g.practice_rejected} rejected by verifier</Badge>}
            </div>
          </div>
          <ol className="divide-y divide-line/60 rounded-xl border border-line bg-white">
            {g.practice.map((it, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-4 shrink-0 text-xs text-ink-3">{i + 1}</span>
                <span className="flex-1">{it.question}</span>
                <span className="shrink-0 font-mono text-xs text-leaf">= {it.answer} ✓</span>
              </li>
            ))}
            {g.practice.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">No practice items passed verification.</li>}
          </ol>
        </div>

        {g.exit_check && (
          <div className="mt-3 text-sm"><b>Exit check: </b><span className="text-ink-2">{g.exit_check}</span></div>
        )}

        <div className="mt-4 border-t border-dashed border-line pt-4">
          {ws.running ? (
            <AgentProgress title="Muse Image is drawing the worksheet…" elapsed={ws.elapsed} expected="30–60 s" steps={['Laying out the sheet', 'Illustrating the margins', 'Reading the rendered sheet back', 'Checking every question against the verified items']} />
          ) : sheet ? (
            <WorksheetView sheet={sheet} onRedo={makeSheet} />
          ) : (
            <button onClick={makeSheet} disabled={g.practice.length === 0} className="btn btn-ink w-full">
              <FileImage size={17} /> Make worksheet
            </button>
          )}
          <ErrorNote error={ws.error} />
        </div>
      </div>
    </article>
  )
}

function WorksheetView({ sheet, onRedo }: { sheet: Worksheet; onRedo: () => void }) {
  const last = sheet.verification[sheet.verification.length - 1]
  const n = sheet.items.length
  return (
    <div>
      {sheet.verified ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-leaf-soft px-3 py-2 text-sm font-medium text-leaf">
          <BadgeCheck size={16} /> Verified: all {n} questions match{sheet.verification.length > 1 ? ` (after ${sheet.verification.length} attempts)` : ''}
        </div>
      ) : (
        <div className="mb-2 rounded-xl bg-amber-soft px-3 py-2 text-sm text-amber">
          <div className="flex items-center gap-2 font-medium"><ShieldAlert size={16} /> {last?.mismatches.length ?? '?'} question{last?.mismatches.length === 1 ? '' : 's'} didn’t render exactly — check before printing</div>
          {last?.mismatches.map((m) => (
            <div key={m.n} className="mt-0.5 font-mono text-xs">Q{m.n}: expected {m.expected}, sheet shows {m.rendered ?? 'nothing'}</div>
          ))}
        </div>
      )}
      {sheet.image_url && (
        <a href={sheet.image_url} target="_blank" rel="noreferrer">
          <img src={sheet.image_url} alt="Generated worksheet" className="w-full rounded-xl border border-line bg-white shadow-sm" />
        </a>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {sheet.image_url && <a href={sheet.image_url} download className="btn btn-ghost px-2 text-sm"><Download size={15} /> Save</a>}
        {sheet.image_url && <button onClick={() => printImage(sheet.image_url!)} className="btn btn-ghost px-2 text-sm"><Printer size={15} /> Print</button>}
        <button onClick={onRedo} className="btn btn-ghost px-2 text-sm"><RefreshCw size={15} /> Redo</button>
      </div>
    </div>
  )
}

function printImage(url: string) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<!doctype html><title>Worksheet</title><style>@page{margin:8mm}body{margin:0}img{width:100%;}</style><img src="${new URL(url, window.location.href).href}" onload="setTimeout(()=>{window.print()},200)">`)
  w.document.close()
}
