import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from '@/hooks/useTheme'
import { AppLayout } from '@/components/layout/AppLayout'

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="mmrag-ui-theme">
      <Router>
        <div className="min-h-screen bg-background">
          <Routes>
            <Route path="*" element={<AppLayout />} />
          </Routes>
          <Toaster />
        </div>
      </Router>
    </ThemeProvider>
  )
}

export default App
