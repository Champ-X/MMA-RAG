import { useCallback, useEffect, useRef, useState } from 'react'
import { piApi, PiApiError } from '@/services/piAgent'
import type { PiConfig } from '@/types/pi'

export function usePiWorkspace(enabled: boolean) {
  const [config, setConfig] = useState<PiConfig | null>(null)
  const [error, setError] = useState('')
  const [needsAuth, setNeedsAuth] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const request = useRef(0)
  const fail = useCallback((cause: unknown) => {
    const auth = cause instanceof PiApiError && cause.status === 401
    setConfig(null)
    setNeedsAuth(auth)
    setError(auth ? '当前浏览器尚未连接工作区，或连接已过期。' : cause instanceof Error ? cause.message : '工作区暂时无法连接，请重试。')
  }, [])
  useEffect(() => {
    if (!enabled) return
    const id = ++request.current
    setLoading(true)
    setError('')
    void piApi.config().then(value => {
      if (request.current === id) { setConfig(value); setNeedsAuth(false) }
    }).catch(cause => { if (request.current === id) fail(cause) })
      .finally(() => { if (request.current === id) setLoading(false) })
    return () => { request.current++ }
  }, [enabled, revision, fail])
  const connect = useCallback(async (token: string) => {
    const id = ++request.current
    const value = await piApi.connect(token)
    if (request.current === id) {
      setConfig(value); setError(''); setNeedsAuth(false); setLoading(false)
    }
  }, [])
  return { config, error, needsAuth, loading, connect, fail, retry: () => setRevision(value => value + 1) }
}
