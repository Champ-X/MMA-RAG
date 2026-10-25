import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './components/chat/decisionRecord.css'
import './components/chat/videoEvidenceCarousel.css'
import './components/chat/mediaEvidenceCard.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
