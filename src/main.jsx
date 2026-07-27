import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker (public/sw.js) so the app can be installed as a
// standalone app — the practical way onto a Chromebook shelf, since students
// there can't install anything else. Production only: in dev it would serve
// stale bundles back to us, and the file isn't part of the dev server anyway.
// BASE_URL, not '/sw.js': on GitHub Pages the app lives under /DictationApp/,
// and a worker registered at the domain root would be rejected (and would claim
// the wrong scope if it weren't).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Not fatal: without it the app simply runs as a normal web page.
    })
  })
}
