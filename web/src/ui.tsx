import { useEffect, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CloudOff, Loader2, Mic, Square, X } from 'lucide-react'
import { useStatus } from './lib/status'
import { fmtTime, type Recorder } from './lib/hooks'

export function Logo({ size = 28, link = true }: { size?: number; link?: boolean }) {
  const body = (
    <>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
        <rect x="1" y="1" width="38" height="38" rx="10" fill="white" stroke="#e6dfcf" />
        <path d="M9 21 l7 8 L31 11" fill="none" stroke="#d2161f" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="leading-none">
        <span className="hand font-bold text-pen" style={{ fontSize: size * 0.97 }}>Apni</span>
        <span className="hand font-bold text-ink" style={{ fontSize: size * 0.97 }}> Gati</span>
      </span>
    </>
  )
  if (!link) return <span className="flex select-none items-center gap-2" aria-label="Apni Gati">{body}</span>
  return (
    <Link to="/" className="flex items-center gap-2 select-none" aria-label="Apni Gati home">
      {body}
    </Link>
  )
}

export function ServerStatus() {
  const { reachable } = useStatus()
  if (reachable) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-pen-soft px-3 py-1.5 text-xs font-semibold text-pen">
      <CloudOff size={14} /> Server unreachable
    </span>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-line/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
          <Logo />
          <div className="flex items-center gap-2">
            <NavLink to="/district" className={({ isActive }) => `hidden rounded-full px-3 py-1.5 text-xs font-semibold sm:inline-block ${isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-paper-2'}`}>
              District
            </NavLink>
            <ServerStatus />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-4">{children}</main>
      <footer className="no-print border-t border-line/70 py-5 text-center text-xs text-ink-3">
        <span className="hand text-base text-ink-2">Apni Gati</span> · built with Meta models ·{' '}
        <Link to="/about" className="font-semibold text-ink-2 underline decoration-pen/50 underline-offset-2">
          Which model does what
        </Link>{' '}
        · <Link to="/district" className="font-semibold text-ink-2 underline decoration-pen/50 underline-offset-2">District view</Link>
      </footer>
    </div>
  )
}

export function BackBar({ to, label, right }: { to?: string; label: string; right?: ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="no-print mb-3 flex items-center justify-between gap-2">
      <button onClick={() => (to ? nav(to) : nav(-1))} className="inline-flex items-center gap-1 rounded-full py-1 pr-3 text-sm font-medium text-ink-2 hover:text-ink">
        <ArrowLeft size={16} /> {label}
      </button>
      {right}
    </div>
  )
}

export function H1({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{children}</h1>
      {sub && <div className="mt-0.5 text-sm text-ink-2">{sub}</div>}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between gap-2">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-ink-3">{children}</h2>
      {right}
    </div>
  )
}

