// Turning a passage into an assignment: record every sentence once, up front.
//
// This is the step that makes a hidden dictation possible. If students
// synthesized audio as they went, the sentence text would have to travel to
// their browser to be spoken — the exact thing an assignment must not do. So
// the teacher's browser does all the synthesis at creation time, uploads the
// clips, and students afterwards ask for "sentence 3" and get back an MP3.
//
// It costs the teacher a wait of a few seconds per sentence, once, and every
// student thereafter plays audio straight out of R2 with no TTS call at all.
import { ttsBase } from './api';
import { uploadSentenceAudio } from './assignmentApi';
import { prepareNotebookSentence } from './notebookAudio';
import { notebookPlan } from './notebook';

// Two at a time: enough to hide the round-trip latency, gentle enough that a
// just-woken free-tier server isn't hit with twenty synthesis jobs at once.
const CONCURRENCY = 2;

async function synthesize(text, lang, rate) {
  const url = `${ttsBase()}/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}&rate=${encodeURIComponent(rate)}`;
  // No timeout on purpose: the first call of the day may be waiting on Render
  // to wake up, which the caller covers with the waking overlay.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The voice server refused sentence audio (${res.status}).`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('The voice server returned empty audio.');
  return blob;
}

/**
 * Records and uploads the given sentence indexes, two at a time.
 *
 * Failures are collected rather than thrown: one sentence that wouldn't
 * synthesize shouldn't discard the twelve that did, so the caller can retry
 * just the stragglers by passing them back as `only`.
 *
 * Returns the indexes that did not make it.
 */
export async function recordSentences(code, sentences, { lang, rate, only, onSettled, mode, text }) {
  if (mode === 'notebook') {
    const plan = notebookPlan(text, lang);
    if (JSON.stringify(plan.flatMap((part) => part.segments)) !== JSON.stringify(sentences)) {
      throw new Error('The assignment server uses a different segment plan. Update it and create the assignment again.');
    }
    const context = new AudioContext({ sampleRate: 24000 });
    const wanted = new Set(only || sentences.map((_, i) => i));
    const failed = [];
    const cueCache = new Map();
    let offset = 0;
    try {
      for (const part of plan) {
        const indexes = part.segments.map((_, i) => offset + i).filter((i) => wanted.has(i));
        offset += part.segments.length;
        if (!indexes.length) continue;
        let clips;
        try {
          clips = await prepareNotebookSentence(part.sentence, { lang, rate, context, cueCache });
        } catch (error) {
          for (const index of indexes) { failed.push(index); onSettled?.(index, error); }
          continue;
        }
        for (const index of indexes) {
          try {
            await uploadSentenceAudio(code, index, clips[index - (offset - part.segments.length)]);
            onSettled?.(index, null);
          } catch (error) { failed.push(index); onSettled?.(index, error); }
        }
      }
    } finally { await context.close(); }
    return failed;
  }
  const queue = (only || sentences.map((_, i) => i)).slice();
  const failed = [];

  async function drain() {
    while (queue.length) {
      const index = queue.shift();
      try {
        const blob = await synthesize(sentences[index], lang, rate);
        await uploadSentenceAudio(code, index, blob);
        onSettled?.(index, null);
      } catch (error) {
        failed.push(index);
        onSettled?.(index, error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, drain));
  return failed.sort((a, b) => a - b);
}
