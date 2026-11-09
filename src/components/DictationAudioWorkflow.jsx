import { useState } from 'react';
import AudioSplitStudio from './AudioSplitStudio';
import HumanRecordingSession from './HumanRecordingSession';

export default function DictationAudioWorkflow({ requireServer, title, ...props }) {
  const [source, setSource] = useState('');
  if (source === 'tts') return <AudioSplitStudio {...props} onCancel={() => setSource('')} />;
  if (source === 'human') return <HumanRecordingSession {...props} title={title} requireServer={requireServer} onCancel={() => setSource('')} />;
  return <section className="glass-panel" style={{ maxWidth: 900, margin: '1.5rem auto' }}>
    <h2>Choose the dictation voice</h2>
    <p className="field-hint">Record full sentences, then review the phrase splits. To reuse a recording session, choose Human voices.</p>
    <div className="edit-actions" style={{ flexWrap: 'wrap' }}>
      <button className="btn-primary" disabled={!props.plan.length} onClick={() => { requireServer?.(); setSource('tts'); }}>Generate with TTS</button>
      <button className="btn-primary" onClick={() => setSource('human')}>Human voices · recording sessions</button>
      <button className="btn-ghost" onClick={props.onCancel}>Back</button>
    </div>
  </section>;
}
