import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, Mic, RefreshCw } from 'lucide-react';
import { SPEEDS, LANGUAGES, REPLAY_LIMITS, FEEDBACK_MODES } from '../../lib/options';
import { DEFAULT_GRADING_OPTIONS } from '../../lib/grading';
import { createAssignment, publishAssignment } from '../../lib/assignmentApi';
import { recordSentences } from '../../lib/buildAssignment';
import { studentLink } from '../../lib/appLinks';
import MarkingRules from '../../components/MarkingRules';
import { notebookPlan } from '../../lib/notebook';
import { deliveryFor, dictationUnit } from '../../lib/delivery';

// A date input gives a day, and homework is due at the end of that day rather
// than at midnight as it starts.
function endOfDay(dateString) {
  if (!dateString) return null;
  const [y, m, d] = dateString.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59).getTime();
}

function CreateAssignmentScreen({ onCancel, onFinished, requireServer }) {
  const [passage, setPassage] = useState('');
  const [title, setTitle] = useState('');
  const [className, setClassName] = useState('');
  const [due, setDue] = useState('');
  const [lang, setLang] = useState('en-US');
  const [rate, setRate] = useState(1);
  const [maxListens, setMaxListens] = useState(0);
  const [attemptsLimit, setAttemptsLimit] = useState(1);
  const [feedbackMode, setFeedbackMode] = useState('end');
  const [mode, setMode] = useState('typing');
  const [selectedDelivery, setDelivery] = useState('');
  const delivery = deliveryFor({ mode, delivery: selectedDelivery });
  // Starts from the app-wide defaults so a new assignment marks the way free
  // practice does unless the teacher says otherwise — one place to change, not two.
  const [grading, setGrading] = useState({ ...DEFAULT_GRADING_OPTIONS });

  const [phase, setPhase] = useState('form'); // form | recording | done
  const [code, setCode] = useState('');
  const [sentences, setSentences] = useState([]);
  const [recorded, setRecorded] = useState(0);
  const [failed, setFailed] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const segments = useMemo(() => notebookPlan(passage, lang, delivery)
    .flatMap((p) => p.segments), [passage, lang, delivery]);
  const previewCount = segments.length;
  const unit = dictationUnit({ delivery });

  async function finish(assignmentCode) {
    try {
      await publishAssignment(assignmentCode);
      setPhase('done');
    } catch (err) {
      setError(err.message);
    }
  }

  async function record(assignmentCode, list, only) {
    setError('');
    // The teacher's browser does the synthesis, so it is the teacher who waits
    // for a sleeping voice server — never a student.
    requireServer?.();
    const stragglers = await recordSentences(assignmentCode, list, {
      lang,
      rate,
      only,
      mode,
      delivery,
      text: passage,
      onSettled: (_index, failure) => {
        setRecorded((n) => n + 1);
        if (failure) setError(failure.message);
      },
    });
    setFailed(stragglers);
    if (stragglers.length === 0) await finish(assignmentCode);
  }

  async function handleCreate() {
    setPhase('recording');
    setRecorded(0);
    setFailed([]);
    setError('');
    try {
      const { code: newCode, sentences: list } = await createAssignment({
        text: passage,
        mode,
        delivery,
        segments,
        title,
        className,
        dueAt: endOfDay(due),
        attemptsLimit,
        maxListens,
        feedbackMode,
        lang,
        rate,
        grading,
      });
      setCode(newCode);
      setSentences(list);
      await record(newCode, list);
    } catch (err) {
      setError(err.message);
      // Keep the code if we got one: the audio can be retried without
      // creating a second assignment.
      if (!code) setPhase('form');
    }
  }

  async function handleRetry() {
    setRecorded(sentences.length - failed.length);
    await record(code, sentences, failed);
  }

  function copyLink() {
    navigator.clipboard?.writeText(studentLink(code)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setError('Copying failed — select the link and copy it by hand.')
    );
  }

  if (phase === 'done') {
    return (
      <div className="app-container" style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
        <div className="glass-panel animate-fade-in" style={{ textAlign: 'center' }}>
          <Check size={44} color="var(--success-color)" style={{ margin: '0 auto 0.75rem' }} />
          <h2 style={{ fontSize: '1.6rem' }}>Assignment ready</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {sentences.length} {unit}{sentences.length !== 1 ? 's' : ''} recorded. {mode === 'notebook'
              ? 'Students write by hand and wait for you to release corrections.'
              : `Students hear each ${unit} before typing their answer.`}
          </p>

          <div className="assignment-code">{code}</div>

          <div className="assignment-link">
            <input readOnly value={studentLink(code)} onFocus={(e) => e.target.select()} />
            <button className="btn-ghost btn-small" onClick={copyLink}>
              {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
            </button>
          </div>

          {error && <p className="fetch-error" style={{ marginTop: '0.75rem' }}>{error}</p>}

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="btn-primary" onClick={onFinished}>Go to assignments</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'recording') {
    const total = sentences.length || previewCount;
    const pct = total ? Math.min(100, Math.round((recorded / total) * 100)) : 0;
    return (
      <div className="app-container" style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
        <div className="glass-panel animate-fade-in" style={{ textAlign: 'center' }}>
          <Mic size={36} className="fetch-panel-icon" style={{ margin: '0 auto' }} />
          <h2 style={{ fontSize: '1.4rem', marginTop: '0.5rem' }}>Recording the {unit}s</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Each {unit} is recorded and stored now. {mode === 'notebook' && 'A spoken punctuation cue is added at each sentence ending. '}
            Your students never wait for a voice server. The first recording can take a moment while it wakes up.
          </p>

          <div className="progress-track" style={{ margin: '1.5rem 0 0.5rem' }}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {total ? `${Math.min(recorded, total)} of ${total}` : 'Preparing…'}
          </p>

          {failed.length > 0 && (
            <>
              <p className="fetch-error" style={{ marginTop: '1rem' }}>
                {unit === 'segment' ? 'Segment' : 'Sentence'}{failed.length > 1 ? 's' : ''} {failed.map((i) => i + 1).join(', ')} didn't
                record. The assignment stays unpublished until every {unit} has audio.
              </p>
              <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={handleRetry}>
                <RefreshCw size={18} /> Retry those {unit}s
              </button>
            </>
          )}

          {error && <p className="fetch-error" style={{ marginTop: '1rem' }}>{error}</p>}

          {error && code && failed.length === 0 && <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={() => { setError(''); finish(code); }}>
            <RefreshCw size={18} /> Retry publishing
          </button>}

          {failed.length === 0 && !error && (
            <Loader2 size={20} className="spin" style={{ marginTop: '1rem', color: 'var(--text-muted)' }} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>New assignment</h1>
      </div>

      <div className="glass-panel animate-fade-in">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <label className="field-label" htmlFor="assignment-mode">Dictation mode</label>
            <select id="assignment-mode" value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: '100%' }}>
              <option value="typing">Type answers in the app</option>
              <option value="notebook">Notebook — write by hand</option>
            </select>
            {mode === 'notebook' && <p className="field-hint">Space repeats a {unit}; Enter advances; arrow keys navigate. No marking is shown. You release the passage for corrections when students are ready.</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="assignment-delivery">Read in</label>
            <select id="assignment-delivery" value={delivery} onChange={(e) => setDelivery(e.target.value)} style={{ width: '100%' }}>
              <option value="sentences">Full sentences</option>
              <option value="phrases">Short phrases (segmented)</option>
            </select>
            <p className="field-hint">{delivery === 'phrases'
              ? `Students hear one short phrase at a time.${mode === 'typing' ? ' Each segment is typed and marked separately.' : ''}`
              : 'Students hear one complete sentence at a time.'}</p>
          </div>
          <div className="settings-grid">
            <div>
              <label className="field-label">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Volcanoes" />
            </div>
            <div>
              <label className="field-label">Class</label>
              <input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="2 ESO B" />
            </div>
            <div>
              <label className="field-label">Due date</label>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>

          <div className="settings-grid">
            <div>
              <label className="field-label">Language</label>
              <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: '100%' }}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Voice speed</label>
              <select
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              >
                {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Replays allowed</label>
              <select
                value={maxListens}
                onChange={(e) => setMaxListens(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              >
                {REPLAY_LIMITS.map((r) => <option key={r.value} value={r.value}>{r.name.replace('sentence', unit)}</option>)}
              </select>
            </div>
          </div>

          <div className="settings-grid">
            {mode !== 'notebook' && <div>
              <label className="field-label">Attempts</label>
              <select
                value={attemptsLimit}
                onChange={(e) => setAttemptsLimit(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              >
                <option value={1}>1 attempt</option>
                <option value={2}>2 attempts</option>
                <option value={3}>3 attempts</option>
                <option value={0}>Unlimited</option>
              </select>
            </div>}
            {mode !== 'notebook' && <div>
              <label className="field-label">Feedback</label>
              <select
                value={feedbackMode}
                onChange={(e) => setFeedbackMode(e.target.value)}
                style={{ width: '100%' }}
              >
                {FEEDBACK_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.name.replace('sentence', unit)}</option>
                ))}
                <option value="none">Nothing</option>
              </select>
            </div>}
          </div>

          {mode !== 'notebook' && <div>
            <label className="field-label">Marking</label>
            <MarkingRules value={grading} onChange={setGrading} />
            <p className="field-hint">
              All three are ignored by default, so only the words count. Choose Check for a
              spelling-focused task. Fixed when you create the assignment — students can't loosen
              it to re-mark themselves.
            </p>
          </div>}

          <div>
            <label className="field-label">Passage</label>
            <textarea
              value={passage}
              onChange={(e) => setPassage(e.target.value)}
              placeholder="Paste the text your students will hear…"
              style={{ minHeight: '180px' }}
            />
            <p className="field-hint">
              {previewCount} {unit}{previewCount !== 1 ? 's' : ''} — {delivery === 'phrases' ? 'short grammatical phrases.' : 'full sentences.'} {mode === 'notebook' && 'Sentence endings are announced aloud.'}
            </p>
          </div>

          {error && <div className="fetch-error">{error}</div>}

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn-ghost" onClick={onCancel}>
              <ArrowLeft size={18} /> Back
            </button>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              onClick={handleCreate}
              disabled={previewCount === 0}
            >
              <Mic size={18} /> Create and record {previewCount || ''} {unit}{previewCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateAssignmentScreen;
