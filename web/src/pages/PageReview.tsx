import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronRight, EyeOff, ShieldAlert, HelpCircle, Image as ImageIcon, Loader2, PenLine, RotateCcw, UserPlus, X } from 'lucide-react'
import { api, pretty, type Page, type Problem } from '../lib/api'
import { useAsync, useInterval } from '../lib/hooks'
import { MarksOverlay } from '../components/Marks'
import { ProblemDetail } from '../components/ProblemSheet'
import { BackBar, Badge, BottomSheet, Empty, ErrorNote, SectionTitle, Spinner, StatusChip } from '../ui'

export default function PageReview() {
  const { id = '' } = useParams()
  const page = useAsync(() => api.page(id), [id])
  const p = page.data
  const pending = p?.status === 'queued' || p?.status === 'grading'
  useInterval(() => void page.reload(), 3000, !!pending)

  const klass = useAsync(() => (p?.class_id ? api.klass(p.class_id) : Promise.resolve(null)), [p?.class_id])
  const [view, setView] = useState<'marks' | 'server'>('marks')
  const [playKey, setPlayKey] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [natural, setNatural] = useState<[number, number] | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [assignErr, setAssignErr] = useState<string>()

  useEffect(() => { setSelected(null) }, [id])

  if (page.loading) return <Spinner />
  if (page.error || !p) return <ErrorNote error={page.error ?? 'Page not found'} onRetry={page.reload} />

  const result = p.result ?? {}
  const problems = result.problems ?? []
  const size = (result.size as [number, number] | undefined) ?? natural
  const students = klass.data?.students ?? []
  const student = students.find((s) => s.id === p.student_id)
  const score = result.score

  const updateProblem = (i: number, prob: Problem) => {
    const nextProblems = problems.map((x, j) => (j === i ? prob : x))
    const nextScore = { correct: nextProblems.filter((x) => x.status === 'correct').length, total: nextProblems.length }
    const next: Page = { ...p, result: { ...result, problems: nextProblems, score: nextScore } }
    page.setData(next)
  }

  const assign = async (sid: string) => {
    if (!sid) return
    setAssigning(true)
    setAssignErr(undefined)
    try {
      page.setData(await api.assign(p.id, sid))
      void klass.reload()
    } catch (e) {
      setAssignErr((e as Error).message)
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div>
      <BackBar to={`/class/${p.class_id}/capture`} label="Pages" right={<StatusChip status={p.status} />} />

      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {student ? (
            <Link to={`/student/${student.id}`} className="group inline-flex items-center gap-1 text-2xl font-bold tracking-tight">
              {student.name} <ChevronRight size={18} className="text-ink-3 transition group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <div className="text-2xl font-bold tracking-tight">{result.student_name ? `“${result.student_name}”` : 'Unassigned page'}</div>
          )}
          <div className="text-sm text-ink-2">
            {student ? `Class ${student.grade}` : 'Not linked to a student yet'}
            {result.engine && <span className="text-ink-3"> · {result.engine}</span>}
            {!!result.capture?.faces_blurred && (
              <Badge tone="leaf" className="ml-1.5 align-middle"><EyeOff size={11} /> {result.capture.faces_blurred} face{result.capture.faces_blurred > 1 ? 's' : ''} blurred</Badge>
            )}
          </div>
        </div>
        {score && (
          <div className="relative shrink-0 text-center">
            <svg width="78" height="62" viewBox="0 0 78 62" className="absolute -left-1 -top-1" aria-hidden>
              <path d="M8 34 C 6 12, 64 4, 71 26 C 77 46, 34 60, 14 50 C 4 44, 6 30, 18 22" fill="none" stroke="#d2161f" strokeWidth="2.4" strokeLinecap="round" pathLength={1} className="mark-path" style={{ ['--len' as string]: 1, ['--delay' as string]: `${0.4 + problems.length * 0.45}s`, ['--dur' as string]: '0.6s' }} />
            </svg>
            <div className="hand relative px-3 pt-2 text-[2.1rem] font-bold leading-none text-pen">
              {score.correct}/{score.total}
            </div>
          </div>
        )}
      </div>

      {!p.student_id && p.status === 'done' && (
        <div className="card mb-3 flex flex-col gap-2 border-amber/40 bg-amber-soft/50 p-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber"><UserPlus size={16} /> Assign to student</div>
          <select className="input flex-1" defaultValue="" disabled={assigning} onChange={(e) => assign(e.target.value)}>
            <option value="" disabled>Choose a child…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name} · Class {s.grade}</option>
            ))}
          </select>
          {assigning && <Loader2 size={16} className="animate-spin text-amber" />}
          <ErrorNote error={assignErr} />
        </div>
      )}

      {(result.guardrails?.warnings ?? []).map((w, i) => (
        <div key={i} className={`mb-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${w.type === 'instructions_on_page' ? 'border-pen/30 bg-pen-soft/50 text-ink' : 'border-amber/30 bg-amber-soft/60 text-ink'}`}>
          <ShieldAlert size={17} className={`mt-0.5 shrink-0 ${w.type === 'instructions_on_page' ? 'text-pen' : 'text-amber'}`} />
          <div className="min-w-0">
            {w.type === 'instructions_on_page' ? (
              <>
                <div className="font-semibold">Text on this page tried to instruct the grader — ignored; grades come from sympy only.</div>
                {w.text && <div className="mt-0.5 break-words font-mono text-xs text-ink-2">“{w.text}”</div>}
              </>
            ) : w.type === 'no_maths_found' ? (
              <div className="font-semibold">{w.text || 'No maths problems found on this page.'}</div>
            ) : (
              <div>{w.text}{w.effect ? ` (${w.effect})` : ''}</div>
            )}
          </div>
        </div>
      ))}

      {p.status === 'error' && <ErrorNote error={`Grading failed: ${result.error ?? 'unknown error'}`} />}

      <div className="card overflow-hidden p-1.5">
        <div className="relative overflow-hidden rounded-xl bg-paper-2">
          {view === 'server' && p.overlay_url ? (
            <img src={p.overlay_url} alt="Server-rendered red-pen marks" className="block h-auto w-full" />
          ) : p.image_url ? (
            <>
              <img src={p.image_url} alt="Notebook page" className="block h-auto w-full" onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
              {size && problems.length > 0 && <MarksOverlay problems={problems} size={size} playKey={playKey} selected={selected} onSelect={setSelected} />}
              {pending && (
                <div className="absolute inset-0 flex items-center justify-center bg-paper/50">
                  <div className="shimmer absolute inset-0" />
                  <div className="relative flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow"><PenLine size={16} className="text-pen" /> Reading and checking every line…</div>
                </div>
              )}
            </>
          ) : (
            <div className="py-20 text-center text-sm text-ink-3">No image</div>
          )}
        </div>
        {p.status === 'done' && (
          <div className="no-print flex items-center justify-between gap-2 px-1.5 pb-1 pt-2">
            <div className="flex rounded-full border border-line bg-white p-0.5 text-xs font-semibold">
              <button onClick={() => setView('marks')} className={`rounded-full px-3 py-1.5 ${view === 'marks' ? 'bg-ink text-white' : 'text-ink-2'}`}><PenLine size={12} className="mr-1 inline -mt-0.5" />Live marks</button>
              <button onClick={() => setView('server')} disabled={!p.overlay_url} className={`rounded-full px-3 py-1.5 disabled:opacity-40 ${view === 'server' ? 'bg-ink text-white' : 'text-ink-2'}`}><ImageIcon size={12} className="mr-1 inline -mt-0.5" />Rendered PNG</button>
            </div>
            {view === 'marks' && (
              <button onClick={() => { setSelected(null); setPlayKey((k) => k + 1) }} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:bg-paper-2">
                <RotateCcw size={13} /> Replay
              </button>
            )}
          </div>
        )}
      </div>

      {p.status === 'done' && (
        <>
          <SectionTitle right={<span className="text-xs text-ink-3">tap to see why</span>}>Problems</SectionTitle>
          {problems.length === 0 ? (
            <Empty title="No problems found on this page">The page was read but no maths problems were detected.</Empty>
          ) : (
            <div className="card divide-y divide-line/70 overflow-hidden">
              {problems.map((pr, i) => (
                <button key={i} onClick={() => setSelected(i)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-paper-2/60 ${selected === i ? 'bg-pen-soft/40' : ''}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${pr.status === 'correct' ? 'bg-leaf-soft text-leaf' : pr.status === 'wrong' ? 'bg-pen-soft text-pen' : 'bg-amber-soft text-amber'}`}>
                    {pr.status === 'correct' ? <Check size={16} /> : pr.status === 'wrong' ? <X size={16} /> : <HelpCircle size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {pr.number && <span className="text-ink-3">{pr.number}. </span>}
                      {pr.problem_text}
                    </div>
                    <div className="truncate text-xs text-ink-2">
                      wrote <span className={`font-semibold ${pr.status === 'wrong' ? 'text-pen' : ''}`}>{pr.answer_text || '—'}</span>
                      {pr.status !== 'correct' && pr.expected && <> · expected <span className="font-semibold text-leaf">{pr.expected}</span></>}
                      {pr.diagnosis && <> · {pretty(pr.diagnosis.misconception_id)}</>}
                    </div>
                  </div>
                  {pr.teacher_override && <Badge tone="ink">override</Badge>}
                  {pr.explanation && <Badge tone="ink">explained</Badge>}
                  <ChevronRight size={16} className="shrink-0 text-ink-3" />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <BottomSheet
        open={selected !== null && !!problems[selected]}
        onClose={() => setSelected(null)}
        title={selected !== null && problems[selected] ? `Problem ${problems[selected].number || selected + 1}` : null}
      >
        {selected !== null && problems[selected] && <ProblemDetail pageId={p.id} index={selected} problem={problems[selected]} onUpdated={(pr) => updateProblem(selected, pr)} hintReview={(result.guardrails?.hint_review ?? []).filter((h) => h.problem === selected)} />}
      </BottomSheet>
    </div>
  )
}
