import { useEffect, useState } from 'react';
import PracticeApp from './PracticeApp';
import AssignmentApp from './AssignmentApp';
import ThemeToggle from './components/ThemeToggle';
import { createPageUrl, stashAssignmentDraft } from './lib/appLinks';
import './index.css';

const THEME_KEY = 'dictation.theme';

function loadTheme() {
  // Must match the inline anti-flash script in index.html: light unless a
  // saved preference explicitly says otherwise.
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

/**
 * What this page opens as:
 *
 *   ?a=CODE    a student doing that assignment
 *   (nothing)  free practice
 *
 * The teacher's side is not here at all — it is its own page at create/, the
 * same shape pinplay uses. A query parameter still identifies an assignment,
 * deliberately: that link has to survive being served from a repo root on
 * Render, from /DictationApp/ on GitHub Pages, and from 127.0.0.1 in the
 * portable pack, and a query string needs no routing library and no server
 * rewrites to do that.
 */
function readArea() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('a') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (code) return { name: 'assignment', code };
  return { name: 'practice' };
}

function App() {
  const [theme, setTheme] = useState(loadTheme);
  const [area] = useState(readArea);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // ?teacher was where the teacher's screens used to live. Anyone still holding
  // that link — a bookmark, a note to self — lands on the page that replaced it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('teacher')) {
      window.location.replace(createPageUrl());
    }
  }, []);

  const openTeacherPage = (draft) => {
    stashAssignmentDraft(draft);
    window.location.href = createPageUrl();
  };

  return (
    <>
      <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
      {area.name === 'assignment'
        ? <AssignmentApp code={area.code} />
        : <PracticeApp onOpenTeacher={openTeacherPage} />}
    </>
  );
}

export default App;
