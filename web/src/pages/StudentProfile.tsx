import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookOpenText, Check, Trash2, CheckCircle2, ChevronDown, Microscope, RefreshCw, Search, Wrench, X, XCircle } from 'lucide-react'
import { api, pct, pretty, type DiagnosisResult, type Probe, type StudentDetail, type TraceItem } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { ConceptMap, MapLegend } from '../components/ConceptMap'
import { isBehind } from './ClassHome'
import { ConceptChip, SyllabusBar, TrackBadge, conceptState, fmtDate } from '../components/Homework'
import { AgentProgress, BackBar, ConfirmDialog, Badge, Empty, ErrorNote, SectionTitle, Spinner, StatusChip, timeAgo } from '../ui'

export default function StudentProfile() {
  const { id = '' } = useParams()
  const st = useAsync(() => api.student(id), [id])
  const graph = useAsync(api.graph, [])
  const [fresh, setFresh] = useState<DiagnosisResult | null>(null)
  const diag = useAction(api.diagnose)
  const [answeredNow, setAnsweredNow] = useState(0)

  const s = st.data
  const latest: DiagnosisResult | null = useMemo(() => {
    if (fresh) return fresh
    const row = s?.diagnoses?.[0]
    return row ? { ...row.result, trace: row.trace ?? row.result.trace ?? [] } : null
  }, [fresh, s])

  if (st.loading) return <Spinner />
  if (st.error || !s) return <ErrorNote error={st.error ?? 'Student not found'} onRetry={st.reload} />

  const runDiagnosis = async () => {
    const r = await diag.run(id)
    if (r) {
      setFresh(r)
      setAnsweredNow(0)
      await st.reload()
    }
  }

  const behind = isBehind(s)
  const openProbes = s.probes.filter((p) => p.answer === null)
  const doneProbes = s.probes.filter((p) => p.answer !== null)

  return (
    <div>
      <BackBar to={`/class/${s.class_id}`} label="Class" />
      <div className="card ruled mb-4 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold tracking-tight">{s.name}</div>
            <div className="text-sm text-ink-2">Enrolled in Class {s.grade}{s.language ? ` · ${s.language}` : ''}</div>
          </div>
          {behind && <Badge tone="pen">2+ years behind</Badge>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Learning frontier</div>
            <div className={`font-semibold ${behind ? 'text-pen' : ''}`}>{s.frontier ?? (s.mastery.length ? 'On track' : 'No evidence yet')}</div>
            {s.frontier_grade !== null && <div className="text-xs text-ink-3">Class {s.frontier_grade} concept</div>}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Root cause</div>
            <div className="hand text-xl font-bold leading-tight text-pen">{s.root_cause ?? <span className="font-sans text-sm font-normal text-ink-3">not diagnosed</span>}</div>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-xs text-ink-2">
          <span><b className="text-ink">{s.concepts_mastered}</b> concepts secure</span>
          <span><b className="text-ink">{s.attempts.filter((a) => a.correct).length}/{s.attempts.length}</b> recent correct</span>
        </div>
      </div>

      <SyllabusSection s={s} />

      <SectionTitle>Concept map</SectionTitle>
      <div className="card p-2">
        {graph.loading ? <Spinner /> : graph.error ? <ErrorNote error={graph.error} /> : graph.data && (
          <ConceptMap nodes={graph.data.nodes} mastery={s.mastery} chain={latest?.chain ?? []} rootId={latest?.root_concept?.id ?? latest?.root_concept_id} />
        )}
        <div className="space-y-1 px-2 pb-1 pt-2">
          <MapLegend />
          <div className="text-[11px] text-ink-3">Prerequisites flow left → right by NCERT class. Scroll sideways on a phone.</div>
        </div>
      </div>

      <SectionTitle>Root cause</SectionTitle>
      {diag.running ? (
        <AgentProgress
          title="Muse Wonder is investigating…"
          elapsed={diag.elapsed}
          expected="30–120 s"
          steps={['Reading graded problems and probe answers', 'Checking knowledge-tracing estimates', 'Walking back through prerequisites', 'Comparing competing hypotheses', 'Writing probe questions', 'Verifying every probe with sympy']}
        />
      ) : (
        <>
          <ErrorNote error={diag.error} />
          {latest ? (
            <DiagnosisCard d={latest} nodes={graph.data?.nodes} />
          ) : (
            <Empty title="Not diagnosed yet" icon={<Microscope size={28} />}>
              {s.attempts.length ? 'Muse Wonder will trace this child’s errors back to the earliest missing prerequisite.' : 'Mark a few of this child’s notebook pages first, so the agent has evidence to work with.'}
            </Empty>
          )}
          <button onClick={runDiagnosis} className={`btn mt-3 w-full ${latest ? 'btn-ghost' : 'btn-primary'}`}>
            {latest ? <RefreshCw size={17} /> : <Search size={17} />} {latest ? (answeredNow ? 'Re-run diagnosis with probe answers' : 'Re-run diagnosis') : 'Find root cause'}
          </button>
        </>
      )}

      {(openProbes.length > 0 || doneProbes.length > 0) && (
        <>
          <SectionTitle>Probe questions</SectionTitle>
          <div className="space-y-2">
            {openProbes.map((p) => <ProbeCard key={p.id} probe={p} onAnswered={() => setAnsweredNow((n) => n + 1)} />)}
            {doneProbes.map((p) => <ProbeCard key={p.id} probe={p} />)}
          </div>
          {answeredNow > 0 && !diag.running && (
            <button onClick={runDiagnosis} className="btn btn-primary mt-3 w-full"><RefreshCw size={17} /> Re-run diagnosis with {answeredNow} new answer{answeredNow > 1 ? 's' : ''}</button>
          )}
        </>
      )}

      <Activity s={s} />
      <DangerZone id={s.id} name={s.name} classId={s.class_id} />
    </div>
  )
}

function DiagnosisCard({ d, nodes }: { d: DiagnosisResult; nodes?: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false)
  const name = (cid: string) => nodes?.find((n) => n.id === cid)?.name ?? pretty(cid)
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line/70 bg-pen-soft/40 px-5 py-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-pen/80">Earliest gap</div>
        <div className="hand mt-0.5 text-3xl font-bold leading-tight text-pen">{d.root_concept?.name ?? '—'}</div>
        {d.root_concept && (
          <div className="mt-1 text-xs text-ink-2">
            NCERT Class {d.root_concept.grade} · {d.root_concept.ncert_ref}
          </div>
        )}
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="text-[15px] leading-relaxed">{d.teacher_summary}</p>
        {d.chain && d.chain.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {d.chain.map((c, i) => (
              <span key={c + i} className="inline-flex items-center gap-1">
                <span className={`rounded-md px-1.5 py-0.5 ${i === d.chain!.length - 1 ? 'bg-pen font-semibold text-white' : 'bg-paper-2 text-ink-2'}`}>{name(c)}</span>
                {i < d.chain!.length - 1 && <span className="text-pen">←</span>}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          {d.confidence !== undefined && <span>Confidence <b className="text-ink">{pct(d.confidence)}</b></span>}
          {d.misconception_ids && d.misconception_ids.length > 0 && <span>Misconceptions: {d.misconception_ids.map(pretty).join(', ')}</span>}
        </div>
        {d.alternative_hypothesis && (
          <div className="rounded-xl border border-dashed border-line bg-paper/60 px-3 py-2 text-sm text-ink-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Alternative hypothesis · </span>
            {d.alternative_hypothesis}
          </div>
        )}
      </div>
      {d.trace?.length > 0 && (
        <div className="border-t border-line/70">
          <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold">
            <span className="flex items-center gap-2"><Wrench size={15} className="text-ink-3" /> Agent’s investigation <span className="font-normal text-ink-3">{d.trace.length} tool calls</span></span>
            <ChevronDown size={16} className={`transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && <ToolTimeline items={d.trace} />}
        </div>
      )}
    </div>
  )
}

const TOOL_LABEL: Record<string, string> = {
  get_evidence: 'Read the evidence',
  get_mastery: 'Checked mastery estimates',
  get_concept: 'Looked up concept',
  verify_answer: 'Verified with sympy',
  submit_diagnosis: 'Submitted diagnosis',
}

function ToolTimeline({ items }: { items: TraceItem[] }) {
  return (
    <ol className="relative mx-5 mb-4 space-y-3 border-l-2 border-line pl-4">
      {items.map((t, i) => {
        const argStr = t.args && Object.keys(t.args).length ? Object.entries(t.args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ') : ''
        return (
          <li key={i} className="relative">
            <span className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-paper ${t.tool === 'submit_diagnosis' ? 'bg-pen' : t.tool === 'verify_answer' ? 'bg-leaf' : 'bg-ink'}`} />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold">{TOOL_LABEL[t.tool] ?? t.tool}</span>
              <code className="text-[11px] text-ink-3">{t.tool}</code>
            </div>
            {argStr && <div className="break-words font-mono text-[11.5px] text-ink-2">{argStr}</div>}
            {t.result_preview && <div className="mt-1 line-clamp-3 break-all rounded-md bg-paper-2/80 px-2 py-1 font-mono text-[11px] text-ink-3">{t.result_preview}</div>}
          </li>
        )
      })}
    </ol>
  )
}

function ProbeCard({ probe, onAnswered }: { probe: Probe; onAnswered?: () => void }) {
  const [answer, setAnswer] = useState('')
  const [res, setRes] = useState<{ correct: boolean; expected: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  let expected: { expr?: string; answer?: string } = {}
  try {
    expected = JSON.parse(probe.expected)
  } catch { /* stored as plain text */ }

  const answered = probe.answer !== null || res
  const correct = res ? res.correct : probe.correct === 1

  const submit = async () => {
    if (!answer.trim()) return
    setBusy(true)
    setErr(undefined)
    try {
      setRes(await api.answerProbe(probe.id, answer.trim()))
      onAnswered?.()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`card px-4 py-3 ${answered ? (correct ? 'border-leaf/30' : 'border-pen/30') : ''}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium">{probe.question}</div>
          <div className="mt-0.5 text-xs text-ink-3">{pretty(probe.concept_id)}{expected.expr ? ` · ${expected.expr}` : ''}</div>
        </div>
        {answered && (correct ? <CheckCircle2 className="shrink-0 text-leaf" size={22} /> : <XCircle className="shrink-0 text-pen" size={22} />)}
      </div>
      {answered ? (
        <div className="mt-2 text-sm">
          Child said <b className={correct ? 'text-leaf' : 'text-pen'}>{res ? answer : probe.answer}</b>
          {!correct && <span className="text-ink-2"> · expected <b>{res?.expected ?? expected.answer}</b></span>}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <input className="input" placeholder="Child’s answer" value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} inputMode="text" />
          <button onClick={submit} disabled={busy || !answer.trim()} className="btn btn-ink shrink-0 px-4"><Check size={16} /></button>
        </div>
      )}
      <ErrorNote error={err} />
    </div>
  )
}

function Activity({ s }: { s: StudentDetail }) {
  return (
    <>
      <SectionTitle>Notebook pages</SectionTitle>
      {s.pages.length === 0 ? (
        <p className="text-sm text-ink-3">No pages yet.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {s.pages.map((p) => (
            <Link key={p.id} to={`/page/${p.id}`} className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-paper-2 shadow-sm">
              {(p.overlay_url || p.image_url) && <img src={p.overlay_url ?? p.image_url ?? ''} alt="" className="h-full w-full object-cover" loading="lazy" />}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent px-1.5 pb-1 pt-4 text-[11px] font-semibold text-white">
                {p.result?.score ? `${p.result.score.correct}/${p.result.score.total}` : <StatusChip status={p.status} />}
              </div>
            </Link>
          ))}
        </div>
      )}

      <SectionTitle>Reading</SectionTitle>
      {s.readings.length === 0 ? (
        <p className="text-sm text-ink-3">No reading tests yet.</p>
      ) : (
        <div className="card divide-y divide-line/70">
          {s.readings.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <BookOpenText size={18} className="shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{r.result?.level ? pretty(r.result.level) : r.passage_id}</div>
                <div className="text-xs text-ink-3">{r.result?.language ?? ''} · {timeAgo(r.created)}</div>
              </div>
              {r.status === 'done' && r.result ? (
                <div className="text-right text-xs">
                  <div className="font-semibold">{pct(r.result.accuracy)} accurate</div>
                  <div className="text-ink-3">{r.result.wcpm ?? '—'} wcpm</div>
                </div>
              ) : (
                <StatusChip status={r.status} />
              )}
            </div>
          ))}
        </div>
      )}

      <SectionTitle>Recent attempts</SectionTitle>
      {s.attempts.length === 0 ? (
        <p className="text-sm text-ink-3">No attempts recorded.</p>
      ) : (
        <div className="card divide-y divide-line/70">
          {s.attempts.slice(0, 15).map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-2">
              {a.correct ? <Check size={16} className="mt-0.5 shrink-0 text-leaf" /> : <X size={16} className="mt-0.5 shrink-0 text-pen" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px]">{a.problem}</div>
                <div className="truncate text-[11px] text-ink-3">
                  {pretty(a.concept_id)}
                  {a.misconception_id && <span className="text-pen"> · {pretty(a.misconception_id)}</span>}
                  {a.source === 'probe' && ' · probe'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function DangerZone({ id, name, classId }: { id: string; name: string; classId: string }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const first = name.split(/\s+/)[0]
  const erase = async () => {
    if (typed.trim().toLowerCase() !== first.toLowerCase()) return
    setBusy(true)
    setErr(undefined)
    try {
      await api.deleteStudent(id)
      nav(`/class/${classId}`, { replace: true })
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <>
      <SectionTitle>Privacy</SectionTitle>
      <div className="card flex flex-col gap-3 border-pen/20 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex-1 text-sm text-ink-2">Erase everything stored about {first}: notebook photos, red-pen overlays, voice recordings, marks and diagnoses.</div>
        <button onClick={() => { setTyped(''); setErr(undefined); setOpen(true) }} className="btn btn-ghost shrink-0 border-pen/40 text-pen"><Trash2 size={16} /> Delete child’s data</button>
      </div>
      <ConfirmDialog open={open} danger busy={busy} confirmDisabled={typed.trim().toLowerCase() !== first.toLowerCase()} title={`Delete all of ${name}’s data?`} confirmLabel="Delete forever" onCancel={() => setOpen(false)} onConfirm={erase}>
        <p>This permanently removes {first}’s pages, recordings, marks, diagnoses and probes from this server. It can’t be undone.</p>
        <label className="mt-3 block text-xs font-semibold text-ink">Type <b>{first}</b> to confirm</label>
        <input className="input mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus disabled={busy} />
        {typed && typed.trim().toLowerCase() !== first.toLowerCase() && <div className="mt-1 text-xs text-pen">Name doesn’t match.</div>}
        <ErrorNote error={err} />
      </ConfirmDialog>
    </>
  )
}

function SyllabusSection({ s }: { s: StudentDetail }) {
  const sp = s.syllabus_progress
  const hws = s.homeworks ?? []
  const order = { mastered: 0, learning: 1, new: 2 } as const
  const concepts = [...(sp?.concepts ?? [])].sort((a, b) => order[conceptState(a)] - order[conceptState(b)])
  return (
    <>
      <SectionTitle right={<span className="text-xs text-ink-3">{sp?.percent ?? 0}% mastered</span>}>Syllabus progress</SectionTitle>
      <div className="card px-4 py-3.5">
        {!sp || sp.total === 0 ? (
          <p className="text-sm text-ink-3">No syllabus set for this class yet. <Link to={`/class/${s.class_id}/setup`} className="font-semibold text-pen underline">Set it up</Link></p>
        ) : (
          <>
            <SyllabusBar p={sp} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {concepts.map((c) => <ConceptChip key={c.id} c={c} />)}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-leaf" /> mastered</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber" /> learning</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-line" /> not started</span>
            </div>
          </>
        )}
      </div>

      <SectionTitle right={<Link to={`/class/${s.class_id}/homework`} className="text-xs font-semibold text-ink-2 underline decoration-pen/40 underline-offset-2">Tonight’s homework</Link>}>Homework history</SectionTitle>
      {hws.length === 0 ? (
        <p className="text-sm text-ink-3">No homework yet.</p>
      ) : (
        <div className="card divide-y divide-line/70 overflow-hidden">
          {hws.map((h) => {
            const body = (
              <>
                <div className="w-14 shrink-0 text-xs font-semibold text-ink-2">{fmtDate(h.created)}</div>
                <div className="min-w-0 flex-1">
                  <TrackBadge track={h.track} label={h.track_label} />
                  <div className="mt-0.5 truncate text-[11px] text-ink-3">{h.items.length} questions{h.plan?.why ? ` · ${h.plan.why}` : ''}</div>
                </div>
                {h.status === 'graded' && h.result ? (
                  <div className={`hand shrink-0 text-2xl font-bold leading-none ${h.result.correct === h.result.total ? 'text-leaf' : 'text-pen'}`}>{h.result.correct}/{h.result.total}</div>
                ) : (
                  <Badge tone={h.status === 'submitted' ? 'ink' : 'grey'}>{h.status === 'submitted' ? 'marking' : h.status}</Badge>
                )}
              </>
            )
            return h.page_id ? (
              <Link key={h.id} to={`/page/${h.page_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper-2/60">{body}</Link>
            ) : (
              <a key={h.id} href={`/hw/${h.token}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper-2/60">{body}</a>
            )
          })}
        </div>
      )}
    </>
  )
}
