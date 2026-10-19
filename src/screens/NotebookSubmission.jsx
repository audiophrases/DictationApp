import { useEffect, useState } from 'react';
import { Camera, CheckCircle, ExternalLink, RefreshCw } from 'lucide-react';

export function NotebookSubmission({ classroomUrl, onSubmit, onBack }) {
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  return <div className="app-container notebook-container">
    <div className="app-header"><h1>Photograph your notebook</h1><p>Submit your work before looking at corrections.</p></div>
    <div className="glass-panel notebook-panel">
      <Camera size={36} aria-hidden="true" />
      <p>Take a clear photo of every page. Attach your photos to the assignment in Google Classroom and press <strong>Turn in</strong>.</p>
      <label className="field-label" htmlFor="notebook-photo">Take or choose a photo (optional on this device)</label>
      <input id="notebook-photo" type="file" accept="image/*" capture="environment" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { setError('Choose an image of your notebook.'); return; }
        setPhoto(file); setError('');
      }} />
      {photo && preview && <>
        <img className="notebook-photo" src={preview} alt="Your notebook page" />
        <a className="btn-ghost" href={preview} download={photo.name}>Save photo to attach</a>
      </>}
      <p className="field-hint">You can take the photos on your phone and submit them there. Choosing a photo here does not upload it to Classroom.</p>
      <a className="btn-primary" href={classroomUrl || 'https://classroom.google.com/'} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} /> Open Google Classroom</a>
      <label className="notebook-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have attached my photos and turned in the assignment in Classroom.</label>
      {error && <p className="fetch-error" role="alert">{error}</p>}
      <button className="btn-primary" disabled={!confirmed} onClick={onSubmit}><CheckCircle size={18} /> Confirm Classroom submission</button>
      <button className="btn-ghost" onClick={onBack}>Back to listening</button>
    </div>
  </div>;
}

export function NotebookCorrections({ outcome, onRefresh, onNewPassage }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setBusy(true); setError('');
    try { await onRefresh(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="app-container notebook-container">
    <div className="app-header"><h1>{outcome.correctionsReleased ? 'Correct your notebook' : 'Submission confirmed'}</h1></div>
    <div className="glass-panel notebook-panel">
      {outcome.correctionsReleased ? <>
        <p>Compare the passage with your notebook and make your corrections by hand.</p>
        <div className="notebook-corrections">{outcome.corrections}</div>
      </> : <>
        <CheckCircle size={40} color="var(--success-color)" />
        <p>You confirmed that your photos are in Classroom. Your teacher will release the passage for you to correct your notebook.</p>
        {onRefresh && <button className="btn-primary" disabled={busy} onClick={refresh}><RefreshCw size={18} className={busy ? 'spin' : ''} /> Check for corrections</button>}
        <p className="field-hint">{onRefresh ? 'You can reopen this assignment later with the same school account.' : 'Your teacher can share the correction passage with the class.'}</p>
      </>}
      {error && <p className="fetch-error" role="alert">{error}</p>}
      {onNewPassage && <button className="btn-ghost" onClick={onNewPassage}>New passage</button>}
    </div>
  </div>;
}
