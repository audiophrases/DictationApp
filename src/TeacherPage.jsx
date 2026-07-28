import { useEffect, useState } from 'react';
import TeacherApp from './TeacherApp';
import ThemeToggle from './components/ThemeToggle';
import { appRoot, takeAssignmentDraft } from './lib/appLinks';
import './index.css';

const THEME_KEY = 'dictation.theme';

function loadTheme() {
  // Must match the inline anti-flash script in create/index.html.
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

/**
 * The whole of create/ — the teacher's page.
 *
 * A separate page rather than a screen inside the app, because it shares almost
 * nothing with what a student does: different data, different requests, a
 * password in front of all of it, and no reason to ship any of it to a
 * Chromebook that will only ever type dictations.
 */
function TeacherPage() {
  const [theme, setTheme] = useState(loadTheme);
  // Read once on mount: arriving from "Set as an assignment…" carries a passage
  // over, and taking it here clears it so a later visit opens the dashboard.
  const [draft] = useState(takeAssignmentDraft);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <>
      <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
      <TeacherApp
        createFrom={draft}
        onExit={() => { window.location.href = appRoot(); }}
      />
    </>
  );
}

export default TeacherPage;
