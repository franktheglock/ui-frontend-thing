import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { LanUnlockGate } from './components/LanUnlockGate'
import { installApiAuthFetch } from './lib/apiAuth'
import './styles/index.css'

installApiAuthFetch()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LanUnlockGate>
        <App />
      </LanUnlockGate>
    </BrowserRouter>
  </React.StrictMode>,
)
