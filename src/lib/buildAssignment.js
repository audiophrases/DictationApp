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
import { ttsBase, voiceFailure } from './api';
import { uploadSentenceAudio } from './assignmentApi';
import { prepareNotebookSegment, prepareNotebookSentence } from './notebookAudio';
import { notebookPlan } from './notebook';
import { deliveryFor } from './delivery';
import { sameSegmentPlan, segmentGroups } from './notebookShared';

// Two at a time: enough to hide the round-trip latency, gentle enough that a
// just-woken free-tier server isn't hit with twenty synthesis jobs at once.
const CONCURRENCY = 2;

async function synthesize(text, lang, rate) {
  const url = `${ttsBase()}/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}&rate=${encodeURIComponent(rate)}`;
  // No timeout on purpose: the first call of the day may be waiting on Render
  // to wake up, which the caller covers with the waking overlay.
  const res = await fetch(url);
  if (!res.ok) throw await voiceFailure(res, 'sentence audio');
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
export async function recordSentences(code, sentences, { lang, rate, only, onSettled, mode, text, delivery: selectedDelivery }) {
  const delivery = deliveryFor({ mode, delivery: selectedDelivery });
  const plan = notebookPlan(text, lang, delivery);
  if (!sameSegmentPlan(plan.flatMap((part) => part.segments), sentences)) {
    throw new Error('The assignment server returned different phrases or sentences. Deploy the current assignment Worker, then create the assignment again.');
  }
  if (mode === 'notebook') {
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
          clips = await prepareNotebookSentence(part.sentence, { lang, rate, context, cueCache, delivery });
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

/**
 * Records an existing assignment's stored segments again — all of them, or
 * just `only` — exactly as they are, without splitting the text again (see
 * segmentGroups). Same contract as recordSentences: returns the indexes that
 * did not make it.
 */
export async function rerecordSegments(code, segments, { lang, rate, mode, only, onSettled }) {
  const wanted = (only || segments.map((_, i) => i)).slice().sort((a, b) => a - b);
  const failed = [];
  if (mode !== 'notebook') {
    const queue = wanted.slice();
    async function drain() {
      while (queue.length) {
        const index = queue.shift();
        try {
          await uploadSentenceAudio(code, index, await synthesize(segments[index], lang, rate));
          onSettled?.(index, null);
        } catch (error) { failed.push(index); onSettled?.(index, error); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, drain));
    return failed.sort((a, b) => a - b);
  }
  const groups = segmentGroups(segments);
  const context = new AudioContext({ sampleRate: 24000 });
  const cueCache = new Map();
  try {
    for (const index of wanted) {
      const group = groups.find((g) => index >= g.start && index < g.start + g.count);
      try {
        const clip = await prepareNotebookSegment(segments[index], {
          endsSentence: index === group.start + group.count - 1,
          sentence: group.sentence, lang, rate, context, cueCache,
        });
        await uploadSentenceAudio(code, index, clip);
        onSettled?.(index, null);
      } catch (error) { failed.push(index); onSettled?.(index, error); }
    }
  } finally { await context.close(); }
  return failed;
}
