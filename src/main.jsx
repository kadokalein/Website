import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startNativeApp } from './lib/nativeApp.js'

// iPhone app only (app links, keep-awake); does nothing on the website.
startNativeApp()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
