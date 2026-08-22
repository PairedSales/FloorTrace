import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { markBuildHealthy } from './utils/staleBuild.js'

// Reaching this line means the entry chunk parsed and React is running, so
// whatever build we are on is serviceable: clear the stale-build guard and take
// the cache-busting marker back out of the address bar.
markBuildHealthy()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
