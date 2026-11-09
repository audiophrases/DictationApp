import { useEffect, useRef, useState } from 'react';
import AudioSplitStudio from './AudioSplitStudio';
import { actorLink, sessionRequest, sessionFields, validateSession, loadTake, trimTake, autoTrim, sessionPassage } from '../lib/pinplaySessions';
import { prepareHumanSentenceRecording } from '../lib/notebookAudio';
import { wavClip } from '../lib/notebookWav';

export default function HumanRecordingSession({ plan, title, lang, rate, mode, onCancel, onAccept, acceptLabel, segmentChangeNotice, requireServer, onSessionPassage }) {
  const [password, setPassword] = useState('');
  const [sessions, setSessions] = useState(null);
  const [session, setSession] = useState(null);
  const [speakers, setSpeakers] = useState(() => plan.map(() => 'Narrator'));
  const [sessionTitle, setSessionTitle] = useState(title || 'Dictation recording');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [trims, setTrims] = useState({});
  const [ready, setReady] = useState(null);
  const [punctuation, setPunctuation] = useState(false);
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
      setPreview({ id: line.id, key: line.take.key, blob: wavClip(piece, 0, piece.duration), duration: buffer.duration });
    } finally { await context.close(); }
  }
  async function review(line, status, signal) {
    if (status === 'ok') {
      const { session: latest } = await api('get', { id: session.id }, signal);
      validateSession(latest, plan);
      const latestLine = latest.lines.find((item) => item.id === line.id);
      if (!preview || preview.dirty || preview.id !== line.id || preview.key !== latestLine?.take?.key) {
        setSession(latest); stop();
        throw new Error('The take changed. Preview the current recording before approving it.');
      }
    }
    const { session: next } = await api('save', { id: session.id,
      lines: [{ id: line.id, status, ...(status === 'ok' ? { trim: trims[line.id] } : {}) }],
    }, signal);
    validateSession(next, plan); setSession(next); stop();
  }
  async function importTakes(signal) {
    stop();
    const { session: latest } = await api('get', { id: session.id }, signal);
    validateSession(latest, plan, true);
    setSession(latest);
    const context = new AudioContext({ sampleRate: 24000 });
    const cueCache = new Map();
    const results = [];
    try {
      if (punctuation) requireServer?.();
      for (let i = 0; i < plan.length; i++) {
        setMessage(`Preparing sentence ${i + 1} of ${plan.length}…`);
        const line = latest.lines[i];
        const buffer = trimTake(await bufferFor(line, context, signal), line.trim, context);
        results.push(await prepareHumanSentenceRecording(plan[i], buffer, {
          lang, rate, context, cueCache, punctuation, signal,
        }));
        if (signal.aborted) return;
      }
      setReady(results);
    } finally { await context.close(); }
  }

  if (ready) return <AudioSplitStudio plan={plan} lang={lang} rate={rate} mode={mode}
    initialRecordings={ready} onAccept={onAccept} acceptLabel={acceptLabel} segmentChangeNotice={segmentChangeNotice}
    onCancel={() => setReady(null)} />;

  return <section className="glass-panel" style={{ maxWidth: 900, margin: '1.5rem auto', padding: '1.5rem' }}>
    <h2>Human voice recording sessions</h2>
    <p className="field-hint">Uses PinPlay’s recording sessions. Share a link with your actors: they record each full sentence on their phone or computer. Listen here, approve or request a redo, then adjust the phrase splits.</p>
    <label className="field-label">PinPlay teacher password
      <input type="password" autoComplete="off" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
    </label>
    <p className="field-hint">Used only for PinPlay session requests; kept in memory for this visit.</p>
    {error && <p className="fetch-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!session ? <>
      <button className="btn-ghost" disabled={busy || !password} onClick={() => run(async (signal) => setSessions((await api('list', {}, signal)).sessions || []))}>Load existing PinPlay sessions</button>
      {sessions && <ul>{sessions.map((item) => <li key={item.id} style={{ margin: '0.5rem 0' }}>
        <button className="btn-ghost" disabled={busy} onClick={() => run((signal) => open(item.id, signal))}>{item.title} · {item.approved}/{item.total} approved</button>
      </li>)}{!sessions.length && <li>No recording sessions yet.</li>}</ul>}
      <details open={!sessions && plan.length > 0} style={{ margin: '1rem 0' }}><summary>Create a session for this dictation</summary>
        <label className="field-label">Session title<input value={sessionTitle} maxLength={120} disabled={busy} onChange={(e) => setSessionTitle(e.target.value)} /></label>
        <p className="field-hint">Use the same actor name throughout for one reader, or assign different sentences to different actors. Actors record the words exactly as written. Sentence text editing is disabled for this session.</p>
        <ol>{plan.map((part, i) => <li key={i} style={{ margin: '0.75rem 0' }}>
          <p>{part.sentence}</p>
          <label>Actor for sentence {i + 1}<input maxLength={40} value={speakers[i]} disabled={busy}
            onChange={(e) => setSpeakers((items) => items.map((item, j) => j === i ? e.target.value : item))} /></label>
        </li>)}</ol>
        <button className="btn-primary" disabled={busy || !password || !plan.length} onClick={() => run(async (signal) => {
          const { session: next } = await api('create', sessionFields(plan, speakers, sessionTitle), signal);
          validateSession(next, plan); setSession(next);
        })}>Create recording session</button>
      </details>
    </> : <>
      <h3>{session.title}</h3>
      <p>Actors can record from these links without signing in. Anyone with a link can view the script and record unapproved lines.</p>
      <p><a href={actorLink(session.id)} target="_blank" rel="noreferrer">Open recorder · whole passage</a></p>
      <input aria-label="Recording session link" readOnly value={actorLink(session.id)} onFocus={(e) => e.target.select()} />
      <ul>{[...new Set(session.lines.flatMap((line) => line.speaker.split('+').map((name) => name.trim())))].map((speaker) => <li key={speaker}>
        <a href={actorLink(session.id, speaker)} target="_blank" rel="noreferrer">Record as {speaker}</a>
        <input aria-label={`Recording link for ${speaker}`} readOnly value={actorLink(session.id, speaker)} onFocus={(e) => e.target.select()} />
      </li>)}</ul>
      <button className="btn-ghost" disabled={busy} onClick={() => run((signal) => open(session.id, signal))}>Refresh takes</button>
      <p className="field-hint">Sessions and takes are saved in PinPlay. You can come back later and load this session. Refresh when actors finish; there is no background polling.</p>
      <ol>{session.lines.map((line) => <li key={line.id} style={{ margin: '1rem 0' }}>
        <p><strong>{line.speaker}</strong>: {line.text}</p>
        <p className="field-hint">{({ todo: 'Awaiting recording', recorded: 'Ready for review', ok: 'Approved', redo: 'Redo requested' })[line.status]}</p>
        <div className="edit-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn-ghost btn-small" disabled={busy || !line.take} onClick={() => run((signal) => previewTake(line, signal))}>Preview take</button>
          <button className="btn-ghost btn-small" disabled={busy || !line.take || preview?.id !== line.id || preview?.dirty} onClick={() => run((signal) => review(line, 'ok', signal))}>Approve take</button>
          <button className="btn-ghost btn-small" disabled={busy || !line.take} onClick={() => run((signal) => review(line, 'redo', signal))}>Request redo</button>
        </div>
        {preview?.id === line.id && <>
          <audio ref={player} src={previewUrl || undefined} controls autoPlay style={{ width: '100%' }} />
          <p className="field-hint">Silence is trimmed automatically. Adjust the start/end in seconds and preview again before approving.</p>
          {['s', 'e'].map((key) => <label key={key} style={{ display: 'inline-block', marginRight: '1rem' }}>
            {key === 's' ? 'Start (seconds)' : 'End (seconds)'}
            <input type="number" min="0" max={preview.duration} step="0.01" value={(trims[line.id]?.[key] ?? 0) / 1000} disabled={busy}
              onChange={(e) => { player.current?.pause(); setTrims((items) => ({ ...items, [line.id]: { ...items[line.id], [key]: Number(e.target.value) * 1000 } })); setPreview((current) => current && ({ ...current, dirty: true })); }} />
          </label>)}
        </>}
      </li>)}</ol>
      {mode === 'notebook' && <label style={{ display: 'block', margin: '1rem 0' }}>
        <input type="checkbox" checked={punctuation} disabled={busy} onChange={(e) => setPunctuation(e.target.checked)} /> Add TTS punctuation cues after the human sentences
      </label>}
      <p className="field-hint">Human speech keeps the actor’s pace. Phrase cuts are estimates: listen and adjust them in the splitting studio.</p>
      <button className="btn-primary" disabled={busy || session.lines.some((line) => line.status !== 'ok' || !line.take)}
        onClick={() => run(importTakes)}>Use approved takes in splitting studio</button>
      <button className="btn-ghost" disabled={busy} onClick={() => { stop(); cache.current.clear(); setSession(null); setTrims({}); }}>Choose another session</button>
    </>}
    <div className="edit-actions"><button className="btn-ghost" disabled={busy} onClick={onCancel}>Back</button></div>
  </section>;
}
