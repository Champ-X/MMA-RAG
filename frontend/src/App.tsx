import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from '@/hooks/useTheme'
import { AppLayout } from '@/components/layout/AppLayout'
import ChatInterface from '@/components/chat/ChatInterface'
import KnowledgeList from '@/components/knowledge/KnowledgeList'
import { SettingsPage } from '@/pages/SettingsPage'

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="mmrag-ui-theme">
      <Router>
        <div className="min-h-screen bg-background">
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<ChatInterface />} />
              <Route path="/knowledge" element={<KnowledgeList />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
          <Toaster />
        </div>
      </Router>
    </ThemeProvider>
  )
}

export default App
