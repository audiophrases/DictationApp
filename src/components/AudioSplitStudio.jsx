import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { mergeAll, mergeSplit, moveSplitWord, splitSegment, trimSilence } from '../lib/audioSplits';
import { sameSegmentPlan } from '../lib/notebookShared';
import { prepareSentenceRecording, prepareReviewedAudio, recordingClips } from '../lib/notebookAudio';
import { wavClip } from '../lib/notebookWav';

const wordsOf = (text) => text.trim().split(/\s+/u).filter(Boolean);
// The pause between phrases when playing them in order, as a student would
// hear them one after another (they type in between; this is just a sense of
// how each phrase sounds on its own).
const GAP_MS = 900;

// The sentence's waveform. Drag a split marker to move it; click a phrase to
// hear it. The sliders below remain the keyboard-accessible controls.
function Waveform({ buffer, cuts, disabled, onMove, onPlay }) {
  const box = useRef(null);
  const drag = useRef(null);
  const path = useMemo(() => {
    const samples = buffer.getChannelData(0);
    const step = Math.max(1, Math.ceil(samples.length / 600));
    const lines = [];
    for (let i = 0; i < samples.length; i += step) {
      let peak = 0;
      for (let j = i; j < Math.min(i + step, samples.length); j++) peak = Math.max(peak, Math.abs(samples[j]));
      lines.push(`M${i / samples.length * 600},${40 - peak * 38}V${40 + peak * 38}`);
    }
    return lines.join('');
  }, [buffer]);
  const percent = (time) => `${time / buffer.duration * 100}%`;
  const timeAt = (clientX) => {
    const rect = box.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * buffer.duration;
  };
  return <div ref={box} className="split-wave"
    onPointerMove={(e) => { if (drag.current) { drag.current.moved = true; onMove(drag.current.index, timeAt(e.clientX)); } }}
    onPointerUp={() => { setTimeout(() => { drag.current = null; }); }}
    onPointerCancel={() => { drag.current = null; }}
    onClick={(e) => {
      if (drag.current?.moved || disabled) return;
      const time = timeAt(e.clientX);
      const phrase = cuts.findIndex((cut, i) => i < cuts.length - 1 && time >= cut && time < cuts[i + 1]);
      if (phrase >= 0) onPlay(phrase);
    }}>
    <svg viewBox="0 0 600 80" preserveAspectRatio="none" role="img" aria-label="Sentence waveform with split markers">
      {cuts.slice(0, -1).map((cut, i) => <rect key={i} x={cut / buffer.duration * 600} y="0" height="80"
        width={(cuts[i + 1] - cut) / buffer.duration * 600} className={i % 2 ? 'split-region-b' : 'split-region-a'} />)}
      <path d={path} stroke="var(--text-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {/* Discarded audio outside the sentence's start and end. */}
      {cuts[0] > 0 && <rect x="0" y="0" height="80" width={cuts[0] / buffer.duration * 600} className="split-discard" />}
      {cuts.at(-1) < buffer.duration && <rect x={cuts.at(-1) / buffer.duration * 600} y="0" height="80" width={(buffer.duration - cuts.at(-1)) / buffer.duration * 600} className="split-discard" />}
    </svg>
    {cuts.slice(0, -1).map((cut, i) => <span key={i} className="split-wave-label" style={{ left: percent((cut + cuts[i + 1]) / 2) }}>{i + 1}</span>)}
    {cuts.map((cut, i) => {
      const edge = i === 0 ? 'start' : i === cuts.length - 1 ? 'end' : '';
      return <span key={i} className={`split-marker${edge ? ` split-edge split-edge-${edge}` : ''}`} style={{ left: percent(cut) }}
        title={edge ? `Drag the ${edge} of the sentence: audio ${edge === 'start' ? 'before' : 'after'} it is discarded` : `Drag split ${i}`} aria-hidden="true"
        onPointerDown={(e) => {
          if (disabled) return;
          e.stopPropagation();
          drag.current = { index: i, moved: false };
          box.current.setPointerCapture(e.pointerId);
        }} />;
    })}
  </div>;
}

