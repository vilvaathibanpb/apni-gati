import { useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { api, homeworkUrl, type ClassHomeworkRow } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { BackBar, Empty, ErrorNote, H1, Spinner } from '../ui'

/** One printable sheet per child: first name, date, numbered questions with writing space. No answers. */
export default function HomeworkPrint() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const only = params.get('student')
  const hw = useAsync(() => api.classHomework(id), [id])
  const printed = useRef(false)

  const rows = (hw.data ?? []).filter((r) => r.homework && (!only || r.student.id === only))

  useEffect(() => {
    if (!only || printed.current || !rows.length) return
    printed.current = true
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [only, rows.length])

  if (hw.loading) return <Spinner />
  if (hw.error) return <ErrorNote error={hw.error} onRetry={hw.reload} />

  return (
    <div>
      <BackBar to={`/class/${id}/homework`} label="Tonight’s homework" right={rows.length > 0 ? <button onClick={() => window.print()} className="btn btn-primary px-3 py-1.5 text-sm"><Printer size={15} /> Print {rows.length > 1 ? `${rows.length} sheets` : ''}</button> : undefined} />
      <div className="no-print">
        <H1 sub="One sheet per child, no answers. Each page ends with the child’s link so the family can send a photo.">{only ? 'Print sheet' : 'Print all sheets'}</H1>
      </div>
      {rows.length === 0 ? (
        <Empty title="Nothing to print">Make tonight’s homework first.</Empty>
      ) : (
        <div className="space-y-4 print:space-y-0">
          {rows.map((r) => <Sheet key={r.student.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

function Sheet({ r }: { r: ClassHomeworkRow }) {
  const h = r.homework!
  const first = r.student.name.split(' ')[0]
  const date = new Date(h.created * 1000).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const space = h.items.length > 8 ? 'h-14' : 'h-20'
  return (
    <section className="print-sheet card px-6 py-5 print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none">
      <header className="flex items-end justify-between gap-3 border-b-2 border-ink pb-2">
        <div>
          <div className="hand text-4xl font-bold leading-none text-ink">{first}</div>
          <div className="mt-1 text-xs text-ink-2">Homework · {date}</div>
        </div>
        <div className="text-right">
          <div className="leading-none"><span className="hand text-xl font-bold text-pen">Red</span><span className="hand text-xl font-bold text-ink"> Pen</span></div>
          <div className="mt-1 text-[10px] text-ink-3">Class {r.student.grade}</div>
        </div>
      </header>
      <ol className="mt-3">
        {h.items.map((it) => (
          <li key={it.n} className="break-inside-avoid py-2">
            <div className="flex gap-3">
              <span className="hand w-6 shrink-0 text-2xl font-bold leading-7 text-pen">{it.n}.</span>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] leading-snug text-ink">{it.question}</div>
                {it.question_en !== it.question && <div className="mt-0.5 text-[11px] text-ink-3">{it.question_en}</div>}
              </div>
            </div>
            <div className={`write-lines ml-9 mt-1.5 ${space}`} />
          </li>
        ))}
      </ol>
      <footer className="mt-3 border-t border-line pt-2 text-[10px] text-ink-3">
        Do it in your notebook: write the question number, show your working, then the answer. Send a photo of the page here: <span className="font-mono text-ink-2">{homeworkUrl(h.token)}</span>
      </footer>
    </section>
  )
}
