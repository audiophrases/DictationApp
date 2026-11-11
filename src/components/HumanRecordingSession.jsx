import { useEffect, useRef, useState } from 'react';
import AudioSplitStudio from './AudioSplitStudio';
import {
  actorLink, sessionRequest, sessionFields, sessionSaysPunctuation, sessionScript, validateSession, loadTake, trimTake,
  autoTrim, sessionPassage, sessionProgress, sessionTakesKey,
} from '../lib/pinplaySessions';
import { prepareHumanSentenceRecording } from '../lib/notebookAudio';
import { alignTakes } from '../lib/browserWhisper';
import { applyPunctuationPolicy } from '../lib/spokenPunctuationCut';
import { hasSpokenPunctuation, scriptLevel } from '../lib/spokenPunctuation';
import { describeHeard, heardPunctuation } from '../lib/punctuationPolicy';
import WordTimingsOption from './WordTimingsOption';
import RecordingSetupDialog from './RecordingSetupDialog';
import { wavClip } from '../lib/notebookWav';

/**
 * The assignment and the recording session are made together, so the
 * teacher can come back for the takes days later from the assignment:
 *   createDraft()           → the assignment's code, made before the session
 *   onSessionCreated(session, code) → remembers the session on the draft
 *   draftCode               → the draft this session belongs to (shown)
 *   sessionId               → a session remembered earlier: offered to load first
 *   onFinishLater()         → leaves while the actors record
 */
const ALL_PLAYED = { ends: true, inner: true, paragraph: true };

// What was done with the actors' spoken punctuation, for the studio's status line.
function punctuationNote(said, heard, notes) {
  if (!said) return '';
  if (notes.unknown && !notes.cut && !notes.kept) return 'spoken punctuation kept as recorded (no word timings)';
  const parts = [`students hear ${describeHeard(heard)}`];
  if (notes.unsure || notes.unknown) parts.push(`${notes.unsure + notes.unknown} not found, kept`);
  return parts.join(', ');
}

// The level the setup dialog starts on: what this dictation lets students hear.
function suggestedLevel(policy, mode) {
  if (mode === 'notebook' || policy?.inner) return 'all';
  return policy?.ends ? 'ends' : 'none';
}

