import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronDown, Copy, ExternalLink, ListChecks, MessageCircle, NotebookPen, Printer, RefreshCw, Settings2 } from 'lucide-react'
import { api, homeworkUrl, type ClassHomeworkRow, type MadeHomework, type Track } from '../lib/api'
import { useAction, useAsync, useInterval } from '../lib/hooks'
import { SyllabusBar, TRACK_DOT, TRACK_LABEL, TRACK_ORDER, TrackBadge, fmtDate, initials } from '../components/Homework'
import { AgentProgress, BackBar, Badge, ConfirmDialog, Empty, ErrorNote, H1, SectionTitle, Spinner, timeAgo } from '../ui'

const isToday = (ts: number) => new Date(ts * 1000).toDateString() === new Date().toDateString()

function whatsappText(firstName: string, token: string) {
  return `${firstName}’s homework for tonight: ${homeworkUrl(token)}\nDo it in the notebook, then open the link and take a photo of the page. The teacher’s red pen will check it.`
}

export default function HomeworkPage() {
  const { id = '' } = useParams()
  const klass = useAsync(() => api.klass(id), [id])
  const syllabus = useAsync(() => api.syllabus(id), [id])
  const hw = useAsync(() => api.classHomework(id), [id])
  const make = useAction(api.makeHomework)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState(false)

  const rows = hw.data ?? []
  const withHw = rows.filter((r) => r.homework)
  const waiting = withHw.some((r) => r.homework!.status === 'submitted')
  useInterval(() => void hw.reload(), 8000, waiting && !make.running)

  const generate = async () => {
    setConfirm(false)
    const out = await make.run(id)
    if (out) {
      setErrors(Object.fromEntries(out.filter((o): o is Extract<MadeHomework, { error: string }> => !!o.error).map((o) => [o.student.id, o.error])))
      await Promise.all([hw.reload(), klass.reload()])
    }
  }

  const noSyllabus = syllabus.data && syllabus.data.concept_ids.length === 0
  const noChildren = klass.data && klass.data.students.length === 0
  const allToday = withHw.length > 0 && withHw.length === rows.length && withHw.every((r) => isToday(r.homework!.created))
  const latest = withHw.reduce((m, r) => Math.max(m, r.homework!.created), 0)
  const counts = TRACK_ORDER.map((t) => [t, withHw.filter((r) => r.homework!.track === t).length] as const).filter(([, n]) => n > 0)
  const graded = withHw.filter((r) => r.homework!.status === 'graded').length
  const submitted = withHw.filter((r) => r.homework!.status === 'submitted').length

  return (
    <div>
      <BackBar to={`/class/${id}`} label={klass.data?.name ?? 'Class'} right={withHw.length > 0 ? <Link to={`/class/${id}/homework/print`} className="btn btn-ghost px-3 py-1.5 text-sm"><Printer size={15} /> Print all</Link> : undefined} />
      <H1 sub="Every child gets a different sheet, built from their own knowledge graph. Families photograph the notebook page; it’s marked in red pen against the answer key.">Tonight’s homework</H1>

      {(noSyllabus || noChildren) && (
        <Link to={`/class/${id}/setup`} className="card mb-3 flex items-center gap-3 border-amber/40 bg-amber-soft/50 px-4 py-3 text-sm">
          <Settings2 size={18} className="shrink-0 text-amber" />
          <span className="flex-1"><b>{noChildren ? 'Add the children' : 'Set the syllabus'}</b> first, so each homework can follow it.</span>
          <span className="font-semibold text-amber">Set up</span>
        </Link>
      )}

      {make.running ? (
        <AgentProgress
          title="Muse Spark is writing a different homework for each child… every answer checked by sympy"
          elapsed={make.elapsed}
          expected={`1–2 min for ${rows.length || klass.data?.students.length || ''} children`}
          steps={['Reading each child’s knowledge graph', 'Choosing a track: challenge, on track, practice or placement', 'Picking topics from the syllabus, and the gap underneath', 'Writing questions in each child’s language', 'Checking every answer with sympy', 'Replacing any question that failed the check', 'Making a personal link for each family']}
        />
      ) : (
        <>
          <ErrorNote error={make.error} />
          <button onClick={() => (allToday ? setConfirm(true) : generate())} disabled={!!noSyllabus || !!noChildren} className={`btn w-full ${allToday ? 'btn-ghost' : 'btn-primary py-4 text-lg'}`}>
            {allToday ? <RefreshCw size={17} /> : <NotebookPen size={22} />} {allToday ? 'Make new sheets for tonight' : 'Make tonight’s homework'}
          </button>
          {latest > 0 && <div className="mt-1.5 text-right text-xs text-ink-3">Last made {timeAgo(latest)}</div>}
        </>
      )}

      <ConfirmDialog open={confirm} title="Make new sheets?" confirmLabel="Make new sheets" onCancel={() => setConfirm(false)} onConfirm={generate}>
        Every child already has homework from today. New sheets replace the links you shared — families with the old link will still see the old sheet.
      </ConfirmDialog>

      {counts.length > 0 && !make.running && (
        <div className="card mt-4 px-4 py-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {counts.map(([t, n]) => (
              <span key={t} className="inline-flex items-center gap-1.5 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${TRACK_DOT[t as Track]}`} />
                <b className="tabular-nums">{n}</b> <span className="text-ink-2">{TRACK_LABEL[t as Track]}</span>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-4 border-t border-line/70 pt-2 text-xs text-ink-3">
            <span><b className="text-ink">{withHw.length - submitted - graded}</b> waiting</span>
            <span><b className="text-ink">{submitted}</b> being marked</span>
            <span><b className="text-ink">{graded}</b> marked</span>
          </div>
        </div>
      )}

      <SectionTitle>{rows.length} children</SectionTitle>
      {hw.loading ? (
        <Spinner />
      ) : hw.error ? (
        <ErrorNote error={hw.error} onRetry={hw.reload} />
      ) : rows.length === 0 ? (
        <Empty title="No children yet" icon={<ListChecks size={28} />}><Link to={`/class/${id}/setup`} className="font-semibold text-pen underline">Add the class roster</Link> to start.</Empty>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => <ChildCard key={r.student.id} r={r} classId={id} error={errors[r.student.id]} />)}
        </div>
      )}
    </div>
  )
}

