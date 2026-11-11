import { ttsBase, voiceFailure } from './api';
import { notebookPlan } from './notebook';
import { sentenceEndCue } from './notebookShared';
import { wavClip } from './notebookWav';
import { deliveryFor } from './delivery';
import { sentenceCuts, estimatedCuts, validateCuts, pauseCuts, mergeAll, refineCuts } from './audioSplits';

async function speak(text, { lang, rate, context, signal }) {
  const query = new URLSearchParams({ text, lang, rate });
  const response = await fetch(`${ttsBase()}/api/tts?${query}`, { signal });
  if (!response.ok) throw await voiceFailure(response, 'sentence audio');
  return context.decodeAudioData(await response.arrayBuffer());
}

function punctuationAudio(label, options) {
  const { lang, rate, cueCache } = options;
  const key = `${lang}|${rate}|${label}`;
  if (!cueCache.has(key)) {
    const loading = speak(`${label}.`, options);
    cueCache.set(key, loading);
    loading.catch(() => cueCache.delete(key));
  }
  return cueCache.get(key);
}

// Retain full sentences for previews and adjustments; split only afterwards.
export async function prepareSentenceRecording(sentence, options) {
  const { lang, rate, context, delivery = 'phrases', signal, allowEstimated = false } = options;
  const segments = options.segments || notebookPlan(sentence, lang, delivery)[0].segments;
  let buffer, boundaries;
  if (segments.length > 1) {
    const query = new URLSearchParams({ text: sentence, lang, rate, timings: '1' });
    const response = await fetch(`${ttsBase()}/api/tts?${query}`, { signal });
    if (!response.ok) throw await voiceFailure(response, 'sentence audio');
    const payload = await response.json();
    const bytes = Uint8Array.from(atob(payload.audio), (c) => c.charCodeAt(0));
    buffer = await context.decodeAudioData(bytes.buffer);
    boundaries = payload.boundaries;
  } else buffer = await speak(sentence, options);
  let cuts, warning = '';
  try { cuts = sentenceCuts(segments, boundaries, buffer.duration); }
  catch (error) {
    if (!allowEstimated) throw error;
    cuts = estimatedCuts(segments, buffer.duration);
    warning = error.message;
  }
  // Synthetic voices never dictate punctuation (the pause before a spliced
  // "Period." was too awkward): a cue only when asked for explicitly.
  const label = options.punctuation === true ? sentenceEndCue(sentence, lang) : '';
  const cue = label ? await punctuationAudio(label, { ...options, cueCache: options.cueCache || new Map() }) : null;
  return { sentence, segments, buffer, cuts, cue, warning, boundaries };
}

export function recordingClips(recording) {
  const { buffer, cuts, segments, cue } = recording;
  validateCuts(cuts, segments.length, buffer.duration);
  return segments.map((_, i) => wavClip(buffer, cuts[i], cuts[i + 1], i === segments.length - 1 ? cue : null));
}

// Delivery controls what students hear, independently of the studio's splits.
// Export a whole sentence directly from its reviewed buffer so internal cuts
// add no silence, while keeping the trimmed ends and final punctuation cue.
export function prepareReviewedAudio(recordings, delivery) {
  const selected = delivery === 'sentences' ? recordings.map(mergeAll) : recordings;
  return {
    segments: selected.flatMap((recording) => recording.segments),
    clips: selected.flatMap(recordingClips),
    // The punctuation students hear dictated (grading.js classes): only voice
    // actors' takes carry it; synthetic voices dictate none. Checked
    // punctuation marks exactly this.
    dictatedPunctuation: recordings.find((recording) => typeof recording.dictated === 'string')?.dictated ?? '',
  };
}

export async function prepareNotebookSentence(sentence, options) {
  return recordingClips(await prepareSentenceRecording(sentence, options));
}

export async function prepareNotebook(text, settings, onProgress) {
  const context = new AudioContext({ sampleRate: 24000 });
  const clips = [];
  const cueCache = new Map();
  try {
    const delivery = deliveryFor({ ...settings, mode: 'notebook' });
    const plan = notebookPlan(text, settings.lang, delivery);
    for (let i = 0; i < plan.length; i++) {
      clips.push(...await prepareNotebookSentence(plan[i].sentence, { ...settings, delivery, context, cueCache }));
      onProgress?.(i + 1, plan.length);
    }
    return clips;
  } finally { await context.close(); }
}

// Audio with no word metadata (human takes, Listening Studio voices). Keep
// the grammatical phrase plan and place each cut at the nearest pause. A
// warning asks for a ticked listening check before publishing; human takes
// carry none, because the teacher hears them while splitting anyway.
// With `boundaries` (word timings found by speech recognition, see
// browserWhisper.js) the cuts fall exactly between words, and the studio's
// splits and word moves stay exact; without them, or if they don't fit the
// text, the nearest pause is used.
export function takeRecording(part, buffer, { cue = null, source, warning = '', boundaries = null }) {
  const base = { sentence: part.sentence, segments: part.segments.slice(), buffer, cue, source, warning };
  if (boundaries?.length) {
    try {
      const cuts = refineCuts(sentenceCuts(part.segments, boundaries, buffer.duration), buffer.getChannelData(0), buffer.sampleRate);
      return { ...base, cuts, boundaries, timingsFrom: 'recognition' };
    } catch { /* timings that don't fit the text: fall back to pauses */ }
  }
  return { ...base, cuts: pauseCuts(part.segments, buffer.getChannelData(0), buffer.sampleRate), boundaries: [] };
}

export async function prepareHumanSentenceRecording(part, buffer, options) {
  const label = options.punctuation ? sentenceEndCue(part.sentence, options.lang) : '';
  const cue = label ? await punctuationAudio(label, { ...options, cueCache: options.cueCache || new Map() }) : null;
  return takeRecording(part, buffer, { cue, source: 'human', boundaries: options.boundaries });
}