export default function HumanRecordingSession({ plan, passage, title, lang, rate, mode, delivery, policy = null, onCancel, onAccept, acceptLabel, segmentChangeNotice, planChanged, onSessionPassage,
  createDraft, onSessionCreated, draftCode = '', sessionId = '', onFinishLater }) {
  const [password, setPassword] = useState('');
  const [sessions, setSessions] = useState(null);
  const [session, setSession] = useState(null);
  const [otherSession, setOtherSession] = useState(false); // a remembered session, but the teacher wants another
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [trims, setTrims] = useState({});
  // The splitting studio's work, kept when the teacher steps back to the
  // session, for as long as the takes it was made from stay the same.
  const [studio, setStudio] = useState(null); // { key, recordings }
  const [inStudio, setInStudio] = useState(false);
  const [timings, setTimings] = useState(true);
  const cache = useRef(new Map());
  const controller = useRef(null);
  const player = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const previewBlob = preview?.blob;
  useEffect(() => {
    if (!previewBlob) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(previewBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewBlob]);

  function stop() { player.current?.pause(); setPreview(null); }
  async function run(action) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true); setError(''); setMessage('');
    try { await action(current.signal); }
    catch (err) { if (!current.signal.aborted) setError(err.message); }
    finally { controller.current = null; if (!current.signal.aborted) setBusy(false); }
  }
  const api = (route, fields, signal) => sessionRequest(route, password, fields, signal);
  async function open(id, signal) {
    const { session: next } = await api('get', { id }, signal);
    if (!plan.length && onSessionPassage) onSessionPassage(sessionPassage(next));
    else validateSession(next, plan);
    stop(); cache.current.clear(); setTrims({}); setSession(next);
  }
  async function bufferFor(line, context, signal) {
    const key = line.take?.key;
    if (!cache.current.has(key)) cache.current.set(key, await loadTake(session.id, line, context, signal));
    return cache.current.get(key);
  }
  async function previewTake(line, signal) {
    player.current?.pause();
    const context = new AudioContext({ sampleRate: 24000 });
    try {
      const buffer = await bufferFor(line, context, signal);
      const trim = trims[line.id] || line.trim || autoTrim(buffer);
      const piece = trimTake(buffer, trim, context);
      setTrims((items) => ({ ...items, [line.id]: trim }));
      // A trim changed and not saved yet stays changed while it is previewed again.
      const edited = preview?.id === line.id && preview.key === line.take.key && !!preview.edited;
      setPreview({ id: line.id, key: line.take.key, blob: wavClip(piece, 0, piece.duration), duration: buffer.duration, edited });
    } finally { await context.close(); }
  }
  // Redo requested, or taken back (the line is then simply recorded again).
  async function setStatus(line, status, signal) {
    const { session: next } = await api('save', { id: session.id, lines: [{ id: line.id, status }] }, signal);
    validateSession(next, plan); setSession(next); stop();
  }
  // A silence trim the teacher changed and heard, saved with the take so the
  // splitting studio uses it.
  async function saveTrim(line, signal) {
    const { session: latest } = await api('get', { id: session.id }, signal);
    validateSession(latest, plan);
    const latestLine = latest.lines.find((item) => item.id === line.id);
    if (!preview || preview.dirty || preview.id !== line.id || preview.key !== latestLine?.take?.key) {
      setSession(latest); stop();
      throw new Error('The take changed. Preview the current recording before saving its trim.');
    }
    const { session: next } = await api('save', { id: session.id, lines: [{ id: line.id, trim: trims[line.id] }] }, signal);
    validateSession(next, plan); setSession(next);
    setPreview((current) => current && ({ ...current, edited: false }));
  }
  // No synthetic cue is ever added to a human take: actors say the
  // punctuation the teacher chose in the setup, or none.
  const studioKey = (current) => `${sessionTakesKey(current)}|${timings}|${JSON.stringify(policy)}`;
  const kept = !!(studio && session && studio.key === studioKey(session));

  // Straight from a loaded session to the studio once every sentence has a
  // take: nothing to approve, the teacher hears every phrase there.
  async function openStudio(signal) {
    stop();
    const { session: latest } = await api('get', { id: session.id }, signal);
    validateSession(latest, plan);
    setSession(latest);
    if (!sessionProgress(latest).ready) throw new Error('Not every sentence has a take yet. Refresh when the actors finish.');
    validateSession(latest, plan, true);
    const key = studioKey(latest);
    if (studio?.key === key) { setMessage(''); setInStudio(true); return; }
    const context = new AudioContext({ sampleRate: 24000 });
    const results = [];
    try {
      const takes = [];
      for (let i = 0; i < plan.length; i++) {
        setMessage(`Loading sentence ${i + 1} of ${plan.length}…`);
        const line = latest.lines[i];
        takes.push({ sentence: plan[i].sentence, buffer: trimTake(await bufferFor(line, context, signal), line.trim, context) });
        if (signal.aborted) return;
      }
      // Word timings from speech recognition in this browser, so the cuts
      // fall between the right words; a sentence it can't follow keeps
      // its pause-based cuts. Where the actors said the punctuation, the
      // same words decide what students hear of it (punctuationPolicy.js).
      const said = sessionSaysPunctuation(latest);
      const played = policy || ALL_PLAYED;
      // What students hear dictated, and so what checked punctuation marks:
      // what the actors were asked to say, less what this dictation cuts.
      const heard = said ? heardPunctuation(scriptLevel(latest.lines.map((line) => line.text)), played) : '';
      const found = timings ? await alignTakes(takes, lang, { onProgress: setMessage, signal, withHeard: true }) : [];
      if (signal.aborted) return;
      const notes = { kept: 0, cut: 0, unsure: 0, unknown: 0 };
      for (let i = 0; i < plan.length; i++) {
        setMessage(`Preparing sentence ${i + 1} of ${plan.length}…`);
        let { buffer } = takes[i];
        let boundaries = found[i]?.boundaries || null;
        if (said && hasSpokenPunctuation(latest.lines[i].text)) {
          const applied = found[i]?.heard ? applyPunctuationPolicy(latest.lines[i].text, found[i].heard, buffer, played, context) : null;
          if (applied) { ({ buffer, boundaries } = applied); notes.kept += applied.notes.kept; notes.cut += applied.notes.cut; notes.unsure += applied.notes.unsure; }
          else notes.unknown += 1;
        }
        results.push({ ...await prepareHumanSentenceRecording(plan[i], buffer, { lang, rate, context, signal, boundaries }), dictated: heard });
        if (signal.aborted) return;
      }
      setMessage('');
      setStudio({ key, recordings: results, note: punctuationNote(said, heard, notes) });
      setInStudio(true);
    } finally { await context.close(); }
  }

  if (inStudio && studio) return <AudioSplitStudio plan={plan} lang={lang} rate={rate} mode={mode} delivery={delivery}
    initialRecordings={studio.recordings} onAccept={onAccept} acceptLabel={acceptLabel} segmentChangeNotice={segmentChangeNotice} planChanged={planChanged}
    statusNote={studio.note || ''}
    backLabel="Back to the recording session"
    onCancel={(recordings) => { if (recordings) setStudio((current) => ({ ...current, recordings })); setInStudio(false); }} />;

  const progress = session && sessionProgress(session);
  const waitingFor = progress && [
    ...progress.missing.map((n) => [n, 'not recorded yet']),
    ...progress.redo.map((n) => [n, 'redo requested']),
  ].sort((a, b) => a[0] - b[0]);
  const refresh = () => run((signal) => open(session.id, signal));
  const nextStep = (options) => {
    const { total, recorded } = progress;
    const shown = waitingFor.slice(0, 8).map(([n, why]) => `${n} (${why})`).join(', ');
    // Shown in both copies of the panel, so the teacher sees it from either.
    const live = options ? {} : { 'aria-hidden': true };
    return <div className="session-next">
      {error && <p className="fetch-error" role={options ? 'alert' : undefined} {...live}>{error}</p>}
      {message && <p role={options ? 'status' : undefined} {...live}>{message}</p>}
      <p><strong>{recorded.length === total ? `All ${total} sentences recorded` : `${recorded.length} of ${total} sentences recorded`}</strong>
        {waitingFor.length > 0 && ` · ${waitingFor.length} waiting for the actors`}</p>
      {kept ? <>
        <div className="edit-actions">
          <button className="btn-primary" disabled={busy} onClick={() => { stop(); setInStudio(true); }}>Return to splitting studio</button>
          <button className="btn-ghost btn-small" disabled={busy} onClick={refresh}>Refresh takes</button>
        </div>
        <p className="field-hint">Your split changes are kept while the takes stay the same.</p>
      </> : progress.ready ? <>
        {options && <WordTimingsOption checked={timings} disabled={busy} onChange={setTimings} />}
        <div className="edit-actions">
          <button className="btn-primary" disabled={busy} onClick={() => run(openStudio)}>Open splitting studio</button>
          <button className="btn-ghost btn-small" disabled={busy} onClick={refresh}>Refresh takes</button>
        </div>
        <p className="field-hint">Silence is trimmed automatically and the actor’s pace is kept. Phrase cuts are estimates: listen and adjust them in the studio.</p>
      </> : <>
        <p>The splitting studio opens when every sentence has a take. Waiting for sentence{waitingFor.length === 1 ? '' : 's'} {shown}{waitingFor.length > 8 ? ` and ${waitingFor.length - 8} more` : ''}.</p>
        <div className="edit-actions">
          <button className="btn-primary" disabled={busy} onClick={refresh}>Refresh takes</button>
        </div>
        {options && <p className="field-hint">There is no background polling: refresh when the actors say they have finished.</p>}
      </>}
    </div>;
  };

  return <section className="glass-panel" style={{ maxWidth: 900, margin: '1.5rem auto', padding: '1.5rem' }}>
    <h2>Human voice recording sessions</h2>
    <p className="field-hint">Uses PinPlay’s recording sessions. Share a link with your actors: they record each full sentence on their phone or computer. Once every sentence has a take, open the splitting studio to hear them and adjust the phrase splits.</p>
    {!session ? <>
      <label className="field-label">PinPlay teacher password
        <input type="password" autoComplete="off" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <p className="field-hint">Used only for PinPlay session requests; kept in memory for this visit.</p>
      {error && <p className="fetch-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {sessionId && !otherSession ? <div className="session-next">
        <p><strong>This assignment is waiting for its voice actors.</strong> Their recording session is saved with it.</p>
        <div className="edit-actions">
          <button className="btn-primary" disabled={busy || !password} onClick={() => run((signal) => open(sessionId, signal))}>Load the takes</button>
          <button className="btn-ghost btn-small" disabled={busy} onClick={() => setOtherSession(true)}>Use another session</button>
        </div>
      </div> : <>
      <button className="btn-ghost" disabled={busy || !password} onClick={() => run(async (signal) => setSessions((await api('list', {}, signal)).sessions || []))}>Load existing PinPlay sessions</button>
      {sessions && <ul>{sessions.map((item) => <li key={item.id} style={{ margin: '0.5rem 0' }}>
        <button className="btn-ghost" disabled={busy} onClick={() => run((signal) => open(item.id, signal))}>{item.title} · {item.recorded ?? item.approved}/{item.total} recorded</button>
      </li>)}{!sessions.length && <li>No recording sessions yet.</li>}</ul>}
      {plan.length > 0 && <div className="session-next" style={{ marginTop: '1rem' }}>
        <p><strong>New recording session for this dictation</strong></p>
        <p className="field-hint">{createDraft ? 'The assignment is created with the session, as a draft students can’t see yet: fill in its title, class, due date and settings first. ' : ''}Choose the punctuation the actors say and who reads. Arrow keys choose, Enter continues.</p>
        <div className="edit-actions"><button className="btn-primary" disabled={busy || !password} onClick={() => { setError(''); setSetupOpen(true); }}>Set up the recording session…</button></div>
      </div>}
      {setupOpen && <RecordingSetupDialog plan={plan} title={title} busy={busy} error={error} createsAssignment={!!createDraft && !draftCode}
        initialLevel={suggestedLevel(policy, mode)}
        scriptFor={(level) => sessionScript(plan, { lang, passage, level })}
        heardFor={(level) => describeHeard(heardPunctuation(level, policy || ALL_PLAYED))}
        onClose={() => { if (!busy) setSetupOpen(false); }}
        onCreate={({ level, speakers, title: sessionTitle }) => run(async (signal) => {
          const fields = sessionFields(plan, speakers, sessionTitle, { lang, passage, level });
          // The assignment first: a session nobody can find again is the
          // problem this solves, and a draft without a session is just a draft.
          const code = draftCode || (createDraft ? await createDraft() : '');
          const { session: next } = await api('create', fields, signal);
          validateSession(next, plan);
          if (onSessionCreated) await onSessionCreated(next, code);
          setSetupOpen(false);
          setSession(next);
        })} />}
      </>}
    </> : <>
      <div className="session-heading">
        <h3>{session.title}</h3>
        <button className="btn-ghost btn-small" disabled={busy} onClick={() => { stop(); cache.current.clear(); setSession(null); setTrims({}); setStudio(null); setOtherSession(true); }}>Choose another session</button>
      </div>
      {draftCode && !progress.ready && <div className="session-next">
        <p><strong>Assignment {draftCode} is saved as a draft</strong>, with this session. Students can’t see it yet.</p>
        <p className="field-hint">Share the links below with your actors. When they have finished, open the assignment from the Assignments list: <strong>Load the takes</strong> brings you back here.</p>
        {onFinishLater && <div className="edit-actions"><button className="btn-ghost" disabled={busy} onClick={onFinishLater}>Done for now · back to Assignments</button></div>}
      </div>}
      {nextStep(true)}
      <details open={!progress.ready} style={{ margin: '1rem 0' }}><summary>Links for the actors</summary>
        <p>Actors can record from these links without signing in. Anyone with a link can view the script and record lines.</p>
        <p><a href={actorLink(session.id)} target="_blank" rel="noreferrer">Open recorder · whole passage</a></p>
        <input aria-label="Recording session link" readOnly value={actorLink(session.id)} onFocus={(e) => e.target.select()} />
        <ul>{[...new Set(session.lines.flatMap((line) => line.speaker.split('+').map((name) => name.trim())))].map((speaker) => <li key={speaker}>
          <a href={actorLink(session.id, speaker)} target="_blank" rel="noreferrer">Record as {speaker}</a>
          <input aria-label={`Recording link for ${speaker}`} readOnly value={actorLink(session.id, speaker)} onFocus={(e) => e.target.select()} />
        </li>)}</ul>
        <p className="field-hint">Sessions and takes are saved in PinPlay. You can come back later and load this session.</p>
      </details>
      <h4>Takes, sentence by sentence</h4>
      <p className="field-hint">Nothing to do here unless you want to: listen to a take, change its silence trim, or ask the actor for a redo.</p>
      <ol>{session.lines.map((line) => <li key={line.id} style={{ margin: '1rem 0' }}>
        <p><strong>{line.speaker}</strong>: {line.text}</p>
        <p className="field-hint">{!line.take ? 'Not recorded yet' : line.status === 'redo' ? 'Redo requested' : 'Recorded'}</p>
        <div className="edit-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn-ghost btn-small" disabled={busy || !line.take} onClick={() => run((signal) => previewTake(line, signal))}>
            {preview?.id === line.id ? 'Preview again' : 'Preview take'}</button>
          {line.status === 'redo'
            ? <button className="btn-ghost btn-small" disabled={busy || !line.take} onClick={() => run((signal) => setStatus(line, 'recorded', signal))}>Keep this take after all</button>
            : <button className="btn-ghost btn-small" disabled={busy || !line.take} onClick={() => run((signal) => setStatus(line, 'redo', signal))}>Request redo</button>}
        </div>
        {preview?.id === line.id && <>
          <audio ref={player} src={previewUrl || undefined} controls autoPlay style={{ width: '100%' }} />
          <p className="field-hint">Silence is trimmed automatically. To change it, adjust the start or end, preview again, then save the trim.</p>
          {['s', 'e'].map((key) => <label key={key} style={{ display: 'inline-block', marginRight: '1rem' }}>
            {key === 's' ? 'Start (seconds)' : 'End (seconds)'}
            <input type="number" min="0" max={preview.duration} step="0.01" value={(trims[line.id]?.[key] ?? 0) / 1000} disabled={busy}
              onChange={(e) => { player.current?.pause(); setTrims((items) => ({ ...items, [line.id]: { ...items[line.id], [key]: Number(e.target.value) * 1000 } })); setPreview((current) => current && ({ ...current, dirty: true, edited: true })); }} />
          </label>)}
          {preview.edited && <button className="btn-ghost btn-small" disabled={busy || preview.dirty}
            title={preview.dirty ? 'Preview again first' : undefined} onClick={() => run((signal) => saveTrim(line, signal))}>Save trim</button>}
        </>}
      </li>)}</ol>
      {session.lines.length > 3 && nextStep(false)}
    </>}
    <div className="edit-actions"><button className="btn-ghost" disabled={busy} onClick={onCancel}>Back</button></div>
  </section>;
}
