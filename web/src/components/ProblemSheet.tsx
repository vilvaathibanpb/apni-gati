import { useState, type ReactNode } from 'react'
import { ArrowRight, Calculator, Check, ChevronDown, Flag, Gavel, HelpCircle, ListChecks, Loader2, Mic, ScanSearch, Send, ShieldCheck, UserCheck, Users, X } from 'lucide-react'
import { api, pretty, type HintReview, type Problem } from '../lib/api'
import { extFor, useRecorder } from '../lib/hooks'
import { Badge, ErrorNote, RecordButton } from '../ui'

const HINT_LANGS = [
  { key: 'child_hint_en', label: 'English' },
  { key: 'child_hint_hi', label: 'हिन्दी' },
  { key: 'child_hint_ta', label: 'தமிழ்' },
] as const

export function statusBadge(status: Problem['status']) {
  if (status === 'correct') return <Badge tone="leaf"><Check size={11} /> correct</Badge>
  if (status === 'wrong') return <Badge tone="pen"><X size={11} /> wrong</Badge>
  return <Badge tone="amber"><HelpCircle size={11} /> needs review</Badge>
}

function traceIcon(line: string): { icon: ReactNode; tag: string } {
  const l = line.toLowerCase()
  if (l.startsWith('sympy')) return { icon: <Calculator size={13} />, tag: 'sympy' }
  if (l.startsWith('final answer')) return { icon: <Check size={13} />, tag: 'verify' }
  if (l.startsWith('zoomed')) return { icon: <ScanSearch size={13} />, tag: 'Spark re-read' }
  if (l.startsWith('steps verified')) return { icon: <ListChecks size={13} />, tag: 'sympy' }
  if (l.startsWith('diagnosis')) return { icon: <Users size={13} />, tag: 'two-pass' }
  if (l.startsWith('adjudication')) return { icon: <Gavel size={13} />, tag: 'Wonder' }
  if (l.startsWith('low confidence')) return { icon: <Flag size={13} />, tag: 'teacher' }
  if (l.startsWith('child explained')) return { icon: <Mic size={13} />, tag: 'Voice' }
  if (l.startsWith('teacher override')) return { icon: <UserCheck size={13} />, tag: 'teacher' }
  return { icon: <ArrowRight size={13} />, tag: 'step' }
}

export function VerificationLog({ lines }: { lines: string[] }) {
  return (
    <ol className="relative ml-1 space-y-2.5 border-l border-dashed border-ink-3/40 pl-4">
      {lines.map((line, i) => {
        const bad = /: false|wrong|disagree|flagged|not legible/i.test(line)
        const { icon: baseIcon, tag } = traceIcon(line)
        const icon = tag === 'verify' && bad ? <X size={13} /> : baseIcon
        const good = /: true|agree on|confirms/i.test(line) && !bad
        return (
          <li key={i} className="relative">
            <span className={`absolute -left-[25px] top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-white ${bad ? 'border-pen/40 text-pen' : good ? 'border-leaf/40 text-leaf' : 'border-line text-ink-2'}`}>{icon}</span>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{tag}</div>
            <div className="break-words font-mono text-[12.5px] leading-snug text-ink">{line}</div>
          </li>
        )
      })}
    </ol>
  )
}

