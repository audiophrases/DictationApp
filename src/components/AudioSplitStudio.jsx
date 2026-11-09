import { moveSplitWord } from '../lib/audioSplits';
import { sameSegmentPlan } from '../lib/notebookShared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareSentenceRecording, recordingClips } from '../lib/notebookAudio';
import { wavClip } from '../lib/notebookWav';

function Waveform({ buffer, cuts }) {
  const path = useMemo(() => {
    const samples = buffer.getChannelData(0);
    const step = Math.max(1, Math.ceil(samples.length / 600));
    const lines = [];
    for (let i = 0; i < samples.length; i += step) {
      let peak = 0;
      for (let j = i; j < Math.min(i + step, samples.length); j++) peak = Math.max(peak, Math.abs(samples[j]));
      const x = i / samples.length * 600;
      lines.push(`M${x},${40 - peak * 38}V${40 + peak * 38}`);
    }
    return lines.join('');
  }, [buffer]);
  return <svg viewBox="0 0 600 80" role="img" aria-label="Sentence waveform with split markers" style={{ width: '100%', background: 'var(--bg-color)', borderRadius: 8 }}>
    <path d={path} stroke="var(--text-muted)" strokeWidth="1" />
    {cuts.slice(1, -1).map((cut, i) => <g key={i}>
      <line x1={cut / buffer.duration * 600} x2={cut / buffer.duration * 600} y1="0" y2="80" stroke="var(--accent-color, #7c6ff0)" strokeWidth="2" />
      <text x={cut / buffer.duration * 600 + 4} y="14" fill="currentColor" fontSize="12">{i + 1}</text>
    </g>)}
  </svg>;
}

