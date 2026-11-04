import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, Check, ImagePlus, Loader2, Minus, Send, X } from 'lucide-react'
import { api, type ChildHomework, type ChildItemStatus } from '../lib/api'
import { useAsync, useInterval } from '../lib/hooks'
import { MarksOverlay } from '../components/Marks'
import { ErrorNote, Logo } from '../ui'

/** The child's own page, opened from a link on the family phone. No teacher chrome. */
export default function ChildHomeworkPage() {
  const { token = '' } = useParams()
  const hw = useAsync(() => api.childHomework(token), [token])
  const [checkingSince, setCheckingSince] = useState<number | null>(null)
  const d = hw.data
  const checking = d?.status === 'submitted' || d?.status === 'grading'
  useInterval(() => void hw.reload(), 4000, checking)

  useEffect(() => {
    if (checking && checkingSince === null) setCheckingSince(Date.now())
    if (!checking) setCheckingSince(null)
  }, [checking, checkingSince])

  useEffect(() => {
    if (d?.first_name) document.title = `${d.first_name}’s homework · Apni Gati`
    return () => { document.title = 'Apni Gati' }
  }, [d?.first_name])

  return (
    <div className="min-h-screen bg-paper">
      <header className="flex justify-center pb-1 pt-4"><Logo size={22} link={false} /></header>
      <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-2">
        {hw.loading ? (
          <div className="flex justify-center py-24 text-ink-3"><Loader2 size={28} className="animate-spin" /></div>
        ) : hw.error || !d ? (
          <div className="card ruled mt-6 px-6 py-10 text-center">
            <div className="hand text-3xl font-bold">We couldn’t find this homework</div>
            <p className="mt-2 text-ink-2">Please check the link with your teacher.</p>
            {hw.error && !/not found/i.test(hw.error.message) && <button onClick={hw.reload} className="btn btn-ghost mt-4">Try again</button>}
          </div>
        ) : d.status === 'graded' ? (
          <Marked d={d} />
        ) : d.status === 'error' ? (
          <div className="card ruled mt-6 px-6 py-10 text-center">
            <div className="hand text-3xl font-bold">We couldn’t read your photo</div>
            <p className="mt-2 text-ink-2">Your teacher will look at it. You can also send a clearer photo.</p>
            <div className="mt-4"><Todo d={d} onSent={() => void hw.reload()} /></div>
          </div>
        ) : checking ? (
          <Checking d={d} slow={checkingSince !== null && Date.now() - checkingSince > 240_000} />
        ) : (
          <Todo d={d} onSent={() => void hw.reload()} />
        )}
      </main>
    </div>
  )
}

