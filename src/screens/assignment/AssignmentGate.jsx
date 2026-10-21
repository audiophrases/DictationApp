import { useEffect, useRef, useState } from 'react';
import { Headphones, Loader2, LogIn, RefreshCw } from 'lucide-react';
import { getAssignmentMeta, recallAttempt } from '../../lib/assignmentApi';
import { clearStudentSession, getStudentConfig, readStudentSession, signInWithGoogle } from '../../lib/studentAuth';
import GoogleSignIn from '../../components/GoogleSignIn';
import { dictationUnit } from '../../lib/delivery';

function formatDue(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function AssignmentGate({ code, onStart, starting, startError, onIdentityChange }) {
  const [meta, setMeta] = useState(null);
  const unit = dictationUnit(meta || {});
  const [loadError, setLoadError] = useState('');
  const [config, setConfig] = useState(null);
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const signingInRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [, refreshIdentity] = useState(0);
  const session = readStudentSession();
  const savedAttempt = recallAttempt(code);
  const returningNotebook = meta?.mode === 'notebook' && session
    && savedAttempt?.email?.toLowerCase() === session.student.email.toLowerCase();
  const closed = meta && meta.status !== 'active';
  const overdue = meta?.dueAt && Date.now() > meta.dueAt;
  const canOpen = meta?.mode === 'notebook' || (!closed && !overdue);
  const needsSignIn = !!meta && canOpen && !session;

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    getAssignmentMeta(code).then(
      (data) => { if (!cancelled) setMeta(data.meta); },
      (err) => { if (!cancelled) setLoadError(err.message); }
    );
    return () => { cancelled = true; };
  }, [code, reloadKey]);

  useEffect(() => {
    if (!needsSignIn) return;
    let cancelled = false;
    setConfig(null);
    setAuthError('');
    getStudentConfig().then(
      (data) => { if (!cancelled) setConfig(data); },
      (err) => { if (!cancelled) setAuthError(err.message); }
    );
    return () => { cancelled = true; };
  }, [needsSignIn, reloadKey]);

  useEffect(() => {
    const refresh = () => refreshIdentity((n) => n + 1);
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  async function handleCredential(credential) {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setSigningIn(true);
    setAuthError('');
    try {
      await signInWithGoogle(credential);
      onIdentityChange?.();
      refreshIdentity((n) => n + 1);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      signingInRef.current = false;
      setSigningIn(false);
    }
  }

  if (loadError) {
    return (
      <div className="app-container" style={{ padding: '2rem', maxWidth: '460px', margin: '0 auto' }}>
        <div className="glass-panel animate-fade-in" style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.3rem' }}>Can't open this assignment</h2>
          <p className="fetch-error" role="alert">{loadError}</p>
          <button className="btn-primary" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw size={18} /> Try again
          </button>
        </div>
      </div>
    );
  }
  if (!meta) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}><Loader2 size={26} className="spin" aria-label="Loading assignment" /></div>;
  }

  const saved = recallAttempt(code);
  const resume = session && saved?.email?.toLowerCase() === session.student.email.toLowerCase();
  const due = formatDue(meta.dueAt);
  const domain = config?.allowedDomains?.find((entry) => !entry.includes('@'));

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '460px', width: '100%', margin: '0 auto' }}>
      <div className="app-header">
        <h1>{meta.title}</h1>
        <p>{meta.className ? `${meta.className} · ` : ''}Dictation</p>
      </div>
      <form className="glass-panel animate-fade-in" onSubmit={(event) => {
        event.preventDefault();
        if (!starting && session && canOpen) onStart();
      }}>
        <div className="passage-cover" style={{ minHeight: 'auto', marginBottom: '1.25rem' }}>
          <Headphones size={20} className="passage-cover-icon" />
          <div>
            <div className="passage-cover-title">{meta.sentenceCount} {unit}{meta.sentenceCount !== 1 ? 's' : ''} {meta.mode === 'notebook' ? 'to write by hand' : 'to type'}</div>
            <div className="passage-cover-sub">
              {meta.maxListens === 0
                ? `You can replay each ${unit} as often as you like.`
                : `${meta.maxListens} replay${meta.maxListens !== 1 ? 's' : ''} per ${unit}.`}
              {due ? ` Due ${due}.` : ''}
            </div>
          </div>
        </div>
        {meta.mode === 'notebook' && <p className="field-hint" style={{ marginBottom: '1rem' }}>Write in your notebook. Your teacher releases corrections later. Reopen this link to check them.</p>}
        {meta.allowSlowdown && <p className="field-hint" style={{ marginBottom: '1rem' }}>Your teacher allows slower playback. Use the Speed dropdown to choose Relaxed or Slow.</p>}
        {!canOpen && closed ? <p className="empty-note">This assignment is closed. Ask your teacher to reopen it.</p>
          : !canOpen && overdue ? <p className="empty-note">The due date has passed.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {session ? <>
              <div style={{ overflowWrap: 'anywhere' }}>
                <p>Signed in as <strong>{session.student.displayName || session.student.email}</strong></p>
                <p className="field-hint">{session.student.email}{session.student.className ? ` · ${session.student.className}` : ''}</p>
                <button type="button" className="btn-ghost btn-small" disabled={starting} onClick={() => {
                  clearStudentSession();
                  setAuthError('');
                  onIdentityChange?.();
                  refreshIdentity((n) => n + 1);
                }}>Not you? Switch account</button>
              </div>
              {resume && <p className="field-hint">{returningNotebook ? 'Reopen your work or check for released corrections.' : 'You have an unfinished attempt. Carry on where you stopped.'}</p>}
              <button className="btn-primary" type="submit" disabled={starting} style={{ padding: '0.9rem' }}>
                {starting ? <><Loader2 size={18} className="spin" /> Starting…</>
                  : <><LogIn size={18} /> {returningNotebook ? 'Open my work / corrections' : resume ? 'Carry on' : 'Start'}</>}
              </button>
            </> : <>
              <p className="field-hint">{domain ? `Sign in with your ${domain} school account.` : 'Sign in with your Google account.'}</p>
              {signingIn ? <p role="status"><Loader2 size={18} className="spin" /> Signing in…</p>
                : config?.loginEnabled && config.googleClientId
                  ? <GoogleSignIn clientId={config.googleClientId} onCredential={handleCredential} />
                  : config
                    ? <p className="fetch-error">Student sign-in is not set up yet. Ask your teacher.</p>
                    : !authError && <p role="status">Loading sign-in…</p>}
              {authError && <>
                <p className="fetch-error" role="alert">{authError}</p>
                {!config && <button type="button" className="btn-ghost" onClick={() => setReloadKey((n) => n + 1)}>Try again</button>}
              </>}
            </>}
            {startError && <p className="fetch-error" role="alert">{startError}</p>}
          </div>}
      </form>
    </div>
  );
}

export default AssignmentGate;
