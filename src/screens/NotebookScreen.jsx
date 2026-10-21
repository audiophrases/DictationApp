import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle, Loader2, Volume2 } from 'lucide-react';
import { SPEEDS } from '../lib/options';

// Assignments provide `onRateChange` only when the teacher allows students
// to slow the recording. Practice can record again at another voice speed.
export default function NotebookScreen({ heading = 'Notebook dictation', unit = 'segment', count, index, onMove, onRepeat, onFinish, isSpeaking, loading = false, replaysLeft, error, rate, onRateChange }) {
  const canReplay = replaysLeft === null || replaysLeft > 0;
  useEffect(() => {
    const onKey = (event) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || event.target.closest('input, textarea, select, a, [contenteditable="true"]')) return;
      if (![' ', 'Enter', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === ' ' && canReplay) onRepeat();
      if (event.key === 'ArrowLeft' && index > 0) onMove(index - 1);
      if (event.key === 'ArrowRight' && index + 1 < count) onMove(index + 1);
      if (event.key === 'Enter') {
        if (index + 1 < count) onMove(index + 1);
        else onFinish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canReplay, count, index, onFinish, onMove, onRepeat]);

  return <div className="app-container notebook-container">
    <div className="app-header"><h1>{heading}</h1><p>Notebook mode · {unit === 'segment' ? 'Segment' : 'Sentence'} {index + 1} of {count}</p></div>
    <div className="progress-track" style={{ marginBottom: '1.5rem' }}><div className="progress-fill" style={{ width: `${((index + 1) / count) * 100}%` }} /></div>
    <div className="glass-panel animate-fade-in notebook-panel">
      <BookOpen size={44} aria-hidden="true" />
      <h2>Listen and write in your notebook</h2>
      <p className="field-hint">Listen to each {unit} and write by hand.</p>
      <p className="field-hint">Sentence endings are spoken aloud: for example, “period” means write a full stop, not the word “period”.</p>
      <p aria-live="polite">{loading
        ? <><Loader2 size={16} className="spin" style={{ verticalAlign: 'middle' }} /> Recording at this speed…</>
        : isSpeaking ? `Playing ${unit}…` : `${unit === 'segment' ? 'Segment' : 'Sentence'} ${index + 1} ready`}</p>
      {error && <p className="fetch-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={onRepeat} disabled={!canReplay}><Volume2 size={20} /> Repeat {unit} <kbd>Space</kbd></button>
      {replaysLeft !== null && <p className="field-hint">{replaysLeft} plays remaining for this {unit}</p>}
      {onRateChange && (
        <label className="notebook-speed">
          Speed
          <select
            value={rate}
            onChange={(e) => { onRateChange(parseFloat(e.target.value)); e.target.blur(); }}
            title="Voice speed for the next playback"
          >
            {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.name}</option>)}
          </select>
        </label>
      )}
      <div className="notebook-controls">
        <button className="btn-ghost" onClick={() => onMove(index - 1)} disabled={index === 0}><ArrowLeft size={18} /> Previous</button>
        <button className="btn-primary" onClick={() => index + 1 < count ? onMove(index + 1) : onFinish()}>
          {index + 1 < count ? <><ArrowRight size={18} /> Next {unit}</> : <><CheckCircle size={18} /> Finish writing</>} <kbd>Enter</kbd>
        </button>
      </div>
      <p className="field-hint"><kbd>←</kbd> / <kbd>→</kbd> move between {unit}s · <kbd>Space</kbd> repeat · <kbd>Enter</kbd> next</p>
      {index + 1 < count && <button className="btn-ghost btn-small" onClick={onFinish}>Finish writing early</button>}
    </div>
  </div>;
}
