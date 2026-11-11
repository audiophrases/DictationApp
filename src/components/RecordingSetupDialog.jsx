import { useEffect, useMemo, useRef, useState } from 'react';
import { DICTATION_LEVELS } from '../lib/punctuationPolicy';

// Keyboard-first setup for a voice-actor recording session, after PinPlay's
// assignment setup: step cards chosen with ← →, Enter continues, the last
// step creates. Everything the actors will say is decided here, before any
// audio exists: which punctuation they read aloud (and so which punctuation
// can be marked), who reads, and the session's name.
const STEPS = ['Punctuation', 'Actors', 'Review'];

function Choices({ group, options, value, onChange, labelledBy }) {
  const refs = useRef([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return <div className="setup-choices" role="radiogroup" aria-labelledby={labelledBy} data-choice-group={group}>
    {options.map((option, i) => <button key={option.value} type="button" role="radio" className="setup-choice"
      aria-checked={option.value === value} tabIndex={i === index ? 0 : -1} ref={(el) => { refs.current[i] = el; }}
      onClick={() => onChange(option.value)}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + options.length) % options.length;
        onChange(options[next].value);
        refs.current[next]?.focus();
      }}>
      {option.icon && <span className="setup-choice-icon" aria-hidden="true">{option.icon}</span>}
      <strong>{option.name}</strong>
      {option.description && <span>{option.description}</span>}
      <span className="setup-tick" aria-hidden="true">✓</span>
    </button>)}
  </div>;
}

export default function RecordingSetupDialog({ plan, title, initialLevel, scriptFor, heardFor, onCreate, onClose, busy, error, createsAssignment = true }) {
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState(initialLevel);
  const [reader, setReader] = useState('one'); // one | several
  const [name, setName] = useState('Narrator');
  const [speakers, setSpeakers] = useState(() => plan.map(() => 'Narrator'));
  const [sessionTitle, setSessionTitle] = useState(title || 'Dictation recording');
  const dialog = useRef(null);
  const content = useRef(null);
  const primary = useRef(null);
  useEffect(() => { const el = dialog.current; if (el && !el.open) el.showModal(); }, []);
  const script = useMemo(() => scriptFor(level), [scriptFor, level]);
  // Focus the step's first control when the step changes.
  useEffect(() => {
    // The chosen card first (a selector list would match in document order).
    const first = content.current?.querySelector('[role="radio"][tabindex="0"]')
      || content.current?.querySelector('input, button') || primary.current;
    first?.focus();
  }, [step]);
  const names = useMemo(() => (reader === 'one' ? plan.map(() => name.trim() || 'Narrator') : speakers.map((s) => s.trim() || 'Narrator')), [reader, name, speakers, plan]);
  const last = step === STEPS.length - 1;

  function advance() {
    if (busy) return;
    if (!last) { setStep(step + 1); return; }
    onCreate({ level, speakers: names, title: sessionTitle.trim() || 'Dictation recording' });
  }
  function keys(e) {
    if (e.key === 'Escape') { if (busy) e.preventDefault(); return; }
    if (e.key === 'Enter' && !e.repeat && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); advance(); }
    if (e.key === 'Enter' && e.target.getAttribute('role') === 'radio') { e.preventDefault(); advance(); }
  }

  return <dialog ref={dialog} className="setup-dialog" aria-labelledby="setup-title" onKeyDown={keys}
    onClose={() => { if (!busy) onClose(); }} onCancel={(e) => { if (busy) e.preventDefault(); }}>
    <header className="setup-head">
      <div>
        <p className="setup-eyebrow">VOICE ACTORS</p>
        <h2 id="setup-title">{title || 'Dictation'}</h2>
        <p className="field-hint">{plan.length} sentence{plan.length === 1 ? '' : 's'} to record</p>
      </div>
      <button type="button" className="setup-close" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
    </header>
    <nav className="setup-steps" aria-label="Setup steps">
      {STEPS.map((label, i) => <button key={label} type="button" aria-current={i === step ? 'step' : undefined} disabled={busy}
        onClick={() => setStep(i)}><span>{i < step ? '✓' : i + 1}</span>{label}</button>)}
    </nav>
    <div className="setup-content" ref={content}>
      {step === 0 && <>
        <h3 id="setup-step-title">What do the actors say aloud?</h3>
        <p className="setup-description">The punctuation they dictate is the punctuation students hear, and the only punctuation that can be marked when Punctuation is set to Check. Commas are never said unless you choose the last option.</p>
        <Choices group="level" options={DICTATION_LEVELS} value={level} onChange={setLevel} labelledBy="setup-step-title" />
        <p className="setup-note">With this dictation’s settings, students will hear (and Check will mark) <strong>{heardFor(level)}</strong>.</p>
        <p className="setup-note">Example: <em>{script[0]}</em></p>
      </>}
      {step === 1 && <>
        <h3 id="setup-step-title">Who reads?</h3>
        <p className="setup-description">Each actor gets their own link and sees only their sentences. One reader keeps the voice consistent; several let a class share the work.</p>
        <Choices group="reader" value={reader} onChange={setReader} labelledBy="setup-step-title" options={[
          { value: 'one', icon: '🎙', name: 'One reader', description: 'Every sentence read by the same actor.' },
          { value: 'several', icon: '👥', name: 'Several readers', description: 'Assign each sentence to an actor by name.' },
        ]} />
        {reader === 'one'
          ? <label className="setup-field"><span>Actor’s name</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          : <ol className="setup-speakers">{plan.map((part, i) => <li key={i}>
            <span className="setup-sentence">{part.sentence}</span>
            <input aria-label={`Actor for sentence ${i + 1}`} value={speakers[i]} maxLength={40}
              onChange={(e) => setSpeakers((items) => items.map((item, j) => (j === i ? e.target.value : item)))} />
          </li>)}</ol>}
        <label className="setup-field"><span>Session name (what the actors see)</span><input value={sessionTitle} maxLength={120} onChange={(e) => setSessionTitle(e.target.value)} /></label>
      </>}
      {step === 2 && <>
        <h3 id="setup-step-title">The script</h3>
        <p className="setup-description">Each line as the actors will read it, saying the punctuation shown in [brackets]. {createsAssignment ? 'The assignment is created now as a draft (students can’t see it) and remembers this session; come back for the takes from Assignments.' : 'The session is created now; load its takes here when the actors have finished.'}</p>
        <dl className="setup-review">
          <div><dt>Dictated punctuation</dt><dd>{DICTATION_LEVELS.find((o) => o.value === level)?.name}</dd></div>
          <div><dt>Readers</dt><dd>{[...new Set(names)].join(', ')}</dd></div>
          <div><dt>Students hear</dt><dd>{heardFor(level)}</dd></div>
        </dl>
        <ol className="setup-script">{script.map((line, i) => <li key={i}><strong>{names[i]}</strong>: {line}</li>)}</ol>
      </>}
    </div>
    {error && <p className="fetch-error setup-status" role="alert">{error}</p>}
    <footer className="setup-footer">
      <p><kbd>←</kbd><kbd>→</kbd> choose <kbd>Enter</kbd> continue <kbd>Esc</kbd> close</p>
      <div>
        <button type="button" className="btn-ghost" hidden={step === 0} disabled={busy} onClick={() => setStep(step - 1)}>Back</button>
        <button type="button" className="btn-primary" ref={primary} disabled={busy} onClick={advance}>{busy ? 'Creating…' : last ? (createsAssignment ? 'Create assignment and recording session' : 'Create recording session') : 'Continue →'}</button>
      </div>
    </footer>
  </dialog>;
}
