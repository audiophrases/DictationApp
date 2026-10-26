import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Loader2, Mic, Play, RefreshCw, Save, Square } from 'lucide-react';
import { SPEEDS, LANGUAGES, REPLAY_LIMITS, FEEDBACK_MODES } from '../../lib/options';
import {
  fetchTeacherAudio,
  getAssignment,
  publishAssignment,
  updateAssignmentContent,
  updateAssignmentSettings,
} from '../../lib/assignmentApi';
import { recordSentences, rerecordSegments } from '../../lib/buildAssignment';
import { notebookPlan } from '../../lib/notebook';
import { deliveryFor, dictationUnit } from '../../lib/delivery';
import MarkingRules from '../../components/MarkingRules';

const toDateInput = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const endOfDay = (value) => {
  const [y, m, d] = (value || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d, 23, 59, 59).getTime() : null;
};

/**
 * Changing an assignment after it was created: its settings, its recordings,
 * or its text. Each section saves on its own, because they cost very different
 * amounts — a setting is instant, a recording takes a while, and new text
 * clears every student's work.
 */
function EditAssignmentScreen({ code, onBack, requireServer }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setData(await getAssignment(code)); } catch (err) { setError(err.message); }
  }, [code]);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <div className="app-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        <div className="glass-panel">{error ? <div className="fetch-error">{error}</div> : <div className="empty-note"><Loader2 size={22} className="spin" /></div>}</div>
      </div>
    );
  }

  const { record } = data;
  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>Edit {record.title}</h1>
        <p><span className="code-chip">{code}</span> · same code and link for students</p>
      </div>
      <div className="glass-panel animate-fade-in edit-sections">
        <div className="screen-head">
          <button className="btn-ghost btn-small" onClick={onBack}><ArrowLeft size={15} /> Back to the class</button>
        </div>
        <SettingsSection code={code} data={data} onSaved={load} />
        <RecordingsSection code={code} data={data} onSaved={load} requireServer={requireServer} />
        <TextSection code={code} data={data} onSaved={load} requireServer={requireServer} />
      </div>
    </div>
  );
}

