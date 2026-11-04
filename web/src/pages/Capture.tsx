import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Camera, ChevronRight, Film, ImagePlus, Loader2, Upload, X } from 'lucide-react'
import { api, type Page } from '../lib/api'
import { useAsync, useInterval } from '../lib/hooks'
import { BackBar, Badge, Empty, ErrorNote, H1, SectionTitle, StatusChip, timeAgo } from '../ui'

const isVideo = (f: File) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name)

export default function Capture() {
  const { id = '' } = useParams()
  const klass = useAsync(() => api.klass(id), [id])
  const pages = useAsync(() => api.pages(id), [id])
  const [files, setFiles] = useState<File[]>([])
  const [studentId, setStudentId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string>()
  const [justSent, setJustSent] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const active = (pages.data ?? []).some((p) => p.status === 'queued' || p.status === 'grading')
  // keep polling a little after an upload: video pages appear only after SAM tracking finishes
  const recentlySent = justSent !== null && Date.now() - justSent < 180_000
  useInterval(() => void pages.reload(), 3000, active || recentlySent)

  const previews = useMemo(() => files.map((f) => ({ f, url: isVideo(f) ? null : URL.createObjectURL(f) })), [files])
  useEffect(() => () => { previews.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url) }) }, [previews])

  const addFiles = (list: FileList | null) => {
    if (!list) return
    setFiles((prev) => [...prev, ...Array.from(list)])
  }

  const send = async () => {
    if (!files.length) return
    setUploading(true)
    setErr(undefined)
    try {
      const form = new FormData()
      files.forEach((f) => form.append('files', f, f.name))
      if (studentId) form.append('student_id', studentId)
      await api.capture(id, form)
      setFiles([])
      setJustSent(Date.now())
      await pages.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const students = klass.data?.students ?? []
  const nameOf = (sid: string | null) => students.find((s) => s.id === sid)?.name

  return (
    <div>
      <BackBar to={`/class/${id}`} label={klass.data?.name ?? 'Class'} />
      <H1 sub="Photos of pages, or one video flipping through a notebook. SAM 3.1 finds each page, Muse Spark reads and marks it.">Mark notebooks</H1>

      <div className="card ruled overflow-hidden p-4">
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => inputRef.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-pen/40 bg-white/80 px-3 py-6 text-pen transition hover:bg-pen-soft/50">
            <Camera size={30} />
            <span className="text-sm font-semibold">Use camera</span>
            <span className="text-[11px] text-ink-3">photo or flip video</span>
          </button>
          <button onClick={() => galleryRef.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line bg-white/80 px-3 py-6 text-ink-2 transition hover:bg-paper-2">
            <ImagePlus size={30} />
            <span className="text-sm font-semibold">From gallery</span>
            <span className="text-[11px] text-ink-3">choose files</span>
          </button>
        </div>

        {files.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {previews.map(({ f, url }, i) => (
              <div key={i} className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-paper-2">
                {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 p-1 text-center text-ink-2"><Film size={20} /><span className="line-clamp-2 text-[9px]">{f.name}</span></div>
                )}
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-ink/70 p-0.5 text-white" aria-label="Remove"><X size={12} /></button>
              </div>
            ))}
          </div>
        )}

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-3">Whose notebook?</label>
        <select className="input mt-1" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Detect from name on page</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · Class {s.grade}</option>
          ))}
        </select>

        <p className="mt-2 text-[11px] text-ink-3">Limits: photos up to 25 MB · video up to 300 MB and 3 minutes.</p>

        <ErrorNote error={err} />

        <button onClick={send} disabled={!files.length || uploading} className="btn btn-primary mt-4 w-full py-3.5">
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          {uploading ? 'Uploading…' : files.length ? `Mark ${files.length} file${files.length > 1 ? 's' : ''}` : 'Add photos or a video'}
        </button>
      </div>

      <SectionTitle right={active ? <span className="inline-flex items-center gap-1 text-xs text-ink-3"><Loader2 size={12} className="animate-spin" /> updating</span> : null}>Pages</SectionTitle>
      <ErrorNote error={pages.error} onRetry={pages.reload} />
      {pages.data && pages.data.length === 0 && !recentlySent && <Empty title="No pages marked yet">Captured pages appear here as they’re graded.</Empty>}
      {pages.data && pages.data.length === 0 && recentlySent && (
        <div className="card flex items-center gap-3 px-4 py-4 text-sm text-ink-2"><Loader2 size={16} className="animate-spin" /> Finding pages… (videos take a moment while SAM 3.1 tracks each page)</div>
      )}
      <div className="grid gap-2">
        {pages.data?.map((p) => <PageRow key={p.id} p={p} student={nameOf(p.student_id)} />)}
      </div>
    </div>
  )
}

function PageRow({ p, student }: { p: Page; student?: string }) {
  const score = p.result?.score
  const name = student ?? (p.result?.student_name ? `“${p.result.student_name}”` : null)
  const body = (
    <div className="card flex items-center gap-3 p-2.5 pr-3">
      <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-md border border-line bg-paper-2">
        {p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
        {p.status === 'grading' && <div className="shimmer absolute inset-0" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{name ?? <span className="text-ink-3">Unassigned</span>}</span>
          <StatusChip status={p.status} />
        </div>
        <div className="mt-0.5 truncate text-xs text-ink-3">{p.source?.replace(/^(photo|video):/, '')} · {timeAgo(p.created)}</div>
        {p.status === 'error' && <div className="truncate text-xs text-pen">{p.result?.error ?? 'Grading failed'}</div>}
      </div>
      {score && (
        <div className="shrink-0 text-right">
          <div className={`hand text-2xl font-bold leading-none ${score.correct === score.total ? 'text-leaf' : 'text-pen'}`}>{score.correct}/{score.total}</div>
          {!p.student_id && <Badge tone="amber" className="mt-1">assign</Badge>}
        </div>
      )}
      {p.status === 'done' && <ChevronRight size={16} className="shrink-0 text-ink-3" />}
    </div>
  )
  return p.status === 'done' ? <Link to={`/page/${p.id}`}>{body}</Link> : body
}
