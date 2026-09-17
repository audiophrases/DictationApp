import { useEffect, useRef, useState } from 'react';
import { Volume2, Play, Flag, Loader2 } from 'lucide-react';
import { SPEEDS } from '../lib/options';
import SentenceFeedback from '../components/SentenceFeedback';

function preventCheatingEvents(e) {
  e.preventDefault();
}

function DictationScreen({
  sentenceCount,
  currentIndex,
  studentInput,
  setStudentInput,
  onSubmit,
  onRepeat,
  onFinishEarly,
  replaysLeft, // null = unlimited
  isSpeaking,
  warnings,
  rate,
  onRateChange, // omitted in an assignment: the speed is baked into the audio
  heading = 'Dictation in Progress',
  error,
  // Per-sentence feedback. `feedback` is `{ grade }` for the sentence just
  // answered (grade null if it could not be marked), shown in place of the
  // answer box until `onContinue`; `marking` is the wait for an assignment's
  // marks to come back from the worker.
  feedback = null,
  onContinue,
  marking = false,
}) {
  const inputRef = useRef(null);
  const [confirmFinish, setConfirmFinish] = useState(false);

  // Refocus the answer box whenever a new sentence starts — including when it
  // comes back after a feedback panel, which took the focus for its button.
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [currentIndex, feedback]);

  // The finish-early confirmation resets itself if not acted on
  useEffect(() => {
    if (!confirmFinish) return;
    const timer = setTimeout(() => setConfirmFinish(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmFinish]);

  const canReplay = replaysLeft === null || replaysLeft > 0;

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat && studentInput.trim() && !marking) {
        onSubmit();
      }
    } else if (e.key === 'r' && e.altKey) {
      e.preventDefault();
      if (!e.repeat && canReplay) onRepeat();
    }
  };

  const progress = (currentIndex / sentenceCount) * 100;

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>{heading}</h1>
        <p>Sentence {currentIndex + 1} of {sentenceCount}</p>
      </div>

      <div className="progress-track" style={{ marginBottom: '1.5rem' }}>
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="glass-panel animate-fade-in">
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', justifyContent: 'center', alignItems: 'center' }}>
          <button
            className="btn-primary"
            onClick={onRepeat}
            disabled={!canReplay}
            title={canReplay ? 'Listen Again (Alt + R)' : 'No replays left for this sentence'}
          >
            <Volume2 size={20} className={isSpeaking ? 'speaking-pulse' : ''} />
            {isSpeaking ? 'Speaking…' : 'Listen Again'}
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>(Alt+R)</span>
          </button>
          {replaysLeft !== null && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {replaysLeft} replay{replaysLeft !== 1 ? 's' : ''} left
            </span>
          )}
          {onRateChange && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Speed
              <select
                value={rate}
                onChange={(e) => {
                  // Changing speed only affects future playback — replaying still
                  // goes through Listen Again so the replay limit stays honest.
                  onRateChange(parseFloat(e.target.value));
                  if (inputRef.current) inputRef.current.focus();
                }}
                title="Voice speed for the next playback"
                style={{ padding: '0.45rem 2.2rem 0.45rem 0.75rem', fontSize: '0.9rem' }}
              >
                {SPEEDS.map((s) => (
                  <option key={s.value} value={s.value}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && <div className="fetch-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {feedback ? (
          <SentenceFeedback
            grade={feedback.grade}
            onContinue={onContinue}
            isLast={currentIndex + 1 >= sentenceCount}
          />
        ) : (
        <textarea
          ref={inputRef}
          value={studentInput}
          onChange={(e) => setStudentInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={preventCheatingEvents}
          onCopy={preventCheatingEvents}
          onCut={preventCheatingEvents}
          onContextMenu={preventCheatingEvents}
          spellCheck="false"
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          placeholder="Type what you hear... (Press Enter to submit sentence)"
          autoFocus
          disabled={marking}
        />
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
          <div style={{ color: warnings > 0 ? 'var(--warning-color)' : 'var(--text-muted)', fontSize: '0.9rem' }}>
            {warnings > 0 ? `⚠️ Page left ${warnings} time(s)` : 'Anti-cheat is active'}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="btn-ghost"
              onClick={() => (confirmFinish ? onFinishEarly() : setConfirmFinish(true))}
              disabled={marking}
              title="End the session and grade what you have so far"
            >
              <Flag size={16} /> {confirmFinish ? 'Click again to confirm' : 'Finish early'}
            </button>
            {!feedback && (
              <button
                className="btn-primary"
                onClick={onSubmit}
                disabled={!studentInput.trim() || marking}
                title="Submit Sentence (Enter)"
              >
                {marking
                  ? <><Loader2 size={18} className="spin" /> Marking…</>
                  : <>Submit Sentence <Play size={18} /></>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DictationScreen;