function Questions({ d, small }: { d: ChildHomework; small?: boolean }) {
  return (
    <ol className="space-y-2.5">
      {d.items.map((it) => (
        <li key={it.n} className="card flex gap-3 px-4 py-3.5">
          <span className={`hand shrink-0 font-bold leading-none text-pen ${small ? 'w-6 text-2xl' : 'w-8 text-[2.1rem]'}`}>{it.n}</span>
          <div className="min-w-0 flex-1">
            <div className={`leading-snug text-ink ${small ? 'text-base' : 'text-[1.3rem]'}`}>{it.question}</div>
            {it.question_en !== it.question && <div className={`mt-1 text-ink-3 ${small ? 'text-xs' : 'text-sm'}`}>{it.question_en}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function Todo({ d, onSent }: { d: ChildHomework; onSent: () => void }) {
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string>()
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  const add = (list: FileList | null) => {
    if (!list) return
    setErr(undefined)
    // Copy now: the input is reset right after this call, which empties the live FileList.
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name))
    setFiles((prev) => [...prev, ...picked].slice(0, 4))
  }
  const send = async () => {
    if (!files.length) return
    setSending(true)
    setErr(undefined)
    try {
      const form = new FormData()
      files.forEach((f) => form.append('files', f, f.name))
      await api.submitHomework(d.token, form)
      onSent()
    } catch (e) {
      setErr((e as Error).message)
      setSending(false)
    }
  }

  return (
    <>
      <h1 className="hand mt-2 text-center text-[2.6rem] font-bold leading-[1.05] text-ink">
        {d.first_name}, here is your homework
      </h1>
      <p className="mb-5 mt-2 text-center text-base text-ink-2">{d.items.length} questions, just for you</p>

      <Questions d={d} />

      <div className="card ruled mt-6 px-5 py-6 text-center">
        <div className="text-lg font-semibold leading-snug">Do it in your notebook, then take a photo</div>
        <p className="mt-1 text-sm text-ink-2">Write the question number next to each answer.</p>

        <input ref={camRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = '' }} />

        {files.length === 0 ? (
          <>
            <button onClick={() => camRef.current?.click()} className="mx-auto mt-5 flex h-28 w-28 items-center justify-center rounded-full bg-pen text-white shadow-[0_10px_24px_-10px_rgba(210,22,31,.8)] transition active:scale-95" aria-label="Take a photo of your notebook">
              <Camera size={48} />
            </button>
            <div className="mt-3 text-base font-semibold text-pen">Take a photo</div>
            <button onClick={() => galRef.current?.click()} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 underline decoration-line underline-offset-4">
              <ImagePlus size={15} /> or choose from the gallery
            </button>
          </>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {previews.map((u, i) => (
                <div key={u} className="relative h-36 w-28 overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
                  <img src={u} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
                  {!sending && (
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-ink/70 p-1 text-white" aria-label="Remove photo">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {files.length < 4 && !sending && (
                <button onClick={() => camRef.current?.click()} className="flex h-36 w-28 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-pen/40 text-pen">
                  <Camera size={26} /><span className="text-xs font-semibold">Another page</span>
                </button>
              )}
            </div>
            <ErrorNote error={err} />
            <button onClick={send} disabled={sending} className="btn btn-primary mt-5 w-full py-4 text-lg">
              {sending ? <Loader2 size={22} className="animate-spin" /> : <Send size={22} />} {sending ? 'Sending…' : 'Send to my teacher'}
            </button>
          </>
        )}
      </div>
    </>
  )
}

function Checking({ d, slow }: { d: ChildHomework; slow: boolean }) {
  return (
    <>
      <div className="card ruled mt-4 flex flex-col items-center px-6 py-10 text-center">
        <svg width="96" height="96" viewBox="0 0 54 54" aria-hidden>
          <circle cx="27" cy="27" r="25" fill="#fbe6e5" />
          <path d="M12 30 C 18 18, 24 40, 30 26 S 40 20, 43 28" fill="none" stroke="#d2161f" strokeWidth="3" strokeLinecap="round" className="scribble" />
        </svg>
        <div className="hand mt-3 text-[2.2rem] font-bold leading-tight">Your teacher’s red pen is checking…</div>
        <p className="mt-2 text-ink-2">
          {slow ? 'This is taking longer than usual. You can close this page — your teacher will still see it.' : `Well done for finishing, ${d.first_name}! This takes about a minute.`}
        </p>
      </div>
      <div className="mb-2 mt-6 text-center text-xs font-bold uppercase tracking-[0.12em] text-ink-3">Your questions</div>
      <Questions d={d} small />
    </>
  )
}

function cheer(correct: number, total: number, name: string) {
  if (total && correct === total) return { big: `Wonderful, ${name}!`, small: 'Every answer is correct.' }
  if (correct / (total || 1) >= 0.6) return { big: `Great work, ${name}!`, small: 'Look at the red circles — you are nearly there.' }
  if (correct > 0) return { big: `Good effort, ${name}!`, small: 'Each mistake shows what to practise next. Tomorrow’s homework will help.' }
  return { big: `Thank you, ${name}!`, small: 'Your teacher will help you with these. Tomorrow’s homework starts with easier steps.' }
}

function Marked({ d }: { d: ChildHomework }) {
  const [natural, setNatural] = useState<[number, number] | null>(null)
  const page = d.page
  const res = page?.result
  const problems = res?.problems ?? []
  const size = (res?.size as [number, number] | undefined) ?? natural
  const keyed = new Map((res?.homework?.items ?? []).map((i) => [i.n, i.status] as const))
  const correct = d.result?.correct ?? 0
  const total = d.result?.total ?? d.items.length
  const c = cheer(correct, total, d.first_name)

  return (
    <>
      <div className="mt-2 text-center">
        <div className="relative mx-auto inline-block">
          <svg width="176" height="116" viewBox="0 0 78 62" preserveAspectRatio="none" className="absolute -left-6 -top-4" aria-hidden>
            <path d="M8 34 C 6 12, 64 4, 71 26 C 77 46, 34 60, 14 50 C 4 44, 6 30, 18 22" fill="none" stroke="#d2161f" strokeWidth="2.2" strokeLinecap="round" pathLength={1} className="mark-path" style={{ ['--len' as string]: 1, ['--delay' as string]: '0.3s', ['--dur' as string]: '0.7s' }} />
          </svg>
          <div className="hand relative px-6 pt-4 text-[3.6rem] font-bold leading-none text-pen">{correct}/{total}</div>
        </div>
        <h1 className="hand mt-4 text-[2.3rem] font-bold leading-tight">{c.big}</h1>
        <p className="mt-1 text-base text-ink-2">{c.small}</p>
      </div>

      {page?.image_url && (
        <div className="card mt-5 overflow-hidden p-1.5">
          <div className="relative overflow-hidden rounded-xl bg-paper-2">
            {problems.length > 0 || !page.overlay_url ? (
              <>
                <img src={page.image_url} alt="Your notebook page, marked" className="block h-auto w-full" onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
                {size && problems.length > 0 && <MarksOverlay problems={problems} size={size} playKey={0} selected={null} onSelect={() => {}} />}
              </>
            ) : (
              <img src={page.overlay_url} alt="Your notebook page, marked" className="block h-auto w-full" />
            )}
          </div>
        </div>
      )}

      <div className="mb-2 mt-6 text-center text-xs font-bold uppercase tracking-[0.12em] text-ink-3">Question by question</div>
      <ol className="card divide-y divide-line/70 overflow-hidden">
        {d.items.map((it) => {
          const st = keyed.get(it.n) ?? 'not_attempted'
          return (
            <li key={it.n} className="flex items-center gap-3 px-4 py-3">
              <span className="hand w-6 shrink-0 text-2xl font-bold leading-none text-ink-3">{it.n}</span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] leading-snug">{it.question}</div>
                {it.question_en !== it.question && <div className="truncate text-xs text-ink-3">{it.question_en}</div>}
              </div>
              <ResultMark st={st} />
            </li>
          )
        })}
      </ol>
      <p className="mt-6 text-center text-sm text-ink-3">See you tomorrow for your next homework!</p>
    </>
  )
}

function ResultMark({ st }: { st: ChildItemStatus }) {
  if (st === 'correct') return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-leaf" aria-label="correct"><Check size={22} strokeWidth={3} /></span>
  if (st === 'wrong') return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pen-soft text-pen" aria-label="not yet right"><X size={22} strokeWidth={3} /></span>
  if (st === 'needs_review') return <span className="shrink-0 rounded-full bg-amber-soft px-2.5 py-1 text-xs font-semibold text-amber">teacher will check</span>
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper-2 px-2.5 py-1 text-xs font-semibold text-ink-3"><Minus size={13} /> not done</span>
}
