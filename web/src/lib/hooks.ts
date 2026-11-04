import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  reload: () => Promise<void>
  setData: (d: T) => void
}

/** Fetch on mount / when deps change. `silent` reloads keep showing old data. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      const d = await fnRef.current()
      if (alive.current) {
        setData(d)
        setError(undefined)
      }
    } catch (e) {
      if (alive.current) setError(e as Error)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    setLoading(true)
    setData(undefined)
    void reload()
    return () => {
      alive.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload, setData }
}

/** Run `fn` every `ms` while `active`. */
export function useInterval(fn: () => void, ms: number, active: boolean) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => ref.current(), ms)
    return () => clearInterval(t)
  }, [ms, active])
}

/** Long-running action (agent calls). Tracks elapsed seconds for progress UIs. */
export function useAction<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>()
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) return
    const start = Date.now()
    setElapsed(0)
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(t)
  }, [running])
  const run = useCallback(
    async (...args: A): Promise<T | undefined> => {
      setRunning(true)
      setError(undefined)
      try {
        return await fn(...args)
      } catch (e) {
        setError((e as Error).message || 'Something went wrong')
        return undefined
      } finally {
        setRunning(false)
      }
    },
    [fn],
  )
  return { run, running, error, elapsed, setError }
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return undefined
}

export function extFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

export interface Recorder {
  supported: boolean
  recording: boolean
  seconds: number
  level: number // 0..1
  blob: Blob | null
  url: string | null
  error: string | null
  start: () => Promise<void>
  stop: () => void
  reset: () => void
}

/** MediaRecorder wrapper with timer and live input level meter. */
export function useRecorder(): Recorder {
  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const raf = useRef<number>(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current)
    if (timer.current) clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    void ctx.current?.close().catch(() => {})
    ctx.current = null
    setLevel(0)
  }, [])

  useEffect(() => () => cleanup(), [cleanup])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const start = useCallback(async () => {
    setError(null)
    setBlob(null)
    setUrl(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } })
      stream.current = s
      const mime = pickMime()
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
      const chunks: BlobPart[] = []
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      r.onstop = () => {
        const b = new Blob(chunks, { type: r.mimeType || mime || 'audio/webm' })
        setBlob(b)
        setUrl(URL.createObjectURL(b))
        setRecording(false)
        cleanup()
      }
      rec.current = r
      // level meter
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new AC()
      ctx.current = ac
      const src = ac.createMediaStreamSource(s)
      const an = ac.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      const buf = new Uint8Array(an.fftSize)
      const tick = () => {
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2))
        raf.current = requestAnimationFrame(tick)
      }
      tick()
      const t0 = Date.now()
      setSeconds(0)
      timer.current = setInterval(() => setSeconds((Date.now() - t0) / 1000), 200)
      r.start(250)
      setRecording(true)
    } catch (e) {
      cleanup()
      setError((e as Error).name === 'NotAllowedError' ? 'Microphone permission was denied.' : (e as Error).message || 'Could not start recording')
    }
  }, [cleanup])

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
  }, [])

  const reset = useCallback(() => {
    stop()
    setBlob(null)
    setUrl(null)
    setSeconds(0)
  }, [stop])

  return { supported, recording, seconds, level, blob, url, error, start, stop, reset }
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}