type Tone = 'pen' | 'amber' | 'leaf' | 'ink' | 'grey'
const TONES: Record<Tone, string> = {
  pen: 'bg-pen-soft text-pen',
  amber: 'bg-amber-soft text-amber',
  leaf: 'bg-leaf-soft text-leaf',
  ink: 'bg-ink/8 text-ink',
  grey: 'bg-paper-2 text-ink-3',
}
export function Badge({ tone = 'ink', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]} ${className}`}>{children}</span>
}

export function SimulatedBadge() {
  return <Badge tone="grey" className="border border-dashed border-ink-3/50">Simulated data</Badge>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3">
      <Loader2 size={18} className="animate-spin" /> {label ?? 'Loading…'}
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: string | Error | undefined; onRetry?: () => void }) {
  if (!error) return null
  const msg = typeof error === 'string' ? error : error.message
  return (
    <div className="my-3 flex items-start gap-2 rounded-xl border border-pen/25 bg-pen-soft/60 px-3 py-2.5 text-sm text-pen">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{msg}</div>
      {onRetry && (
        <button className="font-semibold underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card ruled flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="hand text-2xl font-bold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-2">{children}</div>}
    </div>
  )
}

/** Progress card for the slow agent calls (Muse Wonder etc.). */
export function AgentProgress({ title, elapsed, steps, expected }: { title: string; elapsed: number; steps: string[]; expected: string }) {
  const idx = Math.min(steps.length - 1, Math.floor(elapsed / 9))
  return (
    <div className="card relative overflow-hidden px-5 py-5">
      <div className="flex items-center gap-4">
        <svg width="54" height="54" viewBox="0 0 54 54" className="shrink-0" aria-hidden>
          <circle cx="27" cy="27" r="25" fill="#fbe6e5" />
          <path d="M12 30 C 18 18, 24 40, 30 26 S 40 20, 43 28" fill="none" stroke="#d2161f" strokeWidth="3" strokeLinecap="round" className="scribble" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{title}</div>
          <div className="mt-0.5 text-sm text-ink-2">
            <span className="pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-pen align-middle" /> {steps[idx]}
          </div>
          <div className="mt-1 text-xs text-ink-3">
            {fmtTime(elapsed)} elapsed · usually {expected}
          </div>
        </div>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-paper-2">
        <div className="h-full rounded-full bg-pen/70 transition-all duration-500" style={{ width: `${Math.min(95, 8 + elapsed * 1.2)}%` }} />
      </div>
    </div>
  )
}

export function BottomSheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <div className="fade-in absolute inset-0 bg-ink/35" onClick={onClose} />
      <div className="sheet-up relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-paper shadow-2xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line/70 bg-paper/95 px-5 pb-3 pt-2 backdrop-blur">
          <div className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line sm:hidden" />
          <div className="min-w-0 pt-3 font-semibold">{title}</div>
          <button onClick={onClose} className="mt-2 rounded-full p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pb-8 pt-4">{children}</div>
      </div>
    </div>
  )
}

export function StatusChip({ status }: { status: string }) {
  if (status === 'grading')
    return (
      <Badge tone="ink" className="bg-ink text-white">
        <Loader2 size={11} className="animate-spin" /> grading
      </Badge>
    )
  if (status === 'queued') return <Badge tone="grey"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ink-3" /> queued</Badge>
  if (status === 'done') return <Badge tone="leaf">done</Badge>
  if (status === 'error') return <Badge tone="pen">error</Badge>
  if (status === 'processing') return <Badge tone="ink"><Loader2 size={11} className="animate-spin" /> processing</Badge>
  return <Badge tone="grey">{status}</Badge>
}

/** Big round record button with timer and level bars. */
export function RecordButton({ rec, compact }: { rec: Recorder; compact?: boolean }) {
  const bars = 14
  return (
    <div className={`flex items-center gap-4 ${compact ? '' : 'flex-col'}`}>
      <button
        onClick={() => (rec.recording ? rec.stop() : rec.start())}
        disabled={!rec.supported}
        className={`relative flex shrink-0 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95 ${compact ? 'h-14 w-14' : 'h-20 w-20'} ${rec.recording ? 'bg-ink' : 'bg-pen'}`}
        aria-label={rec.recording ? 'Stop recording' : 'Start recording'}
      >
        {rec.recording && <span className="absolute inset-0 animate-ping rounded-full bg-pen/30" />}
        {rec.recording ? <Square size={compact ? 20 : 26} fill="white" /> : <Mic size={compact ? 22 : 30} />}
      </button>
      <div className={`flex flex-col ${compact ? 'items-start' : 'items-center'} gap-1.5`}>
        <div className="font-mono text-lg font-semibold tabular-nums text-ink">{fmtTime(rec.seconds)}</div>
        <div className="flex h-6 items-end gap-[3px]" aria-hidden>
          {Array.from({ length: bars }).map((_, i) => {
            const on = rec.recording && rec.level * bars > i
            return <span key={i} className={`w-1.5 rounded-sm transition-all duration-75 ${on ? (i > bars * 0.8 ? 'bg-pen' : 'bg-ink') : 'bg-line'}`} style={{ height: `${30 + (i / bars) * 70}%` }} />
          })}
        </div>
        <div className="text-xs text-ink-3">{!rec.supported ? 'Recording not supported in this browser' : rec.recording ? 'Recording… tap to stop' : rec.blob ? 'Recorded · tap to redo' : 'Tap to record'}</div>
      </div>
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'pen' | 'leaf' | 'amber' }) {
  const color = tone === 'pen' ? 'text-pen' : tone === 'leaf' ? 'text-leaf' : tone === 'amber' ? 'text-amber' : 'text-ink'
  return (
    <div className="rounded-xl border border-line bg-white/70 px-3 py-2.5">
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
    </div>
  )
}

export function timeAgo(ts: number | undefined): string {
  if (!ts) return ''
  const s = Date.now() / 1000 - ts
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(ts * 1000).toLocaleDateString()
}

/** Centered confirm dialog (in-app, not window.confirm). */
export function ConfirmDialog({ open, title, children, confirmLabel, busy, onConfirm, onCancel, danger, confirmDisabled }: { open: boolean; confirmDisabled?: boolean; title: string; children: ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="alertdialog" aria-modal>
      <div className="fade-in absolute inset-0 bg-ink/40" onClick={() => !busy && onCancel()} />
      <div className="sheet-up relative w-full max-w-sm rounded-3xl bg-paper p-5 shadow-2xl">
        <div className="text-lg font-bold">{title}</div>
        <div className="mt-2 text-sm text-ink-2">{children}</div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost">Cancel</button>
          <button onClick={onConfirm} disabled={busy || confirmDisabled} className={`btn ${danger ? 'btn-primary' : 'btn-ink'}`}>
            {busy && <Loader2 size={16} className="animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
