import { Link, useParams } from 'react-router-dom'
import { BookOpenText, Camera, CalendarDays, Check, ChevronRight, ListChecks, NotebookPen, Settings2, Users } from 'lucide-react'
import { api, type StudentSummary } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { SyllabusBar, TrackBadge, initials } from '../components/Homework'
import { BackBar, Badge, Empty, ErrorNote, H1, SectionTitle, SimulatedBadge, Spinner } from '../ui'

export function gradesLabel(g: unknown): string {
  if (Array.isArray(g) && g.length) {
    const nums = g.map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
    if (nums.length > 1) return `Classes ${nums[0]}–${nums[nums.length - 1]}`
    if (nums.length === 1) return `Class ${nums[0]}`
  }
  if (typeof g === 'string' && g) return g
  return ''
}

export function isBehind(s: { grade: number; frontier_grade: number | null }) {
  return s.frontier_grade !== null && s.frontier_grade <= s.grade - 2
}

export default function ClassHome() {
  const { id = '' } = useParams()
  const { data, error, loading, reload } = useAsync(() => api.klass(id), [id])
  const syllabus = useAsync(() => api.syllabus(id), [id])

  if (loading) return <Spinner />
  if (error || !data) return <ErrorNote error={error ?? 'Class not found'} onRetry={reload} />

  const behind = data.students.filter(isBehind).length
  const students = [...data.students].sort((a, b) => Number(isBehind(b)) - Number(isBehind(a)) || a.grade - b.grade || a.name.localeCompare(b.name))

  return (
    <div>
      <BackBar to="/" label="Classes" />
      <H1
        sub={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{data.school?.name}</span>
            {data.school?.district && <span className="text-ink-3">· {data.school.district}</span>}
            {!!data.school?.simulated && <SimulatedBadge />}
          </span>
        }
      >
        {data.name}{!/\d/.test(data.name) && <span className="font-normal text-ink-3"> {gradesLabel(data.grades)}</span>}
      </H1>

      {syllabus.data && (syllabus.data.concept_ids.length === 0 || data.students.length === 0) && (
        <SetupChecklist id={id} hasChildren={data.students.length > 0} hasSyllabus={syllabus.data.concept_ids.length > 0} />
      )}

      <Link to={`/class/${id}/homework`} className="btn btn-primary w-full flex-col gap-0 py-3.5">
        <span className="flex items-center gap-2 text-lg"><NotebookPen size={22} /> Give homework</span>
        <span className="text-xs font-medium text-white/80">a different sheet for every child, tonight</span>
      </Link>
      <Link to={`/class/${id}/capture`} className="btn btn-ink mt-2 w-full py-3">
        <Camera size={20} /> Mark notebooks
      </Link>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Link to={`/class/${id}/setup`} className="btn btn-ghost flex-col gap-1 whitespace-nowrap px-1 py-2.5 text-xs">
          <Settings2 size={17} /> Class setup
        </Link>
        <Link to={`/class/${id}/plan`} className="btn btn-ghost flex-col gap-1 whitespace-nowrap px-1 py-2.5 text-xs">
          <CalendarDays size={17} /> Plan lesson
        </Link>
        <Link to={`/class/${id}/reading`} className="btn btn-ghost flex-col gap-1 whitespace-nowrap px-1 py-2.5 text-xs">
          <BookOpenText size={17} /> Reading
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="card px-3 py-2.5">
          <div className="text-xl font-bold">{data.students.length}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">children</div>
        </div>
        <div className="card px-3 py-2.5">
          <div className={`text-xl font-bold ${behind ? 'text-pen' : ''}`}>{behind}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">2+ yrs behind</div>
        </div>
        <div className="card px-3 py-2.5">
          <div className="text-xl font-bold">{data.students.reduce((n, s) => n + (s.attempts || 0), 0)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">problems marked</div>
        </div>
      </div>

      <SectionTitle right={<Link to={`/class/${id}/setup`} className="text-xs font-semibold text-ink-2 underline decoration-pen/40 underline-offset-2">Edit roster</Link>}>Roster · syllabus progress</SectionTitle>
      {students.length === 0 ? (
        <Empty title="No children on the roster" icon={<Users size={28} />}>
          <Link to={`/class/${id}/setup`} className="font-semibold text-pen underline">Add the children</Link> to start giving each one their own homework.
        </Empty>
      ) : (
        <div className="card divide-y divide-line/70 overflow-hidden">
          {students.map((s) => (
            <StudentRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function StudentRow({ s }: { s: StudentSummary }) {
  const behind = isBehind(s)
  return (
    <Link to={`/student/${s.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-paper-2/60">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${behind ? 'bg-pen text-white' : 'bg-paper-2 text-ink'}`}>
        {initials(s.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{s.name}</span>
          <span className="shrink-0 text-xs text-ink-3">Class {s.grade}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
          {s.frontier ? (
            <span className={behind ? 'font-medium text-pen' : 'text-ink-2'}>
              Ready for: {s.frontier}
              <span className="text-ink-3"> (Class {s.frontier_grade})</span>
            </span>
          ) : (
            <span className="text-ink-3">{s.attempts ? 'On track — no gaps found' : 'No evidence yet'}</span>
          )}
          {behind && <Badge tone="pen">2+ years behind</Badge>}
        </div>
        {s.root_cause && <div className="mt-0.5 truncate text-xs text-ink-3">Root cause: <span className="hand text-sm text-pen">{s.root_cause}</span></div>}
        {s.progress && s.progress.total > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="w-20 shrink-0"><SyllabusBar p={s.progress} compact /></div>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{s.progress.mastered}/{s.progress.total} · {s.progress.percent}%</span>
            {s.homework && <TrackBadge track={s.homework.track} label={s.homework.track_label} />}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums">
          {s.correct}/{s.attempts}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-ink-3">correct</div>
      </div>
      <ChevronRight size={16} className="shrink-0 text-ink-3" />
    </Link>
  )
}

function SetupChecklist({ id, hasChildren, hasSyllabus }: { id: string; hasChildren: boolean; hasSyllabus: boolean }) {
  const steps = [
    { done: hasChildren, label: 'Add the children', sub: 'name, class and home language' },
    { done: hasSyllabus, label: 'Set the syllabus', sub: 'paste the chapter list, or pick topics' },
    { done: false, label: 'Give tonight’s homework', sub: 'one tap, a different sheet for every child' },
  ]
  return (
    <Link to={`/class/${id}/setup`} className="card ruled mb-3 block px-5 py-4 pl-10 transition hover:bg-paper-2/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold"><ListChecks size={18} className="text-pen" /> Set up this class once</div>
        <ChevronRight size={16} className="text-ink-3" />
      </div>
      <ol className="mt-2 space-y-1.5">
        {steps.map((st, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${st.done ? 'bg-leaf text-white' : 'border border-line bg-white text-ink-3'}`}>{st.done ? <Check size={12} /> : i + 1}</span>
            <span className={st.done ? 'text-ink-3 line-through' : ''}>
              <span className="font-medium">{st.label}</span> <span className="text-xs text-ink-3">· {st.sub}</span>
            </span>
          </li>
        ))}
      </ol>
    </Link>
  )
}
