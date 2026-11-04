import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, ChevronDown, ClipboardPaste, ListChecks, Loader2, NotebookPen, Plus, Trash2, Users, Wand2 } from 'lucide-react'
import { api, type GraphNode, type NewStudent, type Syllabus, type SyllabusConcept } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { initials } from '../components/Homework'
import { AgentProgress, BackBar, Badge, ErrorNote, H1, SectionTitle, Spinner } from '../ui'

const LANGS = ['Tamil', 'Hindi', 'English']
const GRADES = [1, 2, 3, 4, 5, 6]

interface Row { key: number; name: string; grade: number; language: string }

export default function ClassSetup() {
  const { id = '' } = useParams()
  const klass = useAsync(() => api.klass(id), [id])
  const syllabus = useAsync(() => api.syllabus(id), [id])

  if (klass.loading) return <Spinner />
  if (klass.error || !klass.data) return <ErrorNote error={klass.error ?? 'Class not found'} onRetry={klass.reload} />
  const k = klass.data
  const grades = Array.isArray(k.grades) ? (k.grades as unknown[]).map(Number).filter((n) => !Number.isNaN(n)) : []
  const lang = LANGS.includes(k.language) ? k.language : 'Tamil'
  const ready = k.students.length > 0 && (syllabus.data?.concept_ids.length ?? 0) > 0

  return (
    <div>
      <BackBar to={`/class/${id}`} label={k.name} />
      <H1 sub="Do this once. After that, every evening is one tap: each child gets their own homework.">Class setup</H1>

      <div className="mb-2 grid grid-cols-2 gap-2 text-sm">
        <a href="#children" className={`card flex items-center gap-2 px-3 py-2.5 ${k.students.length ? 'border-leaf/30' : ''}`}>
          <StepDot done={k.students.length > 0} n={1} /> <span className="font-semibold">Children</span>
          <span className="ml-auto text-xs text-ink-3 tabular-nums">{k.students.length}</span>
        </a>
        <a href="#syllabus" className={`card flex items-center gap-2 px-3 py-2.5 ${syllabus.data?.concept_ids.length ? 'border-leaf/30' : ''}`}>
          <StepDot done={(syllabus.data?.concept_ids.length ?? 0) > 0} n={2} /> <span className="font-semibold">Syllabus</span>
          <span className="ml-auto text-xs text-ink-3 tabular-nums">{syllabus.data?.concept_ids.length ?? '…'} topics</span>
        </a>
      </div>

      <section id="children" className="scroll-mt-16">
        <SectionTitle>1 · Children</SectionTitle>
        <Roster students={k.students} />
        <BulkEntry classId={id} defaultGrade={grades[0] ?? 3} defaultLang={lang} gradeOptions={grades} onSaved={klass.reload} />
      </section>

      <section id="syllabus" className="scroll-mt-16">
        <SectionTitle>2 · Syllabus</SectionTitle>
        {syllabus.loading ? <Spinner /> : syllabus.error ? <ErrorNote error={syllabus.error} onRetry={syllabus.reload} /> : (
          <SyllabusEditor classId={id} current={syllabus.data!} onSaved={(s) => syllabus.setData(s)} />
        )}
      </section>

      {ready && (
        <Link to={`/class/${id}/homework`} className="btn btn-primary mt-6 w-full py-4 text-lg">
          <NotebookPen size={22} /> Give tonight’s homework
        </Link>
      )}
    </div>
  )
}

function StepDot({ done, n }: { done: boolean; n: number }) {
  return <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-leaf text-white' : 'border border-line bg-white text-ink-3'}`}>{done ? <Check size={12} /> : n}</span>
}

