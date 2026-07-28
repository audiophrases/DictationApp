import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import TeacherPage from './TeacherPage.jsx'

// Entry point for create/index.html — the teacher's page. Deliberately does not
// register the service worker: that worker exists to make the student app
// installable and load offline, neither of which applies here, and registering
// it from a subdirectory would claim a scope that doesn't match the app root.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TeacherPage />
  </StrictMode>,
)
