import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, FileAudio, Lightbulb, Loader2, RotateCcw, Upload } from 'lucide-react'
import { api, pct, pretty, type AlignOp, type Passage, type Reading } from '../lib/api'
import { extFor, useAsync, useInterval, useRecorder } from '../lib/hooks'
import { BackBar, Badge, Empty, ErrorNote, H1, RecordButton, SectionTitle, Spinner, Stat, StatusChip } from '../ui'

const LANGS = ['Hindi', 'Tamil', 'English']
const LEVEL_ORDER = ['letters', 'words', 'paragraph', 'story']

export default function ReadingTest() {
  const { id = '' } = useParams()
  const klass = useAsync(() => api.klass(id), [id])
  const passages = useAsync(api.passages, [])
  const [studentId, setStudentId] = useState('')
  const [lang, setLang] = useState('')
  const [passageId, setPassageId] = useState('')
  const rec = useRecorder()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string>()
  const [reading, setReading] = useState<Reading | null>(null)
  const [readingId, setReadingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const students = klass.data?.students ?? []
  const student = students.find((s) => s.id === studentId)
  const language = lang || (student && LANGS.includes(student.language) ? student.language : '') || (klass.data && LANGS.includes(klass.data.language) ? klass.data.language : 'Hindi')

  const list = useMemo(
    () => (passages.data ?? []).filter((p) => p.language === language).sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)),
    [passages.data, language],
  )
  const passage: Passage | undefined = list.find((p) => p.id === passageId) ?? list[0]

  useEffect(() => { setPassageId('') }, [language])

  const polling = !!readingId && (!reading || reading.status === 'queued' || reading.status === 'processing')
  useInterval(async () => {
    if (!readingId) return
    try {
      setReading(await api.readingResult(readingId))
    } catch (e) {
      setErr((e as Error).message)
    }
  }, 2500, polling)

  const audio: Blob | null = file ?? rec.blob
  const submit = async () => {
    if (!audio || !studentId || !passage) return
    setUploading(true)
    setErr(undefined)
    try {
      const form = new FormData()
      form.append('audio', audio, file ? file.name : `reading.${extFor(audio.type)}`)
      form.append('passage_id', passage.id)
      const r = await api.reading(studentId, form)
      setReading(null)
      setReadingId(r.id)
      setReading(await api.readingResult(r.id))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const restart = () => {
    setReading(null)
    setReadingId(null)
    setFile(null)
    rec.reset()
  }

  if (klass.loading || passages.loading) return <Spinner />

  return (
    <div>
      <BackBar to={`/class/${id}`} label={klass.data?.name ?? 'Class'} />
      <H1 sub="ASER-style oral reading check. The child reads aloud; Muse Voice Transcribe listens without being told the passage, so real misreadings aren’t hidden.">Reading test</H1>
      <ErrorNote error={klass.error ?? passages.error} />

      {readingId ? (
        <ResultView reading={reading} passage={passage} studentName={student?.name} onRestart={restart} />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-ink-3">Child</label>
              <select className="input mt-1" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Choose a child…</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.name} · Class {s.grade}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-ink-3">Language</label>
              <div className="mt-1 flex rounded-xl border border-line bg-white p-1">
                {LANGS.map((l) => (
                  <button key={l} onClick={() => setLang(l)} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${language === l ? 'bg-ink text-white' : 'text-ink-2'}`}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          {students.length === 0 && <p className="mt-2 text-sm text-ink-3">This class has no children yet.</p>}

          <SectionTitle>Level</SectionTitle>
          {list.length === 0 ? (
            <Empty title="No passages for this language" />
          ) : (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {list.map((p) => (
                <button key={p.id} onClick={() => setPassageId(p.id)} className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold ${passage?.id === p.id ? 'border-pen bg-pen text-white' : 'border-line bg-card text-ink-2'}`}>
                  {pretty(p.level)}
                </button>
              ))}
            </div>
          )}

          {passage && (
            <div className="card ruled mt-3 px-6 py-5 pl-12">
              <p className={`leading-[2] text-ink ${passage.level === 'words' || passage.level === 'letters' ? 'text-3xl tracking-wide [word-spacing:0.6em]' : 'text-2xl'}`} lang={passage.language === 'Hindi' ? 'hi' : passage.language === 'Tamil' ? 'ta' : 'en'}>
                {passage.text}
              </p>
            </div>
          )}

          <div className="card mt-4 flex flex-col items-center px-4 py-5">
            <RecordButton rec={rec} />
            {rec.url && !file && <audio controls src={rec.url} className="mt-4 h-9 w-full" />}
            <div className="mt-4 flex w-full items-center gap-3 text-xs text-ink-3">
              <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
            </div>
            <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
              <FileAudio size={16} /> {file ? file.name : 'Upload an existing recording'}
            </button>
            <div className="mt-1 text-[11px] text-ink-3">Audio up to 40 MB and 10 minutes.</div>
            {file && <button onClick={() => setFile(null)} className="mt-1 text-xs text-ink-3 underline">use microphone instead</button>}
          </div>

          <ErrorNote error={rec.error ?? err} />
          <button onClick={submit} disabled={!audio || !studentId || !passage || uploading || rec.recording} className="btn btn-primary mt-4 w-full py-3.5">
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {!studentId ? 'Choose a child first' : !audio ? 'Record the child reading' : uploading ? 'Uploading…' : 'Assess reading'}
          </button>
        </>
      )}
    </div>
  )
}