function ChildCard({ r, classId, error }: { r: ClassHomeworkRow; classId: string; error?: string }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const h = r.homework
  const first = r.student.name.split(' ')[0]

  const copy = async () => {
    if (!h) return
    try {
      await navigator.clipboard.writeText(homeworkUrl(h.token))
    } catch {
      window.prompt('Copy this link', homeworkUrl(h.token))
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-start gap-3">
          <Link to={`/student/${r.student.id}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-sm font-bold">{initials(r.student.name)}</Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link to={`/student/${r.student.id}`} className="font-semibold">{r.student.name}</Link>
              <span className="text-xs text-ink-3">Class {r.student.grade} · {r.student.language}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {h ? <TrackBadge track={h.track} label={h.track_label} /> : <Badge tone="grey">No homework yet</Badge>}
              {h && <span className="text-xs text-ink-3">{h.items.length} question{h.items.length === 1 ? '' : 's'} · {fmtDate(h.created)}</span>}
            </div>
          </div>
          {h && <HwStatus h={h} />}
        </div>
        {error && <ErrorNote error={`Couldn’t make ${first}’s sheet: ${error}`} />}
        {h?.plan?.why && <p className="mt-2 text-sm leading-snug text-ink-2">{h.plan.why}</p>}
        <div className="mt-2.5"><SyllabusBar p={r.progress} /></div>
      </div>

      {h && (
        <>
          <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between border-t border-line/70 px-4 py-2.5 text-sm font-semibold">
            <span>Questions <span className="font-normal text-ink-3">· with answers, for you</span></span>
            <ChevronDown size={16} className={`text-ink-3 transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <ol className="divide-y divide-line/60 border-t border-line/70 bg-paper/50">
              {h.items.map((it) => (
                <li key={it.n} className="flex gap-3 px-4 py-2.5">
                  <span className="hand w-5 shrink-0 text-xl font-bold leading-6 text-pen">{it.n}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] leading-snug">{it.question}</div>
                    {it.question_en !== it.question && <div className="mt-0.5 text-xs text-ink-3">{it.question_en}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-mono text-ink-2">{it.expr}</span>
                      <span className="text-ink-3">=</span>
                      <span className="rounded bg-leaf-soft px-1.5 py-0.5 font-semibold text-leaf">{it.answer}</span>
                      <span className="text-ink-3">· level {it.level}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="grid grid-cols-3 gap-1.5 border-t border-line/70 px-2 py-2">
            <button onClick={copy} className="btn btn-ghost flex-col gap-1 whitespace-nowrap px-1 py-2 text-xs">{copied ? <Check size={15} className="text-leaf" /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy link'}</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(whatsappText(first, h.token))}`} target="_blank" rel="noreferrer" className="btn btn-ghost flex-col gap-1 whitespace-nowrap px-1 py-2 text-xs"><MessageCircle size={15} className="text-leaf" /> WhatsApp</a>
            <button onClick={() => nav(`/class/${classId}/homework/print?student=${r.student.id}`)} className="btn btn-ghost flex-col gap-1 whitespace-nowrap px-1 py-2 text-xs"><Printer size={15} /> Print</button>
          </div>
          {h.page_id && (
            <Link to={`/page/${h.page_id}`} className="flex items-center justify-center gap-1.5 border-t border-line/70 px-4 py-2 text-xs font-semibold text-ink-2 hover:bg-paper-2/60">
              <ExternalLink size={13} /> See the marked page
            </Link>
          )}
        </>
      )}
    </div>
  )
}

function HwStatus({ h }: { h: NonNullable<ClassHomeworkRow['homework']> }) {
  if (h.status === 'graded' && h.result)
    return (
      <div className="shrink-0 text-right">
        <div className={`hand text-2xl font-bold leading-none ${h.result.correct === h.result.total ? 'text-leaf' : 'text-pen'}`}>{h.result.correct}/{h.result.total}</div>
        <div className="text-[10px] uppercase tracking-wide text-ink-3">marked</div>
      </div>
    )
  if (h.status === 'submitted') return <Badge tone="ink" className="bg-ink text-white"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-white" /> marking</Badge>
  return <Badge tone="grey">assigned</Badge>
}
