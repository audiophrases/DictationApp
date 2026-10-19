import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Camera, Volume2 } from 'lucide-react';

export default function NotebookScreen({ heading = 'Notebook dictation', count, index, onMove, onRepeat, onFinish, isSpeaking, replaysLeft, error }) {
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
    <div className="app-header"><h1>{heading}</h1><p>Notebook mode · Segment {index + 1} of {count}</p></div>
    <div className="progress-track" style={{ marginBottom: '1.5rem' }}><div className="progress-fill" style={{ width: `${((index + 1) / count) * 100}%` }} /></div>
    <div className="glass-panel animate-fade-in notebook-panel">
      <BookOpen size={44} aria-hidden="true" />
      <h2>Listen and write in your notebook</h2>
      <p className="field-hint">Write by hand. You will photograph your work when you finish. Corrections come from your teacher later.</p>
      <p aria-live="polite">{isSpeaking ? 'Playing segment…' : `Segment ${index + 1} ready`}</p>
      {error && <p className="fetch-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={onRepeat} disabled={!canReplay}><Volume2 size={20} /> Repeat segment <kbd>Space</kbd></button>
      {replaysLeft !== null && <p className="field-hint">{replaysLeft} plays remaining for this segment</p>}
      <div className="notebook-controls">
        <button className="btn-ghost" onClick={() => onMove(index - 1)} disabled={index === 0}><ArrowLeft size={18} /> Previous</button>
        <button className="btn-primary" onClick={() => index + 1 < count ? onMove(index + 1) : onFinish()}>
          {index + 1 < count ? <><ArrowRight size={18} /> Next segment</> : <><Camera size={18} /> Finish writing</>} <kbd>Enter</kbd>
        </button>
      </div>
      <p className="field-hint"><kbd>←</kbd> / <kbd>→</kbd> move between segments · <kbd>Space</kbd> repeat · <kbd>Enter</kbd> next</p>
      {index + 1 < count && <button className="btn-ghost btn-small" onClick={onFinish}>Finish writing early</button>}
    </div>
  </div>;
}