const PUNCT = /[।॥.,!?;:'"“”‘’()\-–—]/g
const norm = (w: string) => w.replace(PUNCT, '').normalize('NFC').toLowerCase()

function ResultView({ reading, passage, studentName, onRestart }: { reading: Reading | null; passage?: Passage; studentName?: string; onRestart: () => void }) {
  if (!reading || reading.status === 'queued' || reading.status === 'processing') {
    return (
      <div className="card flex flex-col items-center px-6 py-10 text-center">
        <Loader2 size={30} className="animate-spin text-pen" />
        <div className="mt-3 font-semibold">Listening to {studentName ?? 'the child'}…</div>
        <div className="mt-1 text-sm text-ink-2">Transcribing, aligning word by word, and looking for decoding patterns.</div>
        <div className="mt-3">{reading && <StatusChip status={reading.status} />}</div>
      </div>
    )
  }
  if (reading.status === 'error' || !reading.result) {
    return (
      <div>
        <ErrorNote error={`Assessment failed: ${reading.result?.error ?? 'unknown error'}`} />
        <button onClick={onRestart} className="btn btn-ghost w-full"><RotateCcw size={16} /> Try again</button>
      </div>
    )
  }
  const r = reading.result
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{studentName} · {pretty(r.passage_level)} passage</div>
          <div className="hand text-4xl font-bold leading-tight text-pen">{pretty(r.level)}</div>
        </div>
        <Badge tone={r.passed ? 'leaf' : 'amber'}>{r.passed ? 'passed this level' : 'not yet'}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="accuracy" value={pct(r.accuracy)} tone={r.accuracy >= 0.9 ? 'leaf' : r.accuracy >= 0.7 ? 'amber' : 'pen'} />
        <Stat label="words correct / min" value={r.wcpm ?? '—'} />
        <Stat label="errors" value={r.errors} tone={r.errors > 3 ? 'pen' : undefined} />
        <Stat label="next test" value={<span className="text-base">{r.next_test ? pretty(r.next_test) : 'comprehension'}</span>} />
      </div>

      <SectionTitle right={<AlignLegend />}>What the child read</SectionTitle>
      <div className="card ruled px-5 py-5 pl-11">
        <AlignedPassage ops={r.alignment} passage={passage} />
      </div>
      {reading.audio_url && <audio controls src={reading.audio_url} className="mt-3 h-9 w-full" />}

      {r.analysis?.patterns?.length > 0 && (
        <>
          <SectionTitle>Patterns</SectionTitle>
          <div className="space-y-2">
            {r.analysis.patterns.map((p, i) => (
              <div key={i} className="card px-4 py-3">
                <div className="font-semibold">{p.pattern}</div>
                {p.examples?.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{p.examples.map((e, j) => <span key={j} className="rounded-md bg-paper-2 px-2 py-0.5 text-sm">{e}</span>)}</div>}
              </div>
            ))}
          </div>
        </>
      )}
      {r.analysis?.teacher_tip && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-leaf/25 bg-leaf-soft/60 px-4 py-3">
          <Lightbulb size={18} className="mt-0.5 shrink-0 text-leaf" />
          <div><div className="text-[10px] font-bold uppercase tracking-wider text-leaf">5-minute activity</div><p className="mt-0.5 text-[15px] leading-relaxed">{r.analysis.teacher_tip}</p></div>
        </div>
      )}
      {r.analysis?.asr_caveat && (
        <div className="mt-3 flex gap-3 rounded-2xl border border-dashed border-ink-3/40 px-4 py-3 text-sm text-ink-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-ink-3" />
          <div><b className="text-ink">May be a speech-recognition artefact: </b>{r.analysis.asr_caveat}</div>
        </div>
      )}
      {r.transcript && (
        <details className="mt-3 text-sm text-ink-2">
          <summary className="cursor-pointer font-semibold">Raw transcript</summary>
          <p className="mt-1 rounded-xl bg-paper-2/70 px-3 py-2">{r.transcript}</p>
        </details>
      )}
      <button onClick={onRestart} className="btn btn-ghost mt-5 w-full"><RotateCcw size={16} /> Test another child</button>
    </div>
  )
}

function AlignLegend() {
  return (
    <div className="flex flex-wrap gap-x-2.5 text-[11px] text-ink-2">
      <span className="underline decoration-amber decoration-2 underline-offset-2">near</span>
      <span className="text-pen">substituted</span>
      <span className="text-pen line-through">omitted</span>
      <span className="text-ink-3">+inserted</span>
    </div>
  )
}

function AlignedPassage({ ops, passage }: { ops: AlignOp[]; passage?: Passage }) {
  // Map normalised ref tokens back to the printed words (with punctuation) when they line up.
  const printed = (passage?.text ?? '').split(/\s+/).filter((w) => norm(w))
  const refCount = ops.filter((o) => o.ref).length
  const usePrinted = printed.length === refCount
  let k = 0
  return (
    <p className="flex flex-wrap items-end gap-x-2.5 gap-y-3 text-2xl leading-tight">
      {ops.map((o, i) => {
        const word = o.ref ? (usePrinted ? printed[k++] : o.ref) : null
        switch (o.op) {
          case 'correct':
            return <span key={i}>{word}</span>
          case 'near':
            return <span key={i} className="underline decoration-amber decoration-[3px] underline-offset-4" title={`heard “${o.said}”`}>{word}</span>
          case 'substituted':
            return (
              <span key={i} className="inline-flex flex-col items-center">
                <span className="hand text-lg leading-none text-pen">{o.said}</span>
                <span className="text-pen decoration-pen/60 underline decoration-wavy underline-offset-4">{word}</span>
              </span>
            )
          case 'omitted':
            return <span key={i} className="text-pen/80 line-through decoration-pen decoration-2">{word}</span>
          case 'inserted':
            return <span key={i} className="self-start rounded bg-paper-2 px-1 text-xs text-ink-3" title="said but not in the passage">+{o.said}</span>
          default:
            return <span key={i}>{word}</span>
        }
      })}
    </p>
  )
}