function Confidence({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-paper-2">
        <div className={`h-full rounded-full ${v >= 0.7 ? 'bg-leaf' : v >= 0.45 ? 'bg-amber' : 'bg-pen'}`} style={{ width: `${v * 100}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums">{Math.round(v * 100)}%</span>
    </div>
  )
}

interface Props {
  pageId: string
  index: number
  problem: Problem
  onUpdated: (p: Problem) => void
  hintReview?: HintReview[]
}

const LANG_NAME: Record<string, string> = { en: 'English', hi: 'Hindi', ta: 'Tamil' }

export function ProblemDetail({ pageId, index, problem: p, onUpdated, hintReview = [] }: Props) {
  const [hintLang, setHintLang] = useState<(typeof HINT_LANGS)[number]['key']>('child_hint_en')
  const [showTrace, setShowTrace] = useState(false)
  const d = p.diagnosis

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge(p.status)}
          {p.teacher_override && <Badge tone="ink"><UserCheck size={11} /> Teacher override</Badge>}
          {d?.needs_teacher && !p.teacher_override && <Badge tone="amber"><Flag size={11} /> check this one</Badge>}
        </div>
        <div className="mt-2 text-lg font-semibold leading-snug">{p.problem_text}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className={`rounded-xl border px-3 py-2 ${p.status === 'wrong' ? 'border-pen/30 bg-pen-soft/50' : 'border-line bg-white'}`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Child wrote</div>
            <div className={`hand text-3xl font-bold leading-tight ${p.status === 'wrong' ? 'text-pen line-through decoration-2' : 'text-ink'}`}>{p.answer_text || '—'}</div>
          </div>
          <div className="rounded-xl border border-line bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Expected (sympy)</div>
            <div className="hand text-3xl font-bold leading-tight text-leaf">{p.expected ?? '—'}</div>
          </div>
        </div>
      </div>

      {d && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Diagnosis</div>
              <div className="mt-0.5 font-semibold text-pen">{pretty(d.misconception_id)}</div>
            </div>
            {d.pen_note && <div className="hand shrink-0 -rotate-3 text-2xl font-bold text-pen">{d.pen_note}</div>}
          </div>
          {p.explanation?.before && p.explanation.before !== d.misconception_id && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded bg-paper-2 px-1.5 py-0.5 text-ink-3 line-through">{pretty(p.explanation.before)}</span>
              <ArrowRight size={12} className="text-ink-3" />
              <span className="rounded bg-pen-soft px-1.5 py-0.5 font-semibold text-pen">{pretty(d.misconception_id)}</span>
              <span className="text-ink-3">after hearing the child</span>
            </div>
          )}
          <p className="mt-2 text-sm leading-relaxed text-ink">{d.teacher_note}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-2">
            <div className="flex items-center gap-2"><span className="text-ink-3">Confidence</span><Confidence value={d.confidence} /></div>
            {d.agreement && (
              <div className="flex items-center gap-1.5"><span className="text-ink-3">Agreement</span>
                <Badge tone={d.agreement === '2/2' || d.agreement === 'child-explanation' ? 'leaf' : d.agreement === '2/3' ? 'amber' : 'pen'}>{d.agreement === 'child-explanation' ? 'child’s explanation' : d.agreement}</Badge>
              </div>
            )}
          </div>
        </section>
      )}

      {d && (d.child_hint_en || d.child_hint_hi || d.child_hint_ta) && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Hint for the child</div>
            <div className="flex rounded-full border border-line bg-white p-0.5">
              {HINT_LANGS.map((l) => (
                <button key={l.key} onClick={() => setHintLang(l.key)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hintLang === l.key ? 'bg-ink text-white' : 'text-ink-2'}`}>{l.label}</button>
              ))}
            </div>
          </div>
          <div className="ruled rounded-2xl border border-line bg-card px-4 py-3 pl-10 text-[17px] leading-8 text-ink">{d[hintLang] || <span className="text-ink-3">—</span>}</div>
          {hintReview.length > 0 ? (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-ink-2" title={hintReview.map((h) => `${LANG_NAME[h.lang] ?? h.lang}: ${h.issues.join('; ')}`).join('\n')}>
              <ShieldCheck size={13} className="mt-px shrink-0 text-leaf" />
              <span>
                Hint {hintReview.some((h) => h.action === 'repaired') ? 'repaired' : 'replaced with a safe template'} by safety review ({hintReview.map((h) => `${LANG_NAME[h.lang] ?? h.lang}: ${h.issues.join(', ')}`).join(' · ')})
              </span>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-3"><ShieldCheck size={13} className="text-leaf" /> Hint checked by safety review: kind, in the right language, doesn’t give the answer away</div>
          )}
        </section>
      )}

      {p.steps.length > 0 && (
        <section>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-3">Working, line by line</div>
          <ol className="space-y-1.5">
            {p.steps.map((s, i) => {
              const st = s.check?.status
              const isErr = p.error_step === i
              return (
                <li key={i} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 ${isErr ? 'border-pen/40 bg-pen-soft/40' : 'border-line bg-white'}`}>
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${st === 'true' ? 'bg-leaf' : st === 'false' ? 'bg-pen' : 'bg-ink-3'}`}>
                    {st === 'true' ? <Check size={12} /> : st === 'false' ? <X size={12} /> : <HelpCircle size={12} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm">{s.claim || s.text}</div>
                    {s.text && s.claim && s.text !== s.claim && <div className="text-xs text-ink-3">wrote: {s.text}</div>}
                    {st === 'false' && s.check.expected && <div className="text-xs font-semibold text-pen">should be {s.check.expected}</div>}
                    {st === 'unparseable' && <div className="text-xs text-ink-3">couldn’t check this line</div>}
                  </div>
                  {isErr && <Badge tone="pen">first error</Badge>}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {p.trace?.length > 0 && (
        <section className="rounded-2xl border border-line bg-paper-2/60">
          <button onClick={() => setShowTrace(!showTrace)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="flex items-center gap-2 text-sm font-semibold"><ListChecks size={16} className="text-leaf" /> How we checked <span className="text-xs font-normal text-ink-3">{p.trace.length} steps</span></span>
            <ChevronDown size={16} className={`transition ${showTrace ? 'rotate-180' : ''}`} />
          </button>
          {showTrace && <div className="px-4 pb-4"><VerificationLog lines={p.trace} /></div>}
        </section>
      )}

      <TeacherOverride pageId={pageId} index={index} problem={p} onUpdated={onUpdated} />

      {p.status !== 'correct' && <ChildExplains pageId={pageId} index={index} problem={p} onUpdated={onUpdated} />}
    </div>
  )
}

function ChildExplains({ pageId, index, problem, onUpdated }: Props) {
  const rec = useRecorder()
  const [language, setLanguage] = useState('Tamil')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string>()

  const send = async () => {
    if (!rec.blob) return
    setSending(true)
    setErr(undefined)
    try {
      const form = new FormData()
      form.append('audio', rec.blob, `explain.${extFor(rec.blob.type)}`)
      form.append('language', language)
      const updated = await api.explain(pageId, index, form)
      onUpdated(updated)
      rec.reset()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="rounded-2xl border border-ink/15 bg-white p-4">
      <div className="flex items-center gap-2 font-semibold"><Mic size={16} className="text-pen" /> Child explains</div>
      <p className="mt-0.5 text-xs text-ink-2">“How did you do this one?” Record the child talking through their working. Muse Voice Transcribe listens; Muse Wonder revisits the diagnosis.</p>

      {problem.explanation && (
        <div className="mt-3 rounded-xl bg-paper-2/70 px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">The child said</div>
          <div className="mt-0.5 text-[15px] leading-relaxed">“{problem.explanation.transcript || '…'}”</div>
          {problem.explanation.audio_url && <audio controls src={problem.explanation.audio_url} className="mt-2 h-9 w-full" />}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-ink-3">Diagnosis:</span>
            <span className="rounded bg-white px-1.5 py-0.5 text-ink-2">{pretty(problem.explanation.before)}</span>
            <ArrowRight size={12} className="text-ink-3" />
            <span className="rounded bg-pen-soft px-1.5 py-0.5 font-semibold text-pen">{pretty(problem.diagnosis?.misconception_id)}</span>
            {problem.explanation.before === problem.diagnosis?.misconception_id && <span className="text-leaf">(confirmed)</span>}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <RecordButton rec={rec} compact />
        <select className="input w-auto" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
          <option value="Tamil">Tamil</option>
          <option value="Hindi">Hindi</option>
          <option value="English">English</option>
        </select>
      </div>
      {rec.url && <audio controls src={rec.url} className="mt-3 h-9 w-full" />}
      <ErrorNote error={rec.error ?? err} />
      {rec.blob && (
        <button onClick={send} disabled={sending} className="btn btn-ink mt-3 w-full">
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {sending ? 'Listening and re-diagnosing…' : 'Re-diagnose with this explanation'}
        </button>
      )}
    </section>
  )
}

function TeacherOverride({ pageId, index, problem, onUpdated }: Props) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'correct' | 'wrong' | null>(null)
  const [err, setErr] = useState<string>()
  const o = problem.teacher_override

  const set = async (status: 'correct' | 'wrong') => {
    setBusy(status)
    setErr(undefined)
    try {
      onUpdated(await api.override(pageId, index, status, note.trim()))
      setNote('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 font-semibold"><UserCheck size={16} className="text-ink" /> Your call</div>
      <p className="mt-0.5 text-xs text-ink-2">The teacher has the final word on every mark.</p>
      {o && (
        <div className="mt-2 rounded-lg bg-paper-2/70 px-3 py-2 text-xs">
          <b>Teacher override:</b> {o.from.replace('_', ' ')} → {o.to}
          {o.note && <span className="text-ink-2"> · “{o.note}”</span>}
        </div>
      )}
      <input className="input mt-3 text-sm" placeholder="Note (optional), e.g. ‘answer was legible’" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={() => set('correct')} disabled={!!busy || problem.status === 'correct'} className="btn btn-ghost border-leaf/40 text-leaf">
          {busy === 'correct' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Mark correct
        </button>
        <button onClick={() => set('wrong')} disabled={!!busy || problem.status === 'wrong'} className="btn btn-ghost border-pen/40 text-pen">
          {busy === 'wrong' ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} Mark wrong
        </button>
      </div>
      <ErrorNote error={err} />
    </section>
  )
}
