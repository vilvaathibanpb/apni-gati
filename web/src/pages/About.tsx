import { Eye, Brain, Scissors, AudioLines, ImageIcon, BookOpen, NotebookPen, PenLine, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStatus } from '../lib/status'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { BackBar, H1, SectionTitle } from '../ui'

interface ModelCard { key: string; name: string; icon: ReactNode; does: string[] }

const MODELS: ModelCard[] = [
  { key: 'read_grade', name: 'Muse Spark 1.3', icon: <Eye size={20} />, does: ['Writes a different homework sheet for every child, in Tamil, Hindi or English — every answer checked by sympy before it is sent', 'Reads handwritten notebook pages with grounded boxes for every problem, answer and working line', 'Zoomed re-read of an answer before anything is marked wrong', 'Two independent misconception diagnoses per wrong answer', 'Reading-error pattern analysis'] },
  { key: 'agents', name: 'Muse Wonder 1.0', icon: <Brain size={20} />, does: ['Maps the teacher’s pasted syllabus onto the NCERT concept graph', 'Root-cause agent: walks errors back through prerequisites with tools, writes verified probe questions', 'TaRL lesson planning: groups by learning level, activities with free local materials', 'Built the NCERT concept graph using web search', 'Adjudicates when the two diagnoses disagree, and re-diagnoses after the child explains'] },
  { key: 'segmentation', name: 'SAM 3.1', icon: <Scissors size={20} />, does: ['Detects the notebook page in a photo', 'Tracks pages through a flip-through video', 'Pixel ink masks so red-pen marks sit exactly on the child’s writing'] },
  { key: 'speech', name: 'Muse Voice Transcribe', icon: <AudioLines size={20} />, does: ['Oral reading assessment in Hindi, Tamil and English (no keyword biasing, so real misreadings show)', 'Transcribes children explaining their own working'] },
  { key: 'worksheets', name: 'Muse Image', icon: <ImageIcon size={20} />, does: ['Illustrated, printable practice worksheets', 'Each sheet is read back and checked against the sympy-verified questions'] },
]

const STORY: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <BookOpen size={18} />, title: 'Teach once', body: 'The teacher sets up the class one time: the children (name, class, home language) and the term’s syllabus — pasted as text or picked from the NCERT concept graph.' },
  { icon: <NotebookPen size={18} />, title: 'Every child gets their own homework', body: 'Each evening, one tap. Apni Gati reads each child’s knowledge graph and writes a different sheet: harder next topics for a child ready for a challenge, class-level practice for a child on track, easier steps on the gap underneath for a child who needs practice. Families get a personal link on WhatsApp, or a printed sheet.' },
  { icon: <PenLine size={18} />, title: 'Marked in red pen', body: 'The child does it in the notebook and the family photographs the page from the link. It is read, checked line by line against that child’s answer key with sympy, and marked in red pen — ticks, circles on the first wrong step, a short note.' },
  { icon: <TrendingUp size={18} />, title: 'Progress moves', body: 'Every answer updates the child’s knowledge graph, so tomorrow’s sheet adapts, and the progress bar over the class syllabus moves — for the teacher, and for the child.' },
]

export default function About() {
  const { status } = useStatus()
  const usage = useAsync(api.usage, [])
  const u = usage.data
  return (
    <div>
      <BackBar to="/" label="Home" />
      <H1 sub="The teacher teaches once. Every child goes home with their own homework.">How Apni Gati works</H1>
      <ol className="card space-y-4 px-4 py-4">
        {STORY.map((st, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pen-soft text-pen">{st.icon}</div>
            <div className="min-w-0">
              <div className="font-semibold"><span className="hand mr-1 text-xl text-pen">{i + 1}</span>{st.title}</div>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{st.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 px-1 text-sm text-ink-2">
        Children see one of four tracks — <b>Ready for challenge</b>, <b>On track</b>, <b>Needs practice</b> or a first <b>Placement check</b> — never a label about the child. Every mark is checked: models read and reason, sympy does the arithmetic, and the teacher has the final word.
      </p>

      <SectionTitle>Which model does what</SectionTitle>
      <div className="space-y-3">
        {MODELS.map((m) => (
          <div key={m.key} className="card flex gap-4 px-4 py-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pen-soft text-pen">{m.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.name}</span>
                {status?.models?.[m.key] && <code className="rounded bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-2">{status.models[m.key]}</code>}
              </div>
              <ul className="mt-1.5 space-y-1 text-sm text-ink-2">
                {m.does.map((d, i) => <li key={i} className="flex gap-2"><span className="text-pen">–</span><span>{d}</span></li>)}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>API spend</SectionTitle>
      <div className="card px-5 py-4">
        {u ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm"><span className="hand text-3xl font-bold text-ink">${u.spent_usd.toFixed(2)}</span> <span className="text-ink-2">of ${u.budget_usd.toFixed(2)} budget</span></div>
              <span className="text-xs text-ink-3">{u.budget_usd ? Math.round((u.spent_usd / u.budget_usd) * 100) : 0}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper-2">
              <div className={`h-full rounded-full ${u.spent_usd / (u.budget_usd || 1) > 0.85 ? 'bg-pen' : 'bg-ink'}`} style={{ width: `${Math.min(100, (u.spent_usd / (u.budget_usd || 1)) * 100)}%` }} />
            </div>
            {u.breakdown.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-xs font-semibold text-ink-2">Breakdown by model and purpose</summary>
                <table className="mt-2 w-full text-xs">
                  <thead><tr className="text-left text-ink-3"><th className="py-1 font-semibold">Model</th><th className="font-semibold">Purpose</th><th className="text-right font-semibold">Calls</th><th className="text-right font-semibold">Cost</th></tr></thead>
                  <tbody>
                    {u.breakdown.map((b, i) => (
                      <tr key={i} className="border-t border-line/70"><td className="py-1 font-mono">{b.model}</td><td>{b.purpose}</td><td className="text-right tabular-nums">{b.calls}</td><td className="text-right tabular-nums">${(b.cost ?? 0).toFixed(3)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </>
        ) : usage.error ? (
          <p className="text-sm text-ink-3">Usage unavailable.</p>
        ) : (
          <p className="text-sm text-ink-3">Loading…</p>
        )}
      </div>

      <SectionTitle>Concept graph</SectionTitle>
      <div className="card ruled px-5 py-4 pl-10 text-sm">
        {status?.graph?.n_nodes ? (
          <p className="leading-8">
            <b className="hand text-2xl text-pen">{status.graph.n_nodes}</b> NCERT-aligned concepts (Classes 1–6) and{' '}
            <b className="hand text-2xl text-pen">{status.graph.n_misconceptions}</b> documented misconceptions, built by <code className="text-xs">{status.graph.built_by}</code>.
          </p>
        ) : (
          <p className="text-ink-3">Graph details unavailable.</p>
        )}
      </div>

      <SectionTitle>How a page is checked</SectionTitle>
      <ol className="card space-y-2 px-5 py-4 text-sm">
        {[
          'Muse Spark reads the page; SAM 3.1 finds the ink — in parallel',
          'sympy verifies every answer and every line of working',
          'A wrong answer is re-read zoomed-in, so a misread is never marked wrong',
          'Two independent diagnoses; if they disagree, Muse Wonder adjudicates',
          'Low confidence? Flagged for the teacher instead of guessed',
        ].map((t, i) => (
          <li key={i} className="flex gap-3"><span className="hand w-4 text-lg font-bold text-pen">{i + 1}</span><span className="pt-0.5">{t}</span></li>
        ))}
      </ol>
    </div>
  )
}
