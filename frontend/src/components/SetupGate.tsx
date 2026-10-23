import { translate as t, useTranslation } from '@/i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { SetupError, setupApi, type SetupStatus } from '@/services/setup'
import { SetupStatusContext } from '@/hooks/useSetupStatus'

export function SetupGate({ children }: { children: ReactNode }) {
  useTranslation()
  const location = useLocation()
  const isSetup = location.pathname === '/setup'
  const [state, setState] = useState<'loading' | 'setup' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  useEffect(() => {
    if (isSetup) return
    let active = true
    setState('loading')
    setupApi.status().then(status => {
      if (active) {
        setStatus(status)
        setState(status.managed && status.setup_required ? 'setup' : 'ready')
      }
    }).catch(error => {
      if (active) {
        setStatus(null)
        setState(error instanceof SetupError && error.status === 404 ? 'ready' : 'error')
      }
    })
    return () => { active = false }
  }, [isSetup, attempt])
  if (isSetup || state === 'ready') return <SetupStatusContext.Provider value={status}>{children}</SetupStatusContext.Provider>
  if (state === 'setup') return <Navigate to="/setup" replace />
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
    <p role="status">{state === 'error' ? t("暂时无法连接 Tessmora。确认服务已启动后重试。") : t("正在连接 Tessmora…")}</p>
    {state === 'error' && <button className="rounded-lg border px-6 py-3" onClick={() => setAttempt(value => value + 1)}>{t("重新连接")}</button>}
  </main>
}