export default function AudioSplitStudio({ plan, lang, rate, mode, delivery = 'phrases', onCancel, onAccept, acceptLabel = 'Use audio and create assignment', segmentChangeNotice = '', initialRecordings = null, backLabel = 'Back', planChanged = false }) {
  const [recordings, setRecordings] = useState([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [confirmedChange, setConfirmedChange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null); // { blob, label, queue }
  const [url, setUrl] = useState('');
  const [splitting, setSplitting] = useState(-1); // the phrase whose word gaps are shown
  const player = useRef(null);
  const sequence = useRef(0);
  const recording = recordings[index];
  // planChanged: the recordings already arrived re-cut (phrases ↔ sentences),
  // so what students answer changes even if nothing moves here.
  const changedSegments = planChanged || (delivery !== 'sentences' && recordings.some((r) => !sameSegmentPlan(r.originalSegments, r.segments)));
  const phraseCount = recordings.reduce((n, r) => n + r.segments.length, 0);
  const originalCount = recordings.reduce((n, r) => n + r.originalSegments.length, 0);

  useEffect(() => {
    // Recordings handed back from an earlier visit keep their edits, their
    // automatic starting point (for Reset) and what was checked by ear.
    const fresh = (result) => ({ ...result,
      originalCuts: result.originalCuts || result.cuts.slice(),
      originalSegments: result.originalSegments || result.segments.slice(),
      originalWarning: 'originalWarning' in result ? result.originalWarning : result.warning,
      checked: result.checked ?? !result.warning });
    if (initialRecordings) {
      setRecordings(initialRecordings.map(fresh));
      setIndex(0); setLoading(false); setError('');
      return;
    }
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
          setRecordings((items) => [...items, fresh(result)]);
        }
      } catch (err) { if (!controller.signal.aborted) setError(err.message); }
      finally {
        if (context.state !== 'closed') await context.close();
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => { controller.abort(); };
  }, [plan, lang, rate, mode, attempt, initialRecordings]);

  const previewBlob = preview?.blob;
  useEffect(() => {
    if (!previewBlob) { setUrl(''); return; }
    const next = URL.createObjectURL(previewBlob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [previewBlob]);

  function stop() { sequence.current += 1; player.current?.pause(); setPreview(null); }
  function listen(blob, label) { sequence.current += 1; player.current?.pause(); setPreview({ blob, label, queue: [] }); }
  function playInOrder() {
    const clips = recordingClips(recording);
    sequence.current += 1;
    player.current?.pause();
    setPreview({ blob: clips[0], label: `Phrase 1 of ${clips.length}`, queue: clips.slice(1), total: clips.length });
  }
  function ended() {
    if (!preview?.queue?.length) return;
    const token = sequence.current;
    const [blob, ...queue] = preview.queue;
    setTimeout(() => {
      if (sequence.current !== token) return;
      setPreview({ ...preview, blob, queue, label: `Phrase ${preview.total - queue.length} of ${preview.total}` });
    }, GAP_MS);
  }

  function goTo(next) { stop(); setSplitting(-1); setIndex(next); }
  function update(changes) {
    stop();
    // Moving a split in time keeps the words where they are: only a changed
    // phrase plan needs the teacher to confirm again.
    if (changes.segments) setConfirmedChange(false);
    setRecordings((items) => items.map((item, i) => i === index ? { ...item, ...changes } : item));
  }
  function change(edit) {
    try { update(edit(recording)); setError(''); setSplitting(-1); }
    catch (err) { setError(err.message); }
  }
  function moveCut(cutIndex, value) {
    const cuts = recording.cuts.slice();
    const lo = cutIndex === 0 ? 0 : cuts[cutIndex - 1] + 0.01;
    const hi = cutIndex === cuts.length - 1 ? recording.buffer.duration : cuts[cutIndex + 1] - 0.01;
    cuts[cutIndex] = Math.max(lo, Math.min(hi, value));
    update({ cuts, checked: !recording.warning });
  }
  const discarded = recording ? { start: recording.cuts[0], end: recording.buffer.duration - recording.cuts.at(-1) } : null;
  async function accept() {
    setSaving(true); setError(''); stop();
    try {
      await onAccept(prepareReviewedAudio(recordings, delivery));
    } catch (err) { setError(err.message); setSaving(false); }
  }

  const phrases = recording?.segments.length || 0;
  const unchecked = recordings.filter((r) => !r.checked).length;

  return <section className="glass-panel split-studio">
    <h2>Dictation splitting studio</h2>
    <p className="field-hint">Listen to each sentence and its phrases. The automatic phrases are only a starting point: merge phrases that sound better together, split a long one between two words, move words across a split, and drag a split on the waveform to fine-tune the timing. Every change reuses the same recording, so the intonation is kept.</p>
    <p role="status">{loading ? `Generating full sentences: ${recordings.length} of ${plan.length}` : `${recordings.length} of ${plan.length} sentences ready`}
      {!loading && recordings.length > 0 && ` · ${phraseCount} phrase${phraseCount === 1 ? '' : 's'}${phraseCount !== originalCount ? ` (was ${originalCount})` : ''}`}
      {unchecked > 0 && ` · ${unchecked} to check by ear`}</p>
    {error && <p className="fetch-error" role="alert">{error}</p>}
    {!loading && recordings.length !== plan.length && <button className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>Retry generation</button>}
    {recordings.length > 1 && <nav className="sentence-pills" aria-label="Sentences">
      {recordings.map((r, i) => <button key={i} className={`sentence-pill${i === index ? ' is-current' : ''}${r.checked ? '' : ' needs-check'}`}
        aria-current={i === index ? 'true' : undefined} disabled={saving} onClick={() => goTo(i)}
        title={`Sentence ${i + 1}: ${r.segments.length} phrase${r.segments.length === 1 ? '' : 's'}${r.checked ? '' : ' · check by ear'}`}>
        {i + 1}{!r.checked && <span aria-label=" (check by ear)"> ⚠</span>}
      </button>)}
    </nav>}
    {recording && <>
      <div className="edit-actions" style={{ justifyContent: 'space-between' }}>
        <button className="btn-ghost" disabled={index === 0 || saving} onClick={() => goTo(index - 1)}>Previous sentence</button>
        <span>Sentence {index + 1} / {plan.length} · {phrases} phrase{phrases === 1 ? '' : 's'}</span>
        <button className="btn-ghost" disabled={index + 1 >= recordings.length || saving} onClick={() => goTo(index + 1)}>Next sentence</button>
      </div>
      <p className="split-sentence">{recording.sentence}</p>
      <Waveform buffer={recording.buffer} cuts={recording.cuts} disabled={saving}
        onMove={(cutIndex, time) => moveCut(cutIndex, time)}
        onPlay={(i) => listen(recordingClips(recording)[i], `Phrase ${i + 1}`)} />
      <div className="edit-actions split-toolbar">
        <button className="btn-ghost btn-small" disabled={saving} onClick={() => listen(wavClip(recording.buffer, recording.cuts[0], recording.cuts.at(-1)), 'Full sentence')}>▶ Full sentence</button>
        <button className="btn-ghost btn-small" disabled={saving} title="Discard the silence before the first sound and after the last"
          onClick={() => change(trimSilence)}>Trim silence at the ends</button>
        {phrases > 1 && <button className="btn-ghost btn-small" disabled={saving} onClick={playInOrder}>▶ Phrases in order</button>}
        {phrases > 1 && <button className="btn-ghost btn-small" disabled={saving} onClick={() => change(mergeAll)}>Merge into one phrase</button>}
        <button className="btn-ghost btn-small" disabled={saving || (sameSegmentPlan(recording.originalSegments, recording.segments) && recording.cuts.every((cut, i) => cut === recording.originalCuts[i]))}
          onClick={() => update({ cuts: recording.originalCuts.slice(), segments: recording.originalSegments.slice(), warning: recording.originalWarning, checked: !recording.originalWarning })}>Reset sentence</button>
      </div>
      <div className="split-ends">
        {[['start', 0], ['end', recording.cuts.length - 1]].map(([edge, index]) => <label key={edge} className="split-slider">
          {edge === 'start' ? 'Start' : 'End'}: {recording.cuts[index].toFixed(2)} s
          {discarded[edge] > 0.005 ? ` · ${discarded[edge].toFixed(2)} s discarded ${edge === 'start' ? 'before' : 'after'}` : ''}
          <input aria-label={`Sentence ${edge} in seconds`} type="range" step="0.01" min="0" max={recording.buffer.duration}
            value={recording.cuts[index]} disabled={saving} onChange={(e) => moveCut(index, Number(e.target.value))} />
        </label>)}
      </div>
      <p className="field-hint">Audio before the start or after the end is left out: move them in to drop a long silence or a bump at the beginning.</p>
      {/* url lags preview by one render (it is made in an effect). */}
      {url && preview && <div className="studio-player">
        <span className="field-hint">{preview.label}{preview.queue?.length ? ' · next phrase follows' : ''}</span>
        <audio ref={player} src={url} controls autoPlay onEnded={ended} style={{ width: '100%' }} />
      </div>}
      <ol className="split-phrases">
        {recording.segments.map((segment, i) => {
          const words = wordsOf(segment);
          const next = recording.segments[i + 1];
          return <li key={i}>
            <div className="split-phrase">
              <span className="split-phrase-number">{i + 1}</span>
              <span className="split-phrase-text">{splitting === i
                ? words.map((word, j) => <Fragment key={j}>
                  {j > 0 && <button className="split-gap" disabled={saving} aria-label={`Split before “${word}”`}
                    title="Split here" onClick={() => change((r) => splitSegment(r, i, j))}>✂</button>}
                  <span>{word}</span>
                </Fragment>)
                : segment}</span>
              <span className="split-phrase-actions">
                <button className="btn-ghost btn-small" disabled={saving} onClick={() => listen(recordingClips(recording)[i], `Phrase ${i + 1}`)}>▶ Listen</button>
                {words.length > 1 && <button className={`btn-ghost btn-small${splitting === i ? ' is-active' : ''}`} disabled={saving}
                  aria-pressed={splitting === i} onClick={() => setSplitting(splitting === i ? -1 : i)}>{splitting === i ? 'Cancel split' : '✂ Split'}</button>}
              </span>
            </div>
            {splitting === i && <p className="field-hint">Click ✂ between two words to start a new phrase there.</p>}
            {next !== undefined && <div className="split-boundary">
              <div className="split-boundary-actions">
                <button className="btn-ghost btn-small" disabled={saving} title={`Join phrases ${i + 1} and ${i + 2}`}
                  onClick={() => change((r) => mergeSplit(r, i + 1))}>Merge with next ⤵</button>
                <button className="btn-ghost btn-small" disabled={saving || words.length < 2}
                  onClick={() => change((r) => moveSplitWord(r, i + 1, -1))}>Last word to next →</button>
                <button className="btn-ghost btn-small" disabled={saving || wordsOf(next).length < 2}
                  onClick={() => change((r) => moveSplitWord(r, i + 1, 1))}>← First word from next</button>
              </div>
              <label className="split-slider">
                Split {i + 1}: {recording.cuts[i + 1].toFixed(2)} s
                <input aria-label={`Split ${i + 1} time in seconds`} type="range" step="0.01"
                  min={recording.cuts[i] + 0.01} max={recording.cuts[i + 2] - 0.01}
                  value={recording.cuts[i + 1]} disabled={saving}
                  onChange={(e) => moveCut(i + 1, Number(e.target.value))} />
              </label>
            </div>}
          </li>;
        })}
      </ol>
      {recording.warning && <div role="alert" className="studio-note">
        <p className="split-check">Check by ear — {recording.warning}</p>
        <label><input type="checkbox" checked={recording.checked} disabled={saving} onChange={(e) => update({ checked: e.target.checked })} /> I listened to every phrase in this sentence and checked the splits.</label>
      </div>}
    </>}
    <p className="field-hint">Keep this page open until saving finishes. {recording?.cue && 'The last phrase includes the spoken punctuation cue.'}</p>
    {delivery === 'sentences' && <p className="studio-note" role="note">Students hear one complete sentence at a time. Phrase splits are joined when you save.</p>}
    {changedSegments && segmentChangeNotice && <label style={{ display: 'block', margin: '1rem 0' }}>
      <input type="checkbox" checked={confirmedChange} disabled={saving} onChange={(e) => setConfirmedChange(e.target.checked)} /> {segmentChangeNotice}
    </label>}
    <div className="edit-actions">
      <button className="btn-ghost" onClick={() => { stop(); onCancel(loading ? null : recordings); }} disabled={saving}>{backLabel}</button>
      <button className="btn-primary" onClick={accept} disabled={saving || loading || (changedSegments && !!segmentChangeNotice && !confirmedChange) || recordings.length !== plan.length || recordings.some((r) => !r.checked)}>
        {saving ? 'Saving audio…' : acceptLabel}
      </button>
    </div>
  </section>;
}
