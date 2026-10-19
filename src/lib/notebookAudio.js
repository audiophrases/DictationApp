import { ttsBase } from './api';
import { notebookPlan } from './notebook';
import { segmentTimes, sentenceEndCue } from './notebookShared';
import { wavClip } from './notebookWav';

async function punctuationAudio(label, { lang, rate, context, cueCache }) {
  const key = `${lang}|${rate}|${label}`;
  if (!cueCache.has(key)) {
    const loading = (async () => {
      const query = new URLSearchParams({ text: `${label}.`, lang, rate });
      const response = await fetch(`${ttsBase()}/api/tts?${query}`);
      if (!response.ok) throw new Error(`Could not record the punctuation cue (${response.status}). Please try again.`);
      return context.decodeAudioData(await response.arrayBuffer());
    })();
    cueCache.set(key, loading);
    loading.catch(() => cueCache.delete(key));
  }
  return cueCache.get(key);
}

export async function prepareNotebookSentence(sentence, { lang, rate, context, cueCache = new Map() }) {
  const query = new URLSearchParams({ text: sentence, lang, rate, timings: '1' });
  const response = await fetch(`${ttsBase()}/api/tts?${query}`);
  if (!response.ok) throw new Error(`Could not record notebook audio (${response.status}). Please try again.`);
  const data = await response.json();
  const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
  const buffer = await context.decodeAudioData(bytes.buffer);
  // Decide the segments after the complete natural sentence has been recorded.
  const [{ segments }] = notebookPlan(sentence, lang);
  const label = sentenceEndCue(sentence, lang);
  const cue = label ? await punctuationAudio(label, { lang, rate, context, cueCache }) : null;
  return segmentTimes(segments, data.boundaries, buffer.duration)
    .map(([start, end], index) => wavClip(buffer, start, end, index === segments.length - 1 ? cue : null));
}

export async function prepareNotebook(text, settings, onProgress) {
  const context = new AudioContext({ sampleRate: 24000 });
  const clips = [];
  const cueCache = new Map();
  try {
    const plan = notebookPlan(text, settings.lang);
    for (let i = 0; i < plan.length; i++) {
      clips.push(...await prepareNotebookSentence(plan[i].sentence, { ...settings, context, cueCache }));
      onProgress?.(i + 1, plan.length);
    }
    return clips;
  } finally {
    await context.close();
  }
}
