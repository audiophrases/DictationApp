import { useEffect, useState } from 'react';
import PracticeApp from './PracticeApp';
import TeacherApp from './TeacherApp';
import AssignmentApp from './AssignmentApp';
import ThemeToggle from './components/ThemeToggle';
import './index.css';

const THEME_KEY = 'dictation.theme';

function loadTheme() {
  // Must match the inline anti-flash script in index.html: light unless a
  // saved preference explicitly says otherwise.
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

/**
 * Which of the three areas the app opens in, from the query string:
 *
 *   ?a=CODE    a student doing that assignment
 *   ?teacher   the teacher's assignment list
 *   (nothing)  free practice
 *
 * Query parameters rather than paths, deliberately: the app is served from a
 * repo root on Render, from /DictationApp/ on GitHub Pages, and from
 * 127.0.0.1 in the portable pack. A query string means the same link shape
 * works in all three with no routing library and no server rewrites.
 */
function readArea() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('a') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (code) return { name: 'assignment', code };
  if (params.has('teacher')) return { name: 'teacher' };
  return { name: 'practice' };
}

function App() {
  const [theme, setTheme] = useState(loadTheme);
  const [area, setArea] = useState(readArea);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  let screen;
  if (area.name === 'assignment') {
    screen = <AssignmentApp code={area.code} />;
  } else if (area.name === 'teacher') {
    screen = (
      <TeacherApp
        createFrom={area.createFrom}
        onExit={() => setArea({ name: 'practice' })}
      />
    );
  } else {
    screen = (
      <PracticeApp
        onOpenTeacher={(createFrom) => setArea({ name: 'teacher', createFrom })}
      />
    );
  }

  return (
    <>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
      {screen}
    </>
  );
}

export default App;