function SettingsSection({ code, data, onSaved }) {
  const { record, attempts } = data;
  const notebook = record.mode === 'notebook';
  const unit = dictationUnit(record);
  const handedIn = attempts.some((a) => a.submitted);
  const [form, setForm] = useState(() => ({
    title: record.title,
    className: record.className || '',
    due: toDateInput(record.dueAt),
    attemptsLimit: record.attemptsLimit,
    maxListens: record.maxListens,
    feedbackMode: record.feedbackMode,
    allowSlowdown: !!record.settings?.allowSlowdown,
    practiceAfter: !!record.practiceAfter,
    grading: record.grading,
  }));
  const [status, setStatus] = useState({ saving: false, saved: false, error: '' });
  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setStatus((s) => ({ ...s, saved: false })); };

  async function save() {
    setStatus({ saving: true, saved: false, error: '' });
    try {
      await updateAssignmentSettings(code, {
        title: form.title,
        className: form.className,
        dueAt: endOfDay(form.due),
        attemptsLimit: form.attemptsLimit,
        maxListens: form.maxListens,
        allowSlowdown: form.allowSlowdown,
        practiceAfter: form.practiceAfter,
        ...(notebook ? {} : { feedbackMode: form.feedbackMode }),
        ...(notebook || handedIn ? {} : { grading: form.grading }),
      });
      setStatus({ saving: false, saved: true, error: '' });
      onSaved();
    } catch (err) {
      setStatus({ saving: false, saved: false, error: err.message });
    }
  }

  return (
    <section className="edit-section">
      <h2>Settings</h2>
      <p className="field-hint">Take effect straight away, for students who have started too.</p>
      <div className="settings-grid">
        <div><label className="field-label">Title</label><input value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div><label className="field-label">Class</label><input value={form.className} onChange={(e) => set('className', e.target.value)} /></div>
        <div><label className="field-label">Due date</label><input type="date" value={form.due} onChange={(e) => set('due', e.target.value)} /></div>
      </div>
      <div className="settings-grid">
        <div>
          <label className="field-label">Attempts</label>
          <select value={form.attemptsLimit} onChange={(e) => set('attemptsLimit', parseInt(e.target.value, 10))} style={{ width: '100%' }}>
            {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} attempt{n > 1 ? 's' : ''}</option>)}
            <option value={0}>Unlimited</option>
          </select>
        </div>
        <div>
          <label className="field-label">Replays allowed</label>
          <select value={form.maxListens} onChange={(e) => set('maxListens', parseInt(e.target.value, 10))} style={{ width: '100%' }}>
            {REPLAY_LIMITS.map((r) => <option key={r.value} value={r.value}>{r.name.replace('sentence', unit)}</option>)}
          </select>
        </div>
        {!notebook && <div>
          <label className="field-label">Feedback</label>
          <select value={form.feedbackMode} onChange={(e) => set('feedbackMode', e.target.value)} style={{ width: '100%' }}>
            {FEEDBACK_MODES.map((m) => <option key={m.value} value={m.value}>{m.name.replace('sentence', unit)}</option>)}
            <option value="none">Nothing</option>
          </select>
        </div>}
      </div>
      <label className="edit-check">
        <input type="checkbox" checked={form.allowSlowdown} onChange={(e) => set('allowSlowdown', e.target.checked)} />
        Allow students to slow playback
      </label>
      <label className="edit-check">
        <input type="checkbox" checked={form.practiceAfter} disabled={!notebook && form.feedbackMode === 'none'}
          onChange={(e) => set('practiceAfter', e.target.checked)} />
        Free practice after handing in
      </label>
      <p className="field-hint">
        {!notebook && form.feedbackMode === 'none'
          ? 'Not available while Feedback is "Nothing": practice is marked, which would show the text.'
          : notebook
            ? 'Students who have handed in can listen to the dictation again as often as they like. Nothing is recorded.'
            : 'Students who have handed in can do the dictation again, marked as they go, as often as they like. Nothing is recorded, and their score doesn’t change.'}
      </p>
      {!notebook && <div style={{ marginTop: '1rem' }}>
        <label className="field-label">Marking</label>
        {handedIn
          ? <p className="field-hint">Locked: students have handed in, and their scores were marked with these rules. Editing the text clears their work and unlocks it.</p>
          : <MarkingRules value={form.grading} onChange={(grading) => set('grading', grading)} />}
      </div>}
      {status.error && <div className="fetch-error" style={{ marginTop: '0.75rem' }}>{status.error}</div>}
      <div className="edit-actions">
        <button className="btn-primary" onClick={save} disabled={status.saving}>
          {status.saving ? <Loader2 size={18} className="spin" /> : status.saved ? <Check size={18} /> : <Save size={18} />}
          {status.saved ? 'Saved' : 'Save settings'}
        </button>
      </div>
    </section>
  );
}

