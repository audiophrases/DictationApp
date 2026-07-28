import { useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, Mic, RefreshCw } from 'lucide-react';
import { splitIntoSentences } from '../../lib/sentences';
import { SPEEDS, LANGUAGES, REPLAY_LIMITS } from '../../lib/options';
import { createAssignment, publishAssignment } from '../../lib/assignmentApi';
import { recordSentences } from '../../lib/buildAssignment';
import { studentLink } from '../../lib/appLinks';

// A date input gives a day, and homework is due at the end of that day rather
// than at midnight as it starts.
function endOfDay(dateString) {
  if (!dateString) return null;
  const [y, m, d] = dateString.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59).getTime();
}

function CreateAssignmentScreen({ initial, onCancel, onFinished, requireServer }) {
  const [passage, setPassage] = useState(initial?.passage || '');
  const [title, setTitle] = useState(initial?.source?.title || '');
  const [className, setClassName] = useState('');
  const [due, setDue] = useState('');
  const [lang, setLang] = useState(initial?.settings?.lang || 'en-US');
  const [rate, setRate] = useState(initial?.settings?.rate ?? 1);
  const [maxListens, setMaxListens] = useState(initial?.settings?.maxListens ?? 0);
  const [attemptsLimit, setAttemptsLimit] = useState(1);
  const [feedbackMode, setFeedbackMode] = useState('end');
  const [grading, setGrading] = useState({
    ignoreCase: false,
    ignorePunctuation: false,
    ignoreAccents: false,
  });

  const [phase, setPhase] = useState('form'); // form | recording | done
  const [code, setCode] = useState('');
  const [sentences, setSentences] = useState([]);
  const [recorded, setRecorded] = useState(0);
  const [failed, setFailed] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const previewCount = splitIntoSentences(passage).length;

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
      onSettled: () => setRecorded((n) => n + 1),
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
        title,
        className,
        dueAt: endOfDay(due),
        attemptsLimit,
        maxListens,
        feedbackMode,
        lang,
        rate,
        grading,
        source: initial?.source || null,
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
            {sentences.length} sentence{sentences.length !== 1 ? 's' : ''} recorded. Students never
            see the text — they hear each sentence and type it.
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
          <h2 style={{ fontSize: '1.4rem', marginTop: '0.5rem' }}>Recording the sentences</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Each sentence is read once now and stored, so your students never wait for a voice
            server. The first one can take a moment while it wakes up.
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
                Sentence{failed.length > 1 ? 's' : ''} {failed.map((i) => i + 1).join(', ')} didn't
                record. The assignment stays unpublished until every sentence has audio.
              </p>
              <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={handleRetry}>
                <RefreshCw size={18} /> Retry those sentences
              </button>
            </>
          )}

          {error && <p className="fetch-error" style={{ marginTop: '1rem' }}>{error}</p>}

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
                {REPLAY_LIMITS.map((r) => <option key={r.value} value={r.value}>{r.name}</option>)}
              </select>
            </div>
          </div>

          <div className="settings-grid">
            <div>
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
            </div>
            <div>
              <label className="field-label">After submitting</label>
              <select
                value={feedbackMode}
                onChange={(e) => setFeedbackMode(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="end">Show their marked answers</option>
                <option value="none">Show nothing</option>
              </select>
            </div>
          </div>

          <div>
            <label className="field-label">Marking</label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {[
                { key: 'ignoreCase', label: 'Ignore case' },
                { key: 'ignorePunctuation', label: 'Ignore punctuation' },
                { key: 'ignoreAccents', label: 'Ignore accents' },
              ].map((t) => (
                <button
                  key={t.key}
                  className={`chip ${grading[t.key] ? 'chip-active' : ''}`}
                  onClick={() => setGrading({ ...grading, [t.key]: !grading[t.key] })}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="field-hint">
              Fixed when you create the assignment — students can't loosen it to re-mark themselves.
            </p>
          </div>

          <div>
            <label className="field-label">Passage</label>
            <textarea
              value={passage}
              onChange={(e) => setPassage(e.target.value)}
              placeholder="Paste the text your students will hear…"
              style={{ minHeight: '180px' }}
            />
            <p className="field-hint">
              {previewCount} sentence{previewCount !== 1 ? 's' : ''} — one recording each.
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
              <Mic size={18} /> Create and record {previewCount || ''} sentence{previewCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateAssignmentScreen;
