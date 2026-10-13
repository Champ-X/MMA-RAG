import { BrowserRouter as Router, Navigate, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from '@/hooks/useTheme'
import { AppLayout } from '@/components/layout/AppLayout'
import { lazy, Suspense, useEffect } from 'react'
import { SetupGate } from '@/components/SetupGate'
import { consumeSetupToken, getSetupToken } from '@/lib/setupSession'
import { piApi } from '@/services/piAgent'

consumeSetupToken()
const SetupPage = lazy(() => import('@/pages/SetupPage'))

function App() {
  useEffect(() => {
    // Establish the HttpOnly workspace session on authenticated CLI entry,
    // including /setup, so another tab can open the plain workspace URL.
    if (getSetupToken()) void piApi.config().catch(() => {})
  }, [])
  return (
    <ThemeProvider defaultTheme="light" storageKey="mmrag-ui-theme">
      <Router>
        <div className="min-h-screen bg-background">
          <SetupGate><Suspense fallback={<div className="p-8" role="status">正在打开配置…</div>}><Routes>
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/" element={<AppLayout />} />
            <Route path="/chat/:sessionId" element={<AppLayout />} />
            <Route path="/knowledge" element={<AppLayout />} />
            <Route path="/knowledge/:knowledgeBaseId" element={<AppLayout />} />
            <Route path="/architecture" element={<AppLayout />} />
            <Route path="/settings" element={<AppLayout />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes></Suspense></SetupGate>
          <Toaster />
        </div>
      </Router>
    </ThemeProvider>
  )
}

export default App
