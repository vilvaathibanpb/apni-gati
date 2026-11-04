import { Link } from 'react-router-dom'
import { ChevronRight, MapPin, School, Users, BarChart3 } from 'lucide-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { Empty, ErrorNote, SimulatedBadge, Spinner } from '../ui'

export default function ClassList() {
  const { data, error, loading, reload } = useAsync(api.classes, [])
  const real = data?.filter((c) => !c.simulated) ?? []
  const sim = data?.filter((c) => c.simulated) ?? []

  return (
    <div>
      <div className="mb-5 mt-2">
        <div className="hand text-[2.6rem] font-bold leading-[0.95] text-ink">
          Forty children. <span className="text-pen">Forty different paces.</span>
        </div>
        <p className="mt-2 max-w-md text-sm text-ink-2">
          Every child in the class learns at a different pace. Give each one homework that fits, mark it in red pen, and watch each child’s progress.
        </p>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-ink-3">Your classes</h2>
        <Link to="/district" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink">
          <BarChart3 size={14} /> District view
        </Link>
      </div>

      {loading && <Spinner />}
      <ErrorNote error={error} onRetry={reload} />
      {data && data.length === 0 && (
        <Empty title="No classes yet" icon={<School size={30} />}>
          Seed a school and class on the server (backend seed script) and it will appear here.
        </Empty>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {[...real, ...sim].map((c) => (
          <Link key={c.id} to={`/class/${c.id}`} className="card group flex items-center gap-3 px-4 py-4 transition hover:-translate-y-0.5 hover:shadow-md">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${c.simulated ? 'bg-paper-2 text-ink-3' : 'bg-pen-soft text-pen'}`}>
              <School size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-semibold text-ink">{c.school_name}</span>
                {!!c.simulated && <SimulatedBadge />}
              </div>
              <div className="truncate text-sm text-ink-2">{c.name}{c.language ? ` · ${c.language}` : ''}</div>
              <div className="mt-1 flex items-center gap-3 text-xs text-ink-3">
                <span className="inline-flex items-center gap-1"><MapPin size={12} /> {c.district}</span>
                <span className="inline-flex items-center gap-1"><Users size={12} /> {c.n_students} children</span>
              </div>
            </div>
            <ChevronRight size={18} className="text-ink-3 transition group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}
