import { useState } from 'react';
import AudioSplitStudio from './AudioSplitStudio';
import HumanRecordingSession from './HumanRecordingSession';
import ListeningStudioVoices from './ListeningStudioVoices';
import { STUDIO_LANGUAGE_NAMES, studioLanguage } from '../lib/listeningStudio';

export default function DictationAudioWorkflow({ requireServer, title, initialSource = '', ...props }) {
  const [source, setSource] = useState(initialSource);
  if (source === 'tts') return <AudioSplitStudio {...props} onCancel={() => setSource('')} />;
  if (source === 'studio') return <ListeningStudioVoices {...props} title={title} onCancel={() => setSource('')} />;
  if (source === 'human') return <HumanRecordingSession {...props} title={title} requireServer={requireServer} onCancel={() => setSource('')} />;
  const studioSpeaks = !!studioLanguage(props.lang);
  return <section className="glass-panel" style={{ maxWidth: 900, margin: '1.5rem auto' }}>
    <h2>Choose the dictation voice</h2>
    <p className="field-hint">Record full sentences, then review the phrase splits. To reuse a recording session, choose Human voices.</p>
    <div className="edit-actions" style={{ flexWrap: 'wrap' }}>
      <button className="btn-primary" disabled={!props.plan.length} onClick={() => { requireServer?.(); setSource('tts'); }}>Generate with TTS</button>
      <button className="btn-primary" disabled={!props.plan.length || !studioSpeaks} onClick={() => setSource('studio')}
        title="Natural voices made on this computer by PinPlay's Listening Studio">Listening Studio voices</button>
      <button className="btn-primary" onClick={() => setSource('human')}>Human voices · recording sessions</button>
      <button className="btn-ghost" onClick={props.onCancel}>Back</button>
    </div>
    <p className="field-hint">
      <strong>Generate with TTS</strong>: Microsoft voices, ready in seconds, with exact word timings for the splits.{' '}
      <strong>Listening Studio voices</strong>: more natural voices described by you, made on this computer (local copy with Listening Studio; several minutes){studioSpeaks ? '.' : ` — ${STUDIO_LANGUAGE_NAMES.join(', ')} only.`}
    </p>
  </section>;
}
