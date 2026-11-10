import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AudioSplitStudio from './AudioSplitStudio';
import StudioVoiceFinder from './StudioVoiceFinder';
import { takeRecording } from '../lib/notebookAudio';
import { alignTakes } from '../lib/browserWhisper';
import WordTimingsOption from './WordTimingsOption';
import {
  NARRATOR, STUDIO_LANGUAGE_NAMES, bridgeAvailable, cueLines, defaultDescription,
  describeRecording, dictationScript, finishedLines, formFromRecording, lineId, matchesDictation, planKey,
  rememberRecording, rememberedRecording, studioApi, studioLanguage, studioSettings,
} from '../lib/listeningStudio';

const STUDIO_WARNING = 'Listening Studio voice: phrase cuts were placed at pauses. Listen and adjust them by ear.';
const CHECKS = { ok: '✓ Words match', minor: 'Check by ear', differs: '⚠ Words differ' };

export default function ListeningStudioVoices({ plan, title, lang, mode, onCancel, ...studioProps }) {
  const cues = useMemo(() => cueLines(plan, lang, mode), [plan, lang, mode]);
  const expected = useMemo(() => [...plan.map((part) => part.sentence), ...cues], [plan, cues]);
  const key = useMemo(() => planKey(plan, lang, mode), [plan, lang, mode]);
  const [id, setId] = useState(() => rememberedRecording(key));
  const [reach, setReach] = useState('checking'); // checking | ok | offline | missing
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [library, setLibrary] = useState([]);
  const [form, setForm] = useState(() => formFromRecording(null, lang));
  const [formTouched, setFormTouched] = useState(false);
  const [showVoice, setShowVoice] = useState(true);
  const [timings, setTimings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [audio, setAudio] = useState(null); // { url, label }
  const [ready, setReady] = useState(null);
  const player = useRef(null);
  const controller = useRef(null);
  const language = studioLanguage(lang);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (audio?.url) URL.revokeObjectURL(audio.url); }, [audio]);

  const state = useMemo(() => data ? describeRecording(id, data, status) : null, [id, data, status]);
  const mismatch = !!data && !matchesDictation(data, expected);

  // Status and the recording, together.
  const refresh = useCallback(async (signal) => {
    const [nextStatus, nextData] = await Promise.all([
      studioApi('status', { signal }),
      id ? studioApi(`recordings/${id}`, { signal }).catch((err) => {
        if (err.status === 404 && !err.missing) return null; // deleted in the studio
        throw err;
      }) : null,
    ]);
    setStatus(nextStatus);
    if (id && !nextData) {
      rememberRecording(key, '');
      setId('');
      setData(null);
      setMessage('The earlier Listening Studio recording was deleted there. Make the voice again.');
      return;
    }
    setData(nextData);
  }, [id, key]);

  const connect = useCallback(async ({ quiet = false } = {}) => {
    if (!bridgeAvailable()) { setReach('missing'); return; }
    if (!quiet) { setReach('checking'); setError(''); }
    try {
      setStatus(await studioApi('status'));
      const { voices } = await studioApi('library');
      setLibrary(voices || []);
      setReach('ok');
    } catch (err) {
      setReach(err.missing ? 'missing' : 'offline');
      setError(err.message);
    }
  }, []);
  useEffect(() => { connect(); }, [connect]);
  // start_studio.bat opens this page while the studio is still starting:
  // keep looking for it quietly.
  useEffect(() => {
    if (reach !== 'offline') return undefined;
    const timer = setInterval(() => { if (!document.hidden) connect({ quiet: true }); }, 5000);
    return () => clearInterval(timer);
  }, [reach, connect]);

  // The form follows the recording until the teacher edits it; the voice
  // panel folds away once the voice is approved (and opens on request).
  const shownStage = useRef('');
  useEffect(() => {
    const rec = data?.recording;
    if (!rec) return;
    if (!formTouched) setForm(formFromRecording(rec, lang));
    if (shownStage.current !== rec.stage) {
      shownStage.current = rec.stage;
      setShowVoice(rec.stage !== 'approved');
    }
  }, [data, formTouched, lang]);

  // Follow the recording while this screen is open and visible: every few
  // seconds while the studio works, now and then otherwise (local only).
  const busyStudio = !!state?.busy;
  useEffect(() => {
    if (reach !== 'ok' || !id || ready) return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      if (!document.hidden) {
        try { await refresh(); } catch (err) { if (!stopped) { setError(err.message); if (err.offline) setReach('offline'); } }
      }
      if (!stopped) timer = setTimeout(tick, busyStudio ? 2500 : 8000);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [reach, id, ready, refresh, busyStudio]);

  async function run(action) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true); setError(''); setMessage('');
    try { await action(current.signal); }
    catch (err) { if (!current.signal.aborted) setError(err.message); }
    finally { controller.current = null; if (!current.signal.aborted) setBusy(false); }
  }

  function edit(changes) { setFormTouched(true); setForm((current) => ({ ...current, ...changes })); }

  // A voice chosen in 🌍 Find a voice (just added to the library, or there already).
  async function chooseFoundVoice(voice, added) {
    if (added) {
      const { voices } = await studioApi('library');
      setLibrary(voices || []);
    }
    edit({ source: 'library', libraryVoice: voice.id });
    setMessage(`“${voice.name}” ${added ? 'is now in the voice library and ' : 'is '}chosen for this dictation. Next: make the voice sample.`);
  }

  function request(base = {}) {
    if (form.source === 'find') throw new Error('Choose a voice in the list first (“Use this voice”).');
    const libraryVoice = form.source === 'library' ? form.libraryVoice : '';
    if (form.source === 'library' && !libraryVoice) throw new Error('Choose a voice from the library.');
    const description = form.source === 'library'
      ? data?.recording?.script?.voices?.[NARRATOR]?.description || defaultDescription(lang)
      : form.description;
    const acted = !libraryVoice && form.mode === 'acted';
    const { script, text } = dictationScript({ plan, lang, title: `Dictation · ${title || plan[0]?.sentence.slice(0, 40) || ''}`,
      description, direction: acted ? form.direction : '', cues });
    return { script, text, settings: studioSettings(base, { mode: form.mode, libraryVoice, check: form.check }) };
  }

  async function play(path, label, signal) {
    player.current?.pause();
    const bytes = await studioApi(path, { binary: true, signal });
    setAudio({ url: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })), label });
  }

  // Voice sample first (as in the studio): a long job only once the voice is right.
  const makeVoice = () => run(async (signal) => {
    if (!id) {
      const body = request();
      const { id: created } = await studioApi('recordings', { method: 'POST', body: { ...body, title: body.script.title, make: true }, signal });
      rememberRecording(key, created);
      setFormTouched(false);
      setAudio(null);
      setId(created); // the follow-up effect loads it at once
      return;
    }
    await studioApi(`recordings/${id}`, { method: 'PUT', body: { ...request(data?.recording?.settings), make: 'voices' }, signal });
    setFormTouched(false);
    setAudio(null);
    await refresh(signal);
  });

  const newSample = () => run(async (signal) => {
    const settings = data.recording.settings || {};
    const takes = settings.sampleTakes || {};
    await studioApi(`recordings/${id}`, { method: 'PUT', signal,
      body: { settings: { ...settings, sampleTakes: { ...takes, [NARRATOR]: (Number(takes[NARRATOR]) || 0) + 1 } }, make: 'voices' } });
    setAudio(null);
    await refresh(signal);
  });

  const makeAll = () => run(async (signal) => {
    await studioApi(`recordings/${id}/make`, { method: 'POST', body: { kind: 'all' }, signal });
    setAudio(null);
    await refresh(signal);
  });

  const tryAgain = (index, take) => run(async (signal) => {
    const settings = data.recording.settings || {};
    await studioApi(`recordings/${id}`, { method: 'PUT', signal,
      body: { settings: { ...settings, lineTakes: { ...(settings.lineTakes || {}), [lineId(index)]: take + 1 } }, make: true } });
    setAudio(null);
    await refresh(signal);
  });

  const stopJob = () => run(async (signal) => { await studioApi('stop', { method: 'POST', body: {}, signal }); await refresh(signal); });

  const saveVoice = () => run(async (signal) => {
    const name = `${language} dictation voice · ${form.description.slice(0, 50)}`;
    await studioApi('library/from-recording', { method: 'POST', body: { id, character: NARRATOR, name }, signal });
    const { voices } = await studioApi('library', { signal });
    setLibrary(voices || []);
    setMessage('Saved in the voice library: choose it for your next dictation to keep the same reader.');
  });

  const startOver = () => { rememberRecording(key, ''); setId(''); setData(null); setFormTouched(false); setShowVoice(true); setAudio(null); };

  const openSplitting = () => run(async (signal) => {
    const lines = finishedLines(data, expected);
    player.current?.pause();
    setAudio(null);
    const context = new AudioContext({ sampleRate: 24000 });
    try {
      const buffers = [];
      for (let i = 0; i < lines.length; i++) {
        setMessage(`Loading ${i < plan.length ? `sentence ${i + 1} of ${plan.length}` : 'punctuation cues'}…`);
        const bytes = await studioApi(`recordings/${id}/audio/lines/${lines[i].file}`, { binary: true, signal });
        buffers.push(await context.decodeAudioData(bytes));
      }
      const cueBuffer = (sentence) => {
        const index = cues.indexOf(cueLines([{ sentence }], lang, mode)[0]);
        return index < 0 ? null : buffers[plan.length + index];
      };
      // Word timings from speech recognition in this browser: exact cuts, and
      // no listening check to tick, for every sentence it could follow.
      const found = timings ? await alignTakes(plan.map((part, i) => ({ sentence: part.sentence, buffer: buffers[i] })), lang, { onProgress: setMessage, signal }) : [];
      if (signal.aborted) return;
      setReady(plan.map((part, i) => takeRecording(part, buffers[i], {
        cue: cueBuffer(part.sentence), source: 'studio', boundaries: found[i] || null, warning: found[i] ? '' : STUDIO_WARNING,
      })));
      setMessage('');
    } finally { await context.close(); }
  });

  if (ready) return <AudioSplitStudio {...studioProps} plan={plan} lang={lang} mode={mode}
    initialRecordings={ready} onCancel={() => setReady(null)} />;

  const libraryVoice = library.find((voice) => voice.id === form.libraryVoice);
  const working = busy || state?.busy;
  let lines = [];
  let linesError = '';
  if (state?.phase === 'ready' && !mismatch) {
    try { lines = finishedLines(data, expected); } catch (err) { linesError = err.message; }
  }

  return <section className="glass-panel studio-voices">
    <h2>Listening Studio voices</h2>
    <p className="field-hint">Natural voices made on this computer by PinPlay’s Listening Studio. Describe a reader, pick one from the voice library or find a real voice, approve the voice sample, then every sentence is read in that voice, its words checked, and you adjust the phrase splits by ear.</p>

    {!language && <p className="fetch-error" role="alert">Listening Studio voices speak {STUDIO_LANGUAGE_NAMES.join(', ')}. Choose another voice for this language.</p>}
    {reach === 'checking' && <p role="status">Looking for Listening Studio…</p>}
    {reach === 'missing' && <div role="alert" className="studio-note">
      <p>Listening Studio voices work in the local teacher copy of Dictation, on the computer that has Listening Studio.</p>
      <p className="field-hint">Double-click <strong>start_studio.bat</strong> in the Dictation folder: it starts Listening Studio and opens this page locally.</p>
    </div>}
    {reach === 'offline' && <div role="alert" className="studio-note">
      <p>Listening Studio is not running on this computer.</p>
      <p className="field-hint">Start it with <strong>start_studio.bat</strong> (or PinPlay Listening Studio’s desktop icon). This page keeps looking for it every few seconds.</p>
      <button className="btn-ghost btn-small" onClick={() => connect()}>Check now</button>
    </div>}
    {error && reach === 'ok' && <p className="fetch-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}

    {reach === 'ok' && language && <>
      {mismatch && <div role="alert" className="studio-note">
        <p className="fetch-error">This Listening Studio recording was changed there and no longer reads this dictation’s sentences.</p>
        <button className="btn-ghost btn-small" onClick={startOver}>Start a new recording</button>
      </div>}

      {id && state && !mismatch && <div className="studio-state">
        <p role="status"><strong>{state.text}</strong></p>
        {state.phase === 'working' && <>
          {state.job.total > 0 && <progress max={state.job.total} value={state.job.done} style={{ width: '100%' }} />}
          <p className="field-hint">You can leave this page open and come back: the studio keeps working. Every sentence already made is kept.</p>
          <button className="btn-ghost btn-small" onClick={stopJob} disabled={busy}>Stop</button>
        </>}
        {state.phase === 'voice' && <>
          <div className="edit-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn-ghost btn-small" disabled={busy} onClick={() => run((signal) => play(
              state.voice.own ? `library/${state.voice.own.id}/audio` : `recordings/${id}/audio/voices/${state.voice.sampleKey}.wav`, 'Voice sample', signal))}>▶ Voice sample</button>
            {!state.voice.own && <button className="btn-ghost btn-small" disabled={busy} onClick={newSample}>↻ Another sample</button>}
            {!state.voice.own && <button className="btn-ghost btn-small" disabled={busy} onClick={saveVoice}>Save voice to library</button>}
          </div>
          {state.warning && <p className="edit-warning">{state.warning}</p>}
          <button className="btn-primary" disabled={busy} onClick={makeAll}>Use this voice: read every sentence</button>
          <p className="field-hint">On a typical teacher PC this takes several minutes for a dictation; the page shows the time left.</p>
        </>}
        {state.phase === 'idle' && <button className="btn-primary" disabled={busy}
          onClick={state.stage === 'approved' ? makeAll : () => makeVoice()}>{state.stage === 'approved' ? 'Read every sentence' : 'Make the voice sample'}</button>}
        {['failed', 'stopped', 'stale'].includes(state.phase) && <button className="btn-primary" disabled={busy}
          onClick={state.stage === 'approved' ? makeAll : () => makeVoice()}>{state.phase === 'stale' ? 'Make the sentences again' : 'Continue'}</button>}
      </div>}

      {lines.length > 0 && <>
        <ol className="studio-lines">
          {lines.slice(0, plan.length).map((line, i) => <li key={line.id}>
            <span className="studio-line-text">{line.text}</span>
            <span className={`studio-check studio-check-${line.level || 'none'}`}>{CHECKS[line.level] || 'Not checked'}</span>
            {line.level && line.level !== 'ok' && line.heard && <span className="field-hint studio-heard">Heard: “{line.heard}”</span>}
            <span className="studio-line-actions">
              <button className="btn-ghost btn-small" disabled={busy} onClick={() => run((signal) => play(`recordings/${id}/audio/lines/${line.file}`, `Sentence ${i + 1}`, signal))}>▶ Listen</button>
              <button className="btn-ghost btn-small" disabled={working} title="A new take of this sentence only" onClick={() => tryAgain(i, line.take)}>↻ Try again</button>
            </span>
          </li>)}
        </ol>
        {cues.length > 0 && <p className="field-hint">Punctuation cues in the same voice: {cues.join(' · ')}</p>}
        <WordTimingsOption checked={timings} disabled={working} onChange={setTimings} />
        <button className="btn-primary" disabled={working} onClick={openSplitting}>Review the phrase splits</button>
      </>}
      {linesError && <p className="fetch-error" role="alert">{linesError}</p>}

      {audio && <div className="studio-player">
        <span className="field-hint">{audio.label}</span>
        <audio ref={player} src={audio.url} controls autoPlay style={{ width: '100%' }} />
      </div>}

      {!mismatch && (id && !showVoice
        ? <button className="btn-ghost btn-small" disabled={working} onClick={() => setShowVoice(true)}>Change the voice</button>
        : <fieldset className="studio-voice-form" disabled={working}>
          <legend>The reader’s voice</legend>
          <div className="studio-choice" role="radiogroup" aria-label="Voice source">
            <label><input type="radio" name="voice-source" checked={form.source === 'design'} onChange={() => edit({ source: 'design' })} /> Describe a voice</label>
            <label><input type="radio" name="voice-source" checked={form.source === 'library'} disabled={!library.length} onChange={() => edit({ source: 'library', libraryVoice: form.libraryVoice || library[0]?.id || '' })} /> From the voice library ({library.length ? `${library.length} voice${library.length === 1 ? '' : 's'}` : 'empty'})</label>
            <label><input type="radio" name="voice-source" checked={form.source === 'find'} onChange={() => edit({ source: 'find' })} /> 🌍 Find a real voice (readers from open recordings)</label>
          </div>
          {form.source === 'find' ? <StudioVoiceFinder lang={lang} library={library} onUse={chooseFoundVoice} />
          : form.source === 'design' ? <>
            <label className="field-label">Description
              <textarea rows={3} value={form.description} maxLength={400} onChange={(e) => edit({ description: e.target.value })} />
            </label>
            <p className="field-hint">Gender, age, accent, voice quality and pace. Describe adults as adults (“a woman in her thirties”), or the voice can sound like a child’s.</p>
            <div className="studio-choice" role="radiogroup" aria-label="Voice mode">
              <label><input type="radio" name="voice-mode" checked={form.mode === 'fixed'} onChange={() => edit({ mode: 'fixed' })} /> Fixed voice: the same reader in every sentence</label>
              <label><input type="radio" name="voice-mode" checked={form.mode === 'acted'} onChange={() => edit({ mode: 'acted' })} /> Acted: follows a delivery note, the voice can vary a little</label>
            </div>
            {form.mode === 'acted' && <label className="field-label">Delivery note
              <input value={form.direction} maxLength={200} onChange={(e) => edit({ direction: e.target.value })} />
            </label>}
          </> : <>
            <label className="field-label">Library voice
              <select value={form.libraryVoice} onChange={(e) => edit({ libraryVoice: e.target.value })}>
                {library.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
              </select>
            </label>
            {libraryVoice && <p className="field-hint">{libraryVoice.seconds ? `${libraryVoice.seconds} s sample` : 'Sample'}{libraryVoice.credit ? ` · ${libraryVoice.credit}` : ''}. A library voice is always a fixed voice. Find more with 🌍 Find a real voice, or add your own in Listening Studio (📚 Voice library).</p>}
            <button type="button" className="btn-ghost btn-small" disabled={!form.libraryVoice || busy}
              onClick={() => run((signal) => play(`library/${form.libraryVoice}/audio`, libraryVoice?.name || 'Library voice', signal))}>▶ Listen to this voice</button>
          </>}
          <label className="edit-check"><input type="checkbox" checked={form.check} onChange={(e) => edit({ check: e.target.checked })} /> Check every sentence’s words (and try once more if they differ)</label>
          <p className="field-hint">Speed: these voices read at their own pace, so the voice speed setting does not apply.{form.source === 'design' ? ` Ask for the pace in the description${form.mode === 'acted' ? ' or the delivery note' : ''}.` : ' A library or found voice keeps its reader’s own pace (Find a real voice can filter by pace).'}</p>
          <div className="edit-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn-primary" disabled={busy || !language || form.source === 'find'} onClick={() => makeVoice()}>
              {id ? 'Make the voice again' : 'Make the voice sample'}</button>
            {id && formTouched && <button type="button" className="btn-ghost btn-small" onClick={() => { setFormTouched(false); setForm(formFromRecording(data?.recording, lang)); }}>Undo changes</button>}
            {id && state?.stage === 'approved' && <button type="button" className="btn-ghost btn-small" onClick={() => setShowVoice(false)}>Keep the current voice</button>}
          </div>
        </fieldset>)}
    </>}

    <div className="edit-actions"><button className="btn-ghost" onClick={onCancel} disabled={busy}>Back</button></div>
  </section>;
}
