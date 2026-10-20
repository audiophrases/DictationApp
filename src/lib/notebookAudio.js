import { ttsBase } from './api';
import { notebookPlan } from './notebook';
import { sentenceEndCue, spokenPhrase } from './notebookShared';
import { wavClip } from './notebookWav';

async function speak(text, { lang, rate, context }) {
  const query = new URLSearchParams({ text, lang, rate });
  const response = await fetch(`${ttsBase()}/api/tts?${query}`);
  if (!response.ok) throw new Error(`Could not record notebook audio (${response.status}). Please try again.`);
  return context.decodeAudioData(await response.arrayBuffer());
}

function punctuationAudio(label, { lang, rate, context, cueCache }) {
  const key = `${lang}|${rate}|${label}`;
  if (!cueCache.has(key)) {
    const loading = speak(`${label}.`, { lang, rate, context });
    cueCache.set(key, loading);
    loading.catch(() => cueCache.delete(key));
  }
  return cueCache.get(key);
}

// Each phrase is recorded on its own. Cutting one recording of the whole
// sentence at the voice's word timings clipped word endings: in natural speech
// the words run together with ~10 ms between them, so there is no silence to
// cut in, and Edge's voices refuse SSML <break> tags that would make one.
export async function prepareNotebookSentence(sentence, { lang, rate, context, cueCache = new Map() }) {
  const [{ segments }] = notebookPlan(sentence, lang);
  const label = sentenceEndCue(sentence, lang);
  const [cue, ...buffers] = await Promise.all([
    label ? punctuationAudio(label, { lang, rate, context, cueCache }) : null,
    ...segments.map((phrase, i) => speak(spokenPhrase(phrase, i === segments.length - 1), { lang, rate, context })),
  ]);
  return buffers.map((buffer, i) => wavClip(buffer, 0, buffer.duration, i === buffers.length - 1 ? cue : null));
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
