import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type Status } from './api'

interface Ctx {
  status: Status | null
  reachable: boolean
  refresh: () => Promise<void>
}

const StatusCtx = createContext<Ctx>({ status: null, reachable: true, refresh: async () => {} })

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [reachable, setReachable] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status())
      setReachable(true)
    } catch {
      setReachable(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 20000)
    return () => clearInterval(t)
  }, [refresh])

  return <StatusCtx.Provider value={{ status, reachable, refresh }}>{children}</StatusCtx.Provider>
}

export const useStatus = () => useContext(StatusCtx)
