import { ttsBase, voiceFailure } from './api';
import { notebookPlan } from './notebook';
import { sentenceEndCue } from './notebookShared';
import { wavClip } from './notebookWav';
import { deliveryFor } from './delivery';
import { sentenceCuts, estimatedCuts, validateCuts } from './audioSplits';

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
  const label = options.punctuation === false ? '' : sentenceEndCue(sentence, lang);
  const cue = label ? await punctuationAudio(label, { ...options, cueCache: options.cueCache || new Map() }) : null;
  return { sentence, segments, buffer, cuts, cue, warning, boundaries };
}

export function recordingClips(recording) {
  const { buffer, cuts, segments, cue } = recording;
  validateCuts(cuts, segments.length, buffer.duration);
  return segments.map((_, i) => wavClip(buffer, cuts[i], cuts[i + 1], i === segments.length - 1 ? cue : null));
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

// Human takes have no word metadata. Keep the grammatical phrase plan and
// require an explicit listening review of estimated cuts before publishing.
export async function prepareHumanSentenceRecording(part, buffer, options) {
  const label = options.punctuation ? sentenceEndCue(part.sentence, options.lang) : '';
  const cue = label ? await punctuationAudio(label, { ...options, cueCache: options.cueCache || new Map() }) : null;
  return { sentence: part.sentence, segments: part.segments.slice(), buffer,
    cuts: estimatedCuts(part.segments, buffer.duration), cue, boundaries: [], source: 'human',
    warning: 'Human recording: check that the words match and adjust the estimated phrase cuts by ear.' };
}
