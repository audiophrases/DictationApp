// Re-cutting an assignment's existing recordings the other way round: its
// phrase clips joined back into whole sentences, or its sentence clips opened
// in the splitting studio as phrases. The audio is the teacher's own (a voice
// actor's take, a studio voice), so nothing is synthesised again.
import { notebookPlan } from './notebook';
import { segmentGroups } from './notebookShared';
import { speechBounds } from './audioSplits';
import { takeRecording } from './notebookAudio';

// Each stored clip starts with a short lead-in of silence (notebookWav's
// LEAD_IN) and may end with a pause: when clips are joined into one sentence
// the lead-in of every clip after the first is dropped, so phrases do not
// gain a gap that the actor never left. A little breathing room is kept.
const KEEP_BEFORE = 0.1;

export function joinClips(context, buffers) {
  const sampleRate = buffers[0].sampleRate;
  const parts = buffers.map((buffer, i) => {
    const samples = buffer.getChannelData(0);
    if (i === 0) return samples;
    const [first] = speechBounds(samples, buffer.sampleRate);
    return samples.subarray(Math.floor(Math.max(0, first - KEEP_BEFORE) * buffer.sampleRate));
  });
  const joined = context.createBuffer(1, parts.reduce((n, p) => n + p.length, 0), sampleRate);
  const out = joined.getChannelData(0);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return joined;
}

/**
 * The splitting-studio recordings for reading `sentences` (the assignment's
 * stored sentences or phrases, with `buffers` decoded one per entry) as
 * `delivery`: one recording per sentence, its audio joined from the clips the
 * sentence had, cut into phrases from the language's phrase plan when asked.
 */
export function regroupRecordings(context, sentences, buffers, { lang, delivery }) {
  if (buffers.length !== sentences.length) throw new Error('Every recording is needed to re-cut them.');
  const groups = segmentGroups(sentences);
  const plan = delivery === 'phrases' ? notebookPlan(groups.map((g) => g.sentence).join('\n'), lang, 'phrases') : null;
  if (plan && plan.length !== groups.length) throw new Error('The sentences could not be matched to a phrase plan.');
  return groups.map((group, i) => {
    const buffer = joinClips(context, buffers.slice(group.start, group.start + group.count));
    const segments = plan ? plan[i].segments : [group.sentence];
    return takeRecording({ sentence: group.sentence, segments }, buffer, { source: 'reused' });
  });
}
