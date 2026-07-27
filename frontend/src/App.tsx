import { BrowserRouter as Router, Navigate, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from '@/hooks/useTheme'
import { AppLayout } from '@/components/layout/AppLayout'

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="mmrag-ui-theme">
      <Router>
        <div className="min-h-screen bg-background">
          <Routes>
            <Route path="/" element={<AppLayout />} />
            <Route path="/chat/:sessionId" element={<AppLayout />} />
            <Route path="/knowledge" element={<AppLayout />} />
            <Route path="/knowledge/:knowledgeBaseId" element={<AppLayout />} />
            <Route path="/architecture" element={<AppLayout />} />
            <Route path="/settings" element={<AppLayout />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster />
        </div>
      </Router>
    </ThemeProvider>
  )
}

export default App
