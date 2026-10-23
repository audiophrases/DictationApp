import { useState } from 'react';
import { CheckCircle, RefreshCw } from 'lucide-react';

export default function NotebookCompletion({ outcome, onRefresh, onNewPassage, actions }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setBusy(true);
    setError('');
    try { await onRefresh(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="app-container notebook-container">
    <div className="app-header"><h1>{outcome.correctionsReleased ? 'Correct your notebook' : 'Dictation complete'}</h1></div>
    <div className="glass-panel notebook-panel">
      {outcome.correctionsReleased ? <>
        <p>Compare the passage with your notebook and make your corrections by hand.</p>
        <div className="notebook-corrections">{outcome.corrections}</div>
      </> : <>
        <CheckCircle size={40} color="var(--success-color)" />
        {onRefresh && <>
          <p>Your teacher will release the passage for you to correct your notebook.</p>
          <button className="btn-primary" disabled={busy} onClick={refresh}>
            <RefreshCw size={18} className={busy ? 'spin' : ''} /> Check for corrections
          </button>
          <p className="field-hint">You can reopen this assignment later with the same school account.</p>
        </>}
      </>}
      {actions}
      {error && <p className="fetch-error" role="alert">{error}</p>}
      {onNewPassage && <button className="btn-ghost" onClick={onNewPassage}>New passage</button>}
    </div>
  </div>;
}