function Roster({ students }: { students: { id: string; name: string; grade: number; language: string }[] }) {
  if (!students.length) return <p className="mb-3 text-sm text-ink-3">No children yet. Add them below — it takes a minute.</p>
  return (
    <div className="card mb-3 flex flex-wrap gap-1.5 px-3 py-3">
      {[...students].sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)).map((s) => (
        <Link key={s.id} to={`/student/${s.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pl-0.5 pr-2.5 text-xs hover:bg-paper-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-paper-2 text-[10px] font-bold">{initials(s.name)}</span>
          <span className="font-semibold">{s.name}</span>
          <span className="text-ink-3">C{s.grade} · {s.language}</span>
        </Link>
      ))}
    </div>
  )
}

/** "Kavin, 3, Tamil" / "Kavin\t3" / "Kavin" -> a row. */
function parseLine(line: string, grade: number, language: string): Omit<Row, 'key'> | null {
  const parts = line.split(/\t|,|;/).map((x) => x.trim()).filter(Boolean)
  if (!parts.length) return null
  let g = grade
  let l = language
  const name: string[] = []
  for (const p of parts) {
    const num = p.match(/^(?:class\s*)?([1-6])$/i)
    const lang = LANGS.find((x) => x.toLowerCase() === p.toLowerCase())
    if (num) g = Number(num[1])
    else if (lang) l = lang
    else name.push(p)
  }
  const n = name.join(' ').replace(/^\d+[.)]\s*/, '').trim()
  return n ? { name: n, grade: g, language: l } : null
}

let rowKey = 1

function BulkEntry({ classId, defaultGrade, defaultLang, gradeOptions, onSaved }: { classId: string; defaultGrade: number; defaultLang: string; gradeOptions: number[]; onSaved: () => Promise<void> }) {
  const blank = (): Row => ({ key: rowKey++, name: '', grade: defaultGrade, language: defaultLang })
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank(), blank()])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const [added, setAdded] = useState<number | null>(null)
  const focusKey = useRef<number | null>(null)
  const grades = gradeOptions.length ? [...new Set([...gradeOptions, ...GRADES])].sort((a, b) => a - b) : GRADES

  useEffect(() => {
    if (focusKey.current === null) return
    document.querySelector<HTMLInputElement>(`[data-row="${focusKey.current}"]`)?.focus()
    focusKey.current = null
  }, [rows])

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addRow = (after?: number) => {
    const prev = rows.find((r) => r.key === after) ?? rows[rows.length - 1]
    const r = { ...blank(), grade: prev?.grade ?? defaultGrade, language: prev?.language ?? defaultLang }
    focusKey.current = r.key
    setRows((rs) => {
      const i = after === undefined ? rs.length : rs.findIndex((x) => x.key === after) + 1
      return [...rs.slice(0, i), r, ...rs.slice(i)]
    })
  }
  const applyPaste = () => {
    const parsed = paste.split(/\n/).map((l) => parseLine(l, defaultGrade, defaultLang)).filter((x): x is Omit<Row, 'key'> => !!x)
    if (!parsed.length) return
    setRows((rs) => [...rs.filter((r) => r.name.trim()), ...parsed.map((p) => ({ ...p, key: rowKey++ }))])
    setPaste('')
    setPasteOpen(false)
  }

  const filled = rows.filter((r) => r.name.trim())
  const save = async () => {
    if (!filled.length) return
    setBusy(true)
    setErr(undefined)
    try {
      const body: NewStudent[] = filled.map((r) => ({ name: r.name.trim(), grade: r.grade, language: r.language }))
      const out = await api.addStudents(classId, body)
      setAdded(out.length)
      setRows([blank(), blank(), blank()])
      await onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold"><Users size={16} className="text-ink-3" /> Add children</div>
        <button onClick={() => setPasteOpen(!pasteOpen)} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${pasteOpen ? 'bg-ink text-white' : 'text-ink-2 hover:bg-paper-2'}`}>
          <ClipboardPaste size={13} /> Paste many names
        </button>
      </div>

      {pasteOpen && (
        <div className="border-b border-line/70 bg-paper-2/40 px-4 py-3">
          <textarea className="input min-h-32 font-mono text-sm" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'One child per line, e.g.\nKavin\nNila, 4\nRavi, 5, Hindi'} autoFocus />
          <div className="mt-1 text-[11px] text-ink-3">Class and language are optional on each line; otherwise Class {defaultGrade} · {defaultLang}. Copying from a spreadsheet works too.</div>
          <button onClick={applyPaste} disabled={!paste.trim()} className="btn btn-ink mt-2 w-full py-2 text-sm">Add {paste.split('\n').filter((l) => l.trim()).length || ''} to the table</button>
        </div>
      )}

      <div className="px-2 pt-2">
        <div className="grid grid-cols-[1fr_3.75rem_5.75rem_2rem] gap-1.5 px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-3">
          <span>Name</span><span>Class</span><span>Language</span><span />
        </div>
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[1fr_3.75rem_5.75rem_2rem] items-center gap-1.5 py-0.5">
            <input
              data-row={r.key}
              className="input px-2.5 py-2 text-[15px]"
              value={r.name}
              placeholder={i === 0 ? 'e.g. Kavin' : 'Name'}
              autoComplete="off"
              enterKeyHint="next"
              onChange={(e) => set(r.key, { name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(r.key) } }}
            />
            <select className="input px-1.5 py-2 text-[15px]" value={r.grade} onChange={(e) => set(r.key, { grade: Number(e.target.value) })} aria-label="Class">
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="input px-1.5 py-2 text-[15px]" value={r.language} onChange={(e) => set(r.key, { language: e.target.value })} aria-label="Language">
              {LANGS.map((l) => <option key={l}>{l}</option>)}
            </select>
            <button onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))} className="flex h-9 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-paper-2 hover:text-pen" aria-label="Remove row">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button onClick={() => addRow()} className="my-1.5 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-semibold text-ink-2 hover:bg-paper-2">
          <Plus size={15} /> Add row
        </button>
      </div>

      <div className="border-t border-line/70 px-4 py-3">
        <ErrorNote error={err} />
        {added !== null && !filled.length && <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-leaf"><Check size={15} /> Added {added} {added === 1 ? 'child' : 'children'} to the class</div>}
        <button onClick={save} disabled={busy || !filled.length} className="btn btn-primary w-full">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
          {filled.length ? `Add ${filled.length} ${filled.length === 1 ? 'child' : 'children'}` : 'Type names to add'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- syllabus

function byGrade<T extends { grade: number }>(xs: T[]): [number, T[]][] {
  const m = new Map<number, T[]>()
  for (const x of xs) m.set(x.grade, [...(m.get(x.grade) ?? []), x])
  return [...m.entries()].sort((a, b) => a[0] - b[0])
}

function SyllabusChips({ concepts, highlight }: { concepts: SyllabusConcept[]; highlight?: Set<string> }) {
  if (!concepts.length) return <p className="text-sm text-ink-3">No topics yet.</p>
  return (
    <div className="space-y-2">
      {byGrade(concepts).map(([g, cs]) => (
        <div key={g}>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink-3">Class {g}</div>
          <div className="flex flex-wrap gap-1.5">
          {cs.map((c) => (
            <span key={c.id} title={c.ncert_ref} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${highlight?.has(c.id) ? 'border-leaf/40 bg-leaf-soft text-leaf' : 'border-line bg-white text-ink'}`}>
              {c.name}
            </span>
          ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SyllabusEditor({ classId, current, onSaved }: { classId: string; current: Syllabus; onSaved: (s: Syllabus) => void }) {
  const [mode, setMode] = useState<'paste' | 'pick'>(current.concept_ids.length ? 'pick' : 'paste')
  const [mapped, setMapped] = useState<{ added: Set<string>; unmatched: string[] } | null>(null)

  const saved = (s: Syllabus, before: string[]) => {
    const prev = new Set(before)
    setMapped({ added: new Set(s.concept_ids.filter((c) => !prev.has(c))), unmatched: s.unmatched ?? [] })
    onSaved(s)
  }

  return (
    <>
      <div className="card mb-3 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">This term’s syllabus</span>
          <Badge tone={current.concept_ids.length ? 'leaf' : 'grey'}>{current.concept_ids.length} topics</Badge>
        </div>
        <SyllabusChips concepts={current.concepts} highlight={mapped?.added} />
        {mapped && (
          <div className="mt-3 space-y-2 border-t border-line/70 pt-2.5 text-sm">
            <div className="flex items-center gap-1.5 font-medium text-leaf"><Check size={15} /> Saved{mapped.added.size ? ` · ${mapped.added.size} new topic${mapped.added.size === 1 ? '' : 's'} highlighted` : ''}</div>
            {mapped.unmatched.length > 0 && (
              <div className="rounded-xl border border-amber/30 bg-amber-soft/60 px-3 py-2">
                <div className="text-xs font-semibold text-amber">Not matched to a topic ({mapped.unmatched.length}) — pick them by hand if they matter:</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-2">
                  {mapped.unmatched.map((u, i) => <li key={i}>{u}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-2 flex rounded-full border border-line bg-white p-0.5 text-sm font-semibold">
        <button onClick={() => setMode('paste')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 ${mode === 'paste' ? 'bg-ink text-white' : 'text-ink-2'}`}><ClipboardPaste size={15} /> Paste syllabus</button>
        <button onClick={() => setMode('pick')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 ${mode === 'pick' ? 'bg-ink text-white' : 'text-ink-2'}`}><ListChecks size={15} /> Pick topics</button>
      </div>
      {mode === 'paste' ? (
        <PasteSyllabus classId={classId} current={current} onSaved={(s) => saved(s, current.concept_ids)} />
      ) : (
        <PickSyllabus classId={classId} current={current} onSaved={(s) => saved(s, current.concept_ids)} />
      )}
    </>
  )
}

function PasteSyllabus({ classId, current, onSaved }: { classId: string; current: Syllabus; onSaved: (s: Syllabus) => void }) {
  const [text, setText] = useState('')
  const [keep, setKeep] = useState(false)
  const map = useAction((body: { text: string; concept_ids: string[] }) => api.setSyllabus(classId, body))
  const submit = async () => {
    const r = await map.run({ text, concept_ids: keep ? current.concept_ids : [] })
    if (r) {
      onSaved(r)
      setText('')
    }
  }
  if (map.running)
    return (
      <AgentProgress
        title="Muse Wonder is reading your syllabus…"
        elapsed={map.elapsed}
        expected="20–40 s"
        steps={['Reading each line of the syllabus', 'Matching chapters to NCERT concepts', 'Checking prerequisites in the concept graph', 'Putting topics in teaching order']}
      />
    )
  return (
    <div className="card px-4 py-3">
      <textarea
        className="input min-h-40 text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Paste the chapter list or term syllabus, any format, e.g.\nCh 1 Numbers up to 1000\nCh 3 Subtraction with borrowing\nCh 7 Halves and quarters'}
      />
      <div className="mt-1 text-[11px] text-ink-3">Muse Wonder maps each line to topics in the concept graph and tells you honestly which lines it couldn’t match.</div>
      {current.concept_ids.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-4 w-4 accent-pen" />
          Keep the {current.concept_ids.length} topics already in the syllabus
        </label>
      )}
      <ErrorNote error={map.error} />
      <button onClick={submit} disabled={!text.trim()} className="btn btn-primary mt-3 w-full"><Wand2 size={17} /> Match to topics and save</button>
    </div>
  )
}

function PickSyllabus({ classId, current, onSaved }: { classId: string; current: Syllabus; onSaved: (s: Syllabus) => void }) {
  const graph = useAsync(api.graph, [])
  const [sel, setSel] = useState<Set<string>>(() => new Set(current.concept_ids))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => { setSel(new Set(current.concept_ids)) }, [current.concept_ids])
  const groups = useMemo(() => byGrade<GraphNode>(graph.data?.nodes ?? []), [graph.data])
  const [openGrades, setOpenGrades] = useState<Set<number> | null>(null)
  useEffect(() => {
    if (!graph.data || openGrades) return
    const has = new Set(current.concept_ids)
    setOpenGrades(new Set(graph.data.nodes.filter((n) => has.has(n.id)).map((n) => n.grade)))
  }, [graph.data, current.concept_ids, openGrades])
  const changed = sel.size !== current.concept_ids.length || current.concept_ids.some((c) => !sel.has(c))

  const toggle = (ids: string[], on: boolean) => setSel((s) => {
    const n = new Set(s)
    ids.forEach((i) => (on ? n.add(i) : n.delete(i)))
    return n
  })
  const save = async () => {
    setBusy(true)
    setErr(undefined)
    try {
      onSaved(await api.setSyllabus(classId, { concept_ids: [...sel] }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (graph.loading) return <Spinner />
  if (graph.error) return <ErrorNote error={graph.error} onRetry={graph.reload} />
  return (
    <div className="card overflow-hidden">
      {groups.map(([g, nodes]) => {
        const ids = nodes.map((n) => n.id)
        const all = ids.every((i) => sel.has(i))
        return (
          <div key={g} className="border-b border-line/70 last:border-b-0">
            <div role="button" tabIndex={0} onClick={() => setOpenGrades((o) => { const n = new Set(o ?? []); if (n.has(g)) n.delete(g); else n.add(g); return n })} className="flex cursor-pointer items-center gap-2 px-4 py-2.5">
              <ChevronDown size={15} className={`text-ink-3 transition ${openGrades?.has(g) ? '' : '-rotate-90'}`} />
              <span className="font-semibold">NCERT Class {g}</span>
              <span className="text-xs text-ink-3">{ids.filter((i) => sel.has(i)).length}/{ids.length}</span>
              <button onClick={(e) => { e.stopPropagation(); toggle(ids, !all) }} className="ml-auto rounded-full px-2 py-0.5 text-xs font-semibold text-ink-2 hover:bg-paper-2">{all ? 'Clear' : 'Select all'}</button>
            </div>
            {openGrades?.has(g) && <div className="space-y-0.5 px-2 pb-2">
              {nodes.map((n) => (
                <label key={n.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 ${sel.has(n.id) ? 'bg-leaf-soft/50' : 'hover:bg-paper-2/60'}`}>
                  <input type="checkbox" checked={sel.has(n.id)} onChange={(e) => toggle([n.id], e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-leaf" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{n.name}</span>
                    <span className="block truncate text-[11px] text-ink-3">{n.ncert_ref}</span>
                  </span>
                </label>
              ))}
            </div>}
          </div>
        )
      })}
      <div className="sticky bottom-0 border-t border-line/70 bg-card/95 px-4 py-3 backdrop-blur">
        <ErrorNote error={err} />
        <button onClick={save} disabled={busy || !changed || sel.size === 0} className="btn btn-primary w-full">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} {changed ? `Save syllabus · ${sel.size} topics` : `${sel.size} topics saved`}
        </button>
      </div>
    </div>
  )
}
