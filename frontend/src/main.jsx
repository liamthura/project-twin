import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Home from './Home'
import { isAppPath, legacyForward } from './lib/paths'
import './globals.css'

// A link from before the app moved to /app: send it on before anything renders.
const forward = legacyForward(window.location)

if (forward) {
  window.location.replace(forward)
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {isAppPath(window.location.pathname) ? <App /> : <Home />}
    </React.StrictMode>
  )
}
