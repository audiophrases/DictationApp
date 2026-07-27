import { useState } from 'react';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { verifyTeacherPassword } from '../../lib/assignmentApi';
import { setTeacherPassword } from '../../lib/teacherAuth';

function TeacherLogin({ onSignedIn, onCancel }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await verifyTeacherPassword(password);
      // Only kept once the worker has agreed it's right, so a typo can't be
      // silently attached to every later request.
      setTeacherPassword(password);
      onSignedIn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '420px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>Assignments</h1>
      </div>
      <form className="glass-panel animate-fade-in" onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', color: 'var(--text-muted)' }}>
            <Lock size={18} />
            <span style={{ fontSize: '0.9rem' }}>Teacher password</span>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
          {error && <div className="fetch-error">{error}</div>}
          <button className="btn-primary" type="submit" disabled={busy || !password.trim()}>
            {busy ? <><Loader2 size={18} className="spin" /> Checking…</> : 'Continue'}
          </button>
          <button className="btn-ghost" type="button" onClick={onCancel}>
            <ArrowLeft size={16} /> Back to practice
          </button>
          <p className="field-hint" style={{ textAlign: 'center' }}>
            Not stored anywhere — you'll be asked again after a refresh.
          </p>
        </div>
      </form>
    </div>
  );
}

export default TeacherLogin;
