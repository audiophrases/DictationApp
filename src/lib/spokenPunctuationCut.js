// Cutting spoken punctuation out of a voice actor's take, by the policy in
// force (punctuationPolicy.js). The actor read the line with its bracket
// notes, so the words said are known (spokenScript); the recogniser's words
// are aligned to all of them, which also times the punctuation words. A note
// is cut only when every one of its words was actually heard: a guess would
// risk cutting speech. The sentence's own words come back as boundaries in
// the new recording's time.
import { spokenScript } from './spokenPunctuation.js';
import { alignedTimings } from './wordAlignment.js';
import { quietestNear } from './audioSplits.js';

const LEAD = 0.04; // seconds kept before a cut word's start…
const TAIL = 0.04; // …and after its end, so no consonant is clipped
export const GAP = 0.15; // silence left where an inner mark was, so the rhythm survives
// The recogniser's word spans are shorter than the words (measured: "semicolon"
// heard over 0.46 s of 0.65 s said), so a cut on them would leave slivers of
// the word. With the audio at hand, each removal widens to the quietest
// moment between the note and the word before it, and between the note and
// the word after it: the cut runs from gap to gap.
const REACH = 0.35;

const keeps = (policy, kind) => (kind === 'end' ? policy.ends : kind === 'inner' ? policy.inner
  : kind === 'paragraph' ? policy.paragraph : kind === 'endParagraph' ? policy.ends : true);

/**
 * What to cut from a take, and where the sentence's words are. Null when
 * the recogniser could not follow the line (keep the take as recorded).
 * `audio` is the take's buffer (removals widen to the quiet gaps around each
 * note) or just its duration in seconds (removals follow the timings).
 *   { removals: [{ start, end, atEnd }], boundaries: [{ text, start, end }],
 *     notes: { kept, cut, unsure } }
 */
export function planPunctuationCuts(line, heard, audio, policy) {
  const duration = typeof audio === 'number' ? audio : audio.duration;
  const samples = typeof audio === 'number' ? null : audio.getChannelData(0);
  const gapBefore = (noteStart, previousEnd) => (samples
    ? quietestNear(samples, audio.sampleRate, noteStart, Math.max(previousEnd, noteStart - REACH), noteStart, REACH)
    : Math.max(previousEnd, noteStart - LEAD));
  const gapAfter = (noteEnd, nextStart) => (samples
    ? quietestNear(samples, audio.sampleRate, noteEnd, noteEnd, Math.min(nextStart, noteEnd + REACH), REACH)
    : Math.min(nextStart, noteEnd + TAIL));
  const tokens = spokenScript(line);
  const timing = alignedTimings(tokens.map((t) => t.text), heard, duration);
  if (!timing) return null;
  const groups = new Map();
  tokens.forEach((token, i) => { if (token.note) (groups.get(token.group) || groups.set(token.group, []).get(token.group)).push(i); });
  const removals = [];
  const notes = { kept: 0, cut: 0, unsure: 0 };
  for (const indexes of groups.values()) {
    const kind = tokens[indexes[0]].note;
    if (keeps(policy, kind)) { notes.kept += 1; continue; }
    if (!indexes.every((i) => timing[i].matched)) { notes.unsure += 1; continue; }
    const first = indexes[0];
    const last = indexes.at(-1);
    const atEnd = last === tokens.length - 1;
    const atStart = first === 0;
    const start = atStart ? 0 : gapBefore(timing[first].start, first > 0 ? timing[first - 1].end : 0);
    const end = atEnd ? duration : gapAfter(timing[last].end, last < tokens.length - 1 ? timing[last + 1].start : duration);
    if (end > start) { removals.push({ start, end, atEnd, atStart }); notes.cut += 1; }
  }
  removals.sort((a, b) => a.start - b.start);
  // Notes said one after the other ("period", "new paragraph") go as one
  // span, with no gap left between them.
  const merged = [];
  for (const r of removals) {
    const previous = merged.at(-1);
    if (previous && r.start - previous.end <= 0.3) { previous.end = r.end; previous.atEnd = previous.atEnd || r.atEnd; }
    else merged.push({ ...r });
  }
  removals.splice(0, removals.length, ...merged);
  const boundaries = tokens.flatMap((token, i) => (token.note ? [] : [{ text: token.text, start: timing[i].start, end: timing[i].end }]));
  return { removals, boundaries, notes };
}

/**
 * The buffer without the removed spans. Each inner removal is replaced by a
 * short silence; one at the start or end is simply dropped. Returns the new
 * buffer and a function mapping a time in the old recording to the new.
 */
export function removeSpans(buffer, removals, context, gap = GAP) {
  if (!removals.length) return { buffer, map: (t) => t };
  const rate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const pieces = [];
  let cursor = 0;
  const edges = []; // [oldTime, shift] after each removal
  let shift = 0;
  for (const r of removals) {
    const from = Math.max(cursor, Math.round(r.start * rate));
    const to = Math.min(samples.length, Math.round(r.end * rate));
    if (to <= from) continue;
    pieces.push(samples.subarray(cursor, from));
    const silence = r.atEnd || r.atStart ? 0 : Math.round(gap * rate);
    if (silence) pieces.push(new Float32Array(silence));
    shift += (to - from - silence) / rate;
    edges.push([r.end, shift, r.start, (from - cursor) / rate]);
    cursor = to;
  }
  pieces.push(samples.subarray(cursor));
  const length = pieces.reduce((n, p) => n + p.length, 0);
  const out = context.createBuffer(1, Math.max(1, length), rate);
  const data = out.getChannelData(0);
  let at = 0;
  for (const p of pieces) { data.set(p, at); at += p.length; }
  const map = (t) => {
    let moved = 0;
    for (const [oldEnd, total] of edges) { if (t >= oldEnd) moved = total; else break; }
    // Inside a removed span, times collapse onto its start.
    for (const r of removals) if (t > r.start && t < r.end) return map(r.start);
    return Math.max(0, Math.min(t - moved, out.duration));
  };
  return { buffer: out, map };
}

/**
 * A take with its spoken punctuation cut by the policy: the new buffer, the
 * sentence words' boundaries in it, and what was done to the notes. Returns
 * the take unchanged (boundaries from the plain alignment, if any) when the
 * line could not be followed.
 */
export function applyPunctuationPolicy(line, heard, buffer, policy, context) {
  const plan = planPunctuationCuts(line, heard, buffer, policy);
  if (!plan) return null;
  const { buffer: cut, map } = removeSpans(buffer, plan.removals, context);
  const boundaries = plan.boundaries.map((w) => ({ text: w.text, start: map(w.start), end: Math.max(map(w.start) + 0.02, map(w.end)) }));
  return { buffer: cut, boundaries, notes: plan.notes };
}
