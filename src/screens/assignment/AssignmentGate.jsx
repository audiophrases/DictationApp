import { useEffect, useState } from 'react';
import { Headphones, Loader2, LogIn, RefreshCw } from 'lucide-react';
import { getAssignmentMeta, recallAttempt } from '../../lib/assignmentApi';

function formatDue(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

/**
 * What a student sees when they open an assignment link: what it is, how long
 * it is, and a place to sign in. Never the text — the worker doesn't send it,
 * and won't until the attempt is submitted.
 */
function AssignmentGate({ code, onStart, starting, startError }) {
  const [meta, setMeta] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [username, setUsername] = useState(() => recallAttempt(code)?.username || '');
  const [password, setPassword] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    getAssignmentMeta(code).then(
      (data) => { if (!cancelled) setMeta(data.meta); },
      (err) => { if (!cancelled) setLoadError(err.message); }
    );
    return () => { cancelled = true; };
  }, [code, reloadKey]);

  if (loadError) {
    return (
      <div className="app-container" style={{ padding: '2rem', maxWidth: '460px', margin: '0 auto' }}>
        <div className="glass-panel animate-fade-in" style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.3rem' }}>Can't open this assignment</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem' }}>{loadError}</p>
          <button
            className="btn-primary"
            style={{ marginTop: '1.25rem' }}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw size={18} /> Try again
          </button>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="app-container" style={{ padding: '2rem', textAlign: 'center' }}>
        <Loader2 size={26} className="spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  const closed = meta.status !== 'active';
  const overdue = meta.dueAt && Date.now() > meta.dueAt;
  const due = formatDue(meta.dueAt);
  const resume = recallAttempt(code);

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '460px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>{meta.title}</h1>
        <p>{meta.className ? `${meta.className} · ` : ''}Dictation</p>
      </div>

      <form
        className="glass-panel animate-fade-in"
        onSubmit={(e) => {
          e.preventDefault();
          if (!starting) onStart(username.trim(), password);
        }}
      >
        <div className="passage-cover" style={{ minHeight: 'auto', marginBottom: '1.25rem' }}>
          <Headphones size={20} className="passage-cover-icon" />
          <div>
            <div className="passage-cover-title">
              {meta.sentenceCount} sentence{meta.sentenceCount !== 1 ? 's' : ''} to type
            </div>
            <div className="passage-cover-sub">
              {meta.maxListens === 0
                ? 'You can replay each sentence as often as you like.'
                : `${meta.maxListens} replay${meta.maxListens !== 1 ? 's' : ''} per sentence.`}
              {due ? ` Due ${due}.` : ''}
            </div>
          </div>
        </div>

        {closed ? (
          <p className="empty-note" style={{ padding: '0.5rem 0' }}>
            This assignment is closed. Ask your teacher to reopen it.
          </p>
        ) : overdue ? (
          <p className="empty-note" style={{ padding: '0.5rem 0' }}>
            The due date has passed.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {resume && (
              <p className="field-hint" style={{ marginTop: 0 }}>
                You have an unfinished attempt. Sign in and you'll carry on where you stopped.
              </p>
            )}
            <div>
              <label className="field-label">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                autoFocus={!username}
              />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus={!!username}
              />
            </div>

            {startError && <div className="fetch-error">{startError}</div>}

            <button
              className="btn-primary"
              type="submit"
              style={{ padding: '0.9rem' }}
              disabled={starting || !username.trim() || !password}
            >
              {starting
                ? <><Loader2 size={18} className="spin" /> Signing in…</>
                : <><LogIn size={18} /> {resume ? 'Carry on' : 'Start'}</>}
            </button>
            <p className="field-hint" style={{ textAlign: 'center' }}>
              The same username and password you use for PinPlay.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}

export default AssignmentGate;