function RecordingsSection({ code, data, onSaved, requireServer }) {
  const { record, sentences } = data;
  const unit = dictationUnit(record);
  const [rate, setRate] = useState(record.settings?.rate ?? 1);
  const [busy, setBusy] = useState(null); // null | 'all' | index
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(new Set());
  const [playing, setPlaying] = useState(null);
  const player = useRef(null);
  useEffect(() => () => player.current?.pause(), []);

  async function listen(index) {
    player.current?.pause();
    if (playing === index) { setPlaying(null); return; }
    setError('');
    try {
      const url = URL.createObjectURL(await fetchTeacherAudio(code, index));
      const audio = new Audio(url);
      player.current = audio;
      setPlaying(index);
      audio.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
      await audio.play();
    } catch (err) {
      setPlaying(null);
      setError(err.message);
    }
  }

  async function rerecord(only) {
    setBusy(only ? only[0] : 'all');
    setError('');
    let count = 0;
    // Why the last failure happened, shown with the list of what failed.
    let reason = '';
    const total = only ? only.length : sentences.length;
    setProgress(`0 of ${total}`);
    requireServer?.();
    try {
      const failed = await rerecordSegments(code, sentences, {
        lang: record.settings.lang, rate, mode: record.mode, only,
        onSettled: (_i, failure) => { count += 1; setProgress(`${count} of ${total}`); if (failure) reason = failure.message; },
      });
      if (failed.length) {
        setError(`${unit === 'segment' ? 'Segment' : 'Sentence'}${failed.length > 1 ? 's' : ''} ${failed.map((i) => i + 1).join(', ')} didn't record${reason ? ` (${reason})` : ''}. The old recording is still there; try again.`);
      }
      setDone(new Set((only || sentences.map((_, i) => i)).filter((i) => !failed.includes(i))));
      // A whole re-record at another speed changes what the assignment is
      // recorded at; one segment doesn't.
      if (!only && !failed.length && rate !== record.settings?.rate) {
        await updateAssignmentSettings(code, { rate });
      }
      // A draft left behind by a text edit whose recording was abandoned:
      // every recording now exists, so students can have it.
      if (!only && !failed.length && record.status === 'draft') await publishAssignment(code);
      if (!only && !failed.length) onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
      setProgress('');
    }
  }

  return (
    <section className="edit-section">
      <h2>Recordings</h2>
      <p className="field-hint">Same text, new voice recording: all of it, for example at another speed, or one {unit} that sounds wrong. Students hear the new recording from their next play.</p>
      <div className="edit-actions" style={{ justifyContent: 'flex-start' }}>
        <label className="notebook-speed">
          Voice speed
          <select value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} disabled={busy !== null}>
            {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.name}</option>)}
          </select>
        </label>
        <button className="btn-primary" onClick={() => rerecord(null)} disabled={busy !== null}>
          {busy === 'all' ? <Loader2 size={18} className="spin" /> : <Mic size={18} />} Re-record all {sentences.length} {unit}s
        </button>
        {busy === 'all' && <span className="field-hint" style={{ margin: 0 }}>{progress}</span>}
      </div>
      {error && <div className="fetch-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
      <ol className="segment-list">
        {sentences.map((text, i) => (
          <li key={i}>
            <span className="segment-number">{i + 1}</span>
            <span className="segment-text">{text}</span>
            <button className="btn-icon" title={playing === i ? 'Stop' : 'Listen'} onClick={() => listen(i)} disabled={busy !== null}>
              {playing === i ? <Square size={15} /> : <Play size={15} />}
            </button>
            <button className="btn-ghost btn-small" onClick={() => rerecord([i])} disabled={busy !== null}>
              {busy === i ? <Loader2 size={14} className="spin" /> : done.has(i) ? <Check size={14} /> : <RefreshCw size={14} />} Re-record
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TextSection({ code, data, onSaved, requireServer }) {
  const { record, attempts } = data;
  const notebook = record.mode === 'notebook';
  const delivery = deliveryFor(record);
  const unit = dictationUnit(record);
  const [text, setText] = useState(data.text);
  const [lang, setLang] = useState(record.settings?.lang || 'en-US');
  const [rate, setRate] = useState(record.settings?.rate ?? 1);
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState('form'); // form | recording | done
  const [list, setList] = useState([]);
  const [recorded, setRecorded] = useState(0);
  const [failed, setFailed] = useState([]);
  const [error, setError] = useState('');

  const segments = useMemo(() => notebookPlan(text, lang, delivery).flatMap((p) => p.segments), [text, lang, delivery]);
  const changed = text.trim() !== data.text.trim() || lang !== record.settings?.lang;
  const students = new Set(attempts.map((a) => a.studentKey)).size;

  async function recordAndPublish(newList, only) {
    setError('');
    requireServer?.();
    const stragglers = await recordSentences(code, newList, {
      lang, rate, only, mode: record.mode, delivery, text,
      onSettled: (_i, failure) => { setRecorded((n) => n + 1); if (failure) setError(failure.message); },
    });
    setFailed(stragglers);
    if (stragglers.length) return;
    await publishAssignment(code);
    setPhase('done');
    onSaved();
  }

  async function save() {
    if (attempts.length && !confirm) { setConfirm(true); return; }
    setPhase('recording');
    setRecorded(0);
    setFailed([]);
    setError('');
    try {
      const { sentences: newList } = await updateAssignmentContent(code, { text, segments, lang, rate });
      setList(newList);
      await recordAndPublish(newList);
    } catch (err) {
      setError(err.message);
    }
  }

  async function retry() {
    setRecorded(list.length - failed.length);
    try { await recordAndPublish(list, failed); } catch (err) { setError(err.message); }
  }

  if (phase !== 'form') {
    const total = list.length || segments.length;
    return (
      <section className="edit-section">
        <h2>Text</h2>
        {phase === 'done'
          ? <p className="edit-done"><Check size={18} /> New text recorded and published. Students start it afresh from the same link.</p>
          : <>
            <p className="field-hint">Recording the new text. Students can't open the assignment until this finishes; keep this page open.</p>
            <div className="progress-track" style={{ margin: '1rem 0 0.5rem' }}>
              <div className="progress-fill" style={{ width: `${total ? Math.round((Math.min(recorded, total) / total) * 100) : 0}%` }} />
            </div>
            <p className="field-hint">{Math.min(recorded, total)} of {total}</p>
          </>}
        {error && <div className="fetch-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
        {failed.length > 0 && <button className="btn-primary" style={{ marginTop: '0.75rem' }} onClick={retry}><RefreshCw size={18} /> Retry the {failed.length} that failed</button>}
        {phase === 'recording' && error && !list.length && (
          <button className="btn-ghost" style={{ marginTop: '0.75rem' }} onClick={() => setPhase('form')}><ArrowLeft size={18} /> Back to the text</button>
        )}
        {phase === 'recording' && error && !failed.length && list.length > 0 && (
          <button className="btn-primary" style={{ marginTop: '0.75rem' }} onClick={retry}><RefreshCw size={18} /> Try again</button>
        )}
      </section>
    );
  }

  return (
    <section className="edit-section">
      <h2>Text</h2>
      <p className="field-hint">Change the passage itself. It is split again and re-recorded; the code and link stay the same.</p>
      <div className="settings-grid">
        <div>
          <label className="field-label">Language</label>
          <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: '100%' }}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Voice speed</label>
          <select value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} style={{ width: '100%' }}>
            {SPEEDS.map((s) => <option key={s.value} value={s.value}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setConfirm(false); }} style={{ minHeight: '180px', marginTop: '1rem' }} />
      <p className="field-hint">{segments.length} {unit}{segments.length !== 1 ? 's' : ''}{notebook ? ' · corrections will need releasing again' : ''}</p>
      {attempts.length > 0 && (
        <p className="edit-warning">
          <AlertTriangle size={16} /> This deletes the work of {students} student{students !== 1 ? 's' : ''} ({attempts.length} attempt{attempts.length !== 1 ? 's' : ''}), including scores. They start the new text from scratch.
        </p>
      )}
      {error && <div className="fetch-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
      <div className="edit-actions">
        <button className={confirm ? 'btn-danger' : 'btn-primary'} onClick={save} disabled={!changed || segments.length === 0}>
          <Mic size={18} /> {confirm ? 'Click again: delete student work and re-record' : `Save text and re-record ${segments.length} ${unit}s`}
        </button>
      </div>
    </section>
  );
}

export default EditAssignmentScreen;