export default function AudioSplitStudio({ plan, lang, rate, mode, onCancel, onAccept, acceptLabel = 'Use audio and create assignment', segmentChangeNotice = '' }) {
  const [recordings, setRecordings] = useState([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [confirmedChange, setConfirmedChange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [url, setUrl] = useState('');
  const player = useRef(null);
  const recording = recordings[index];
  const changedSegments = recordings.some((r) => !sameSegmentPlan(r.originalSegments, r.segments));

  useEffect(() => {
    const controller = new AbortController();
    const context = new AudioContext({ sampleRate: 24000 });
    const cueCache = new Map();
    setRecordings([]); setIndex(0); setLoading(true); setError('');
    (async () => {
      try {
        for (const part of plan) {
          const result = await prepareSentenceRecording(part.sentence, {
            segments: part.segments, lang, rate, context, cueCache,
            punctuation: mode === 'notebook', allowEstimated: true, signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setRecordings((items) => [...items, { ...result, originalCuts: result.cuts.slice(), originalSegments: result.segments.slice(), originalWarning: result.warning, checked: !result.warning }]);
        }
      } catch (err) { if (!controller.signal.aborted) setError(err.message); }
      finally {
        if (context.state !== 'closed') await context.close();
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => { controller.abort(); };
  }, [plan, lang, rate, mode, attempt]);

  useEffect(() => {
    if (!preview) { setUrl(''); return; }
    const next = URL.createObjectURL(preview);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [preview]);

  function stop() { player.current?.pause(); setPreview(null); }
  function update(changes) {
    stop();
    setConfirmedChange(false);
    setRecordings((items) => items.map((item, i) => i === index ? { ...item, ...changes } : item));
  }
  function moveCut(cutIndex, value) {
    const cuts = recording.cuts.slice();
    cuts[cutIndex] = Math.max(cuts[cutIndex - 1] + 0.01, Math.min(cuts[cutIndex + 1] - 0.01, value));
    update({ cuts, checked: !recording.warning });
  }
  function moveWord(splitIndex, direction) {
    try { update(moveSplitWord(recording, splitIndex, direction)); setError(''); }
    catch (err) { setError(err.message); }
  }
  async function accept() {
    setSaving(true); setError(''); stop();
    try {
      await onAccept({ segments: recordings.flatMap((r) => r.segments), clips: recordings.flatMap(recordingClips) });
    } catch (err) { setError(err.message); setSaving(false); }
  }

  return <section className="glass-panel" style={{ maxWidth: 900, margin: '1.5rem auto', padding: '1.5rem' }}>
    <h2>Dictation splitting studio</h2>
    <p className="field-hint">Listen to the full sentence, then check its phrases. The automatic phrases are a starting point. Move words to the previous or next phrase, then fine-tune the timing if needed. Changes use the same recording and preserve its intonation.</p>
    <p role="status">{loading ? `Generating full sentences: ${recordings.length} of ${plan.length}` : `${recordings.length} of ${plan.length} sentences ready`}</p>
    {error && <p className="fetch-error" role="alert">{error}</p>}
    {!loading && recordings.length !== plan.length && <button className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>Retry generation</button>}
    {recording && <>
      <div className="edit-actions" style={{ justifyContent: 'space-between' }}>
        <button className="btn-ghost" disabled={index === 0 || saving} onClick={() => { stop(); setIndex(index - 1); }}>Previous sentence</button>
        <span>Sentence {index + 1} / {plan.length}</span>
        <button className="btn-ghost" disabled={index + 1 >= recordings.length || saving} onClick={() => { stop(); setIndex(index + 1); }}>Next sentence</button>
      </div>
      <p style={{ margin: '1rem 0', fontSize: '1.1rem' }}>{recording.sentence}</p>
      <Waveform buffer={recording.buffer} cuts={recording.cuts} />
      <button className="btn-ghost" disabled={saving} onClick={() => setPreview(wavClip(recording.buffer, 0, recording.buffer.duration))}>Listen to full sentence</button>
      {url && <audio ref={player} src={url} controls autoPlay style={{ width: '100%', margin: '0.75rem 0' }} />}
      <ol style={{ paddingLeft: '1.5rem' }}>
        {recording.segments.map((segment, i) => <li key={i} style={{ margin: '1rem 0' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>{segment}</span>
            <button className="btn-ghost btn-small" disabled={saving} onClick={() => setPreview(recordingClips(recording)[i])}>Listen to phrase {i + 1}</button>
          </div>
          {i < recording.segments.length - 1 && <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <button className="btn-ghost btn-small" disabled={saving || segment.trim().split(/\s+/u).length < 2}
              onClick={() => moveWord(i + 1, -1)}>Move last word to next phrase →</button>
            <button className="btn-ghost btn-small" disabled={saving || recording.segments[i + 1].trim().split(/\s+/u).length < 2}
              onClick={() => moveWord(i + 1, 1)}>← Bring first word from next phrase</button>
          </div>}
          {i < recording.segments.length - 1 && <label style={{ display: 'block', marginTop: '0.5rem' }}>
            Split {i + 1}: {recording.cuts[i + 1].toFixed(2)} s
            <input aria-label={`Split ${i + 1} time in seconds`} type="range" step="0.01"
              min={recording.cuts[i] + 0.01} max={recording.cuts[i + 2] - 0.01}
              value={recording.cuts[i + 1]} disabled={saving}
              onChange={(e) => moveCut(i + 1, Number(e.target.value))} style={{ width: '100%' }} />
          </label>}
        </li>)}
      </ol>
      {recording.segments.length > 1 && <button className="btn-ghost btn-small" disabled={saving} onClick={() => update({ cuts: recording.originalCuts.slice(), segments: recording.originalSegments.slice(), warning: recording.originalWarning, checked: !recording.originalWarning })}>Reset sentence splits</button>}
      {recording.warning && <div role="alert" style={{ margin: '1rem 0' }}>
        <p className="fetch-error">Estimated splits — {recording.warning}</p>
        <label><input type="checkbox" checked={recording.checked} disabled={saving} onChange={(e) => update({ checked: e.target.checked })} /> I listened to every phrase in this sentence and checked the splits.</label>
      </div>}
    </>}
    <p className="field-hint">Keep this page open until saving finishes. {mode === 'notebook' && 'The last phrase includes the spoken punctuation cue.'}</p>
    {changedSegments && segmentChangeNotice && <label style={{ display: 'block', margin: '1rem 0' }}>
      <input type="checkbox" checked={confirmedChange} disabled={saving} onChange={(e) => setConfirmedChange(e.target.checked)} /> {segmentChangeNotice}
    </label>}
    <div className="edit-actions">
      <button className="btn-ghost" onClick={onCancel} disabled={saving}>Back</button>
      <button className="btn-primary" onClick={accept} disabled={saving || loading || (changedSegments && !!segmentChangeNotice && !confirmedChange) || recordings.length !== plan.length || recordings.some((r) => !r.checked)}>
        {saving ? 'Saving audio…' : acceptLabel}
      </button>
    </div>
  </section>;
}
