import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { SignInGate } from './auth/SignInGate'
import ShareViewer from './share/ShareViewer'

// ?share=<token> → the anonymous read-only viewer (no auth, no editor)
const shareToken = new URLSearchParams(window.location.search).get('share')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shareToken ? (
      <ShareViewer token={shareToken} />
    ) : (
      <AuthProvider>
        <SignInGate>
          <App />
        </SignInGate>
      </AuthProvider>
    )}
  </StrictMode>,
)
