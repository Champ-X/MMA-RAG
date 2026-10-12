import { BrowserRouter as Router, Navigate, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from '@/hooks/useTheme'
import { AppLayout } from '@/components/layout/AppLayout'
import { lazy, Suspense } from 'react'
import { SetupGate } from '@/components/SetupGate'
import { consumeSetupToken } from '@/lib/setupSession'

consumeSetupToken()
const SetupPage = lazy(() => import('@/pages/SetupPage'))

function App() {
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
