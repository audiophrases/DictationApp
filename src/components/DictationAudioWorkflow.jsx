import { useEffect, useState } from 'react';
import AudioSplitStudio from './AudioSplitStudio';
import HumanRecordingSession from './HumanRecordingSession';
import ListeningStudioVoices from './ListeningStudioVoices';
import { STUDIO_LANGUAGE_NAMES, studioLanguage } from '../lib/listeningStudio';

// The assignment's own recordings, loaded and re-cut for the studio (see
// reuseAudio.js): nothing is synthesised, the actor's voice stays.
function ReuseRecordings({ load, onCancel, ...props }) {
  const [state, setState] = useState({ recordings: null, progress: 'Loading the recordings…', error: '' });
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal, (progress) => { if (!controller.signal.aborted) setState((s) => ({ ...s, progress })); })
      .then((recordings) => { if (!controller.signal.aborted) setState({ recordings, progress: '', error: '' }); })
      .catch((err) => { if (!controller.signal.aborted) setState({ recordings: null, progress: '', error: err.message }); });
    return () => controller.abort();
  }, [load]);
  if (state.recordings) {
    const plan = state.recordings.map((r) => ({ sentence: r.sentence, segments: r.segments.slice() }));
    return <AudioSplitStudio {...props} plan={plan} initialRecordings={state.recordings} onCancel={onCancel} />;
  }
  return <section className="glass-panel" style={{ maxWidth: 900, margin: '1.5rem auto' }}>
    <h2>Keeping the current recordings</h2>
    {state.error ? <p className="fetch-error" role="alert">{state.error}</p> : <p role="status">{state.progress}</p>}
    <div className="edit-actions"><button className="btn-ghost" onClick={onCancel}>Back</button></div>
  </section>;
}

export default function DictationAudioWorkflow({ requireServer, title, initialSource = '', reuse = null, ...props }) {
  const [source, setSource] = useState(initialSource);
  if (source === 'tts') return <AudioSplitStudio {...props} onCancel={() => setSource('')} />;
  if (source === 'reuse' && reuse) return <ReuseRecordings {...props} load={reuse.load} onCancel={() => setSource('')} />;
  if (source === 'studio') return <ListeningStudioVoices {...props} title={title} onCancel={() => setSource('')} />;
  if (source === 'human') return <HumanRecordingSession {...props} title={title} requireServer={requireServer} onCancel={() => setSource('')} />;
  const studioSpeaks = !!studioLanguage(props.lang);
  return <section className="glass-panel" style={{ maxWidth: 900, margin: '1.5rem auto' }}>
    <h2>Choose the dictation voice</h2>
    <p className="field-hint">Record full sentences, then review the phrase splits. To reuse a recording session, choose Human voices.</p>
    <div className="edit-actions" style={{ flexWrap: 'wrap' }}>
      {reuse && <button className="btn-primary" onClick={() => setSource('reuse')} title={reuse.title}>{reuse.label}</button>}
      <button className="btn-primary" disabled={!props.plan.length} onClick={() => { requireServer?.(); setSource('tts'); }}>Generate with TTS</button>
      <button className="btn-primary" disabled={!props.plan.length || !studioSpeaks} onClick={() => setSource('studio')}
        title="Natural voices made on this computer by PinPlay's Listening Studio">Listening Studio voices</button>
      <button className="btn-primary" onClick={() => setSource('human')}>Human voices · recording sessions</button>
      <button className="btn-ghost" onClick={props.onCancel}>Back</button>
    </div>
    <p className="field-hint">
      {reuse && <><strong>{reuse.label}</strong>: {reuse.hint}{' '}</>}
      <strong>Generate with TTS</strong>: Microsoft voices, ready in seconds, with exact word timings for the splits.{' '}
      <strong>Listening Studio voices</strong>: more natural voices described by you, made on this computer (local copy with Listening Studio; several minutes){studioSpeaks ? '.' : ` — ${STUDIO_LANGUAGE_NAMES.join(', ')} only.`}
    </p>
  </section>;
}
