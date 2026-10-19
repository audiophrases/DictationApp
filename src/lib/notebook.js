import { countWords, splitIntoSentences } from './sentences.js';

// Short sentences stay whole. For longer ones prefer punctuation pauses, and
// use word boundaries only when a clause itself is too long to hold in memory.
export function segmentSentence(sentence) {
  if (countWords(sentence) <= 18) return [sentence];
  const clauses = [];
  let start = 0;
  for (const match of sentence.matchAll(/[,;:،，；：]["”’»)]*(?=\s|$)/gu)) {
    const end = match.index + match[0].length;
    clauses.push(sentence.slice(start, end));
    start = end;
  }
  if (start < sentence.length) clauses.push(sentence.slice(start));
  const segments = [];
  let pending = '';
  for (const clause of clauses) {
    const words = clause.trim().split(/\s+/u);
    if (!words[0]) continue;
    if (pending && countWords(pending) + words.length > 14) {
      segments.push(pending);
      pending = '';
    }
    while (words.length > 18) segments.push(words.splice(0, 12).join(' '));
    pending = [pending, words.join(' ')].filter(Boolean).join(' ');
    if (countWords(pending) >= 8) {
      segments.push(pending);
      pending = '';
    }
  }
  if (pending) segments.push(pending);
  return segments;
}

export function notebookPlan(text) {
  return splitIntoSentences(text).map((sentence) => ({ sentence, segments: segmentSentence(sentence) }));
}

// Only Google Classroom links are accepted, both here and by the worker.
export function classroomLink(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'https:' && url.hostname === 'classroom.google.com'
      && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

const normalized = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Align the voice's words against each segment without relying on whitespace
// token counts (French elisions, numbers and contractions may be tokenized differently).
export function segmentTimes(segments, boundaries, duration) {
  if (segments.length === 1) return [[0, duration]];
  const words = boundaries.filter((b) => normalized(b.text));
  const cuts = [0];
  let cursor = 0;
  for (const segment of segments.slice(0, -1)) {
    const target = normalized(segment);
    let matched = '';
    while (cursor < words.length && matched.length < target.length) {
      matched += normalized(words[cursor++].text);
    }
    if (matched !== target || cursor >= words.length) {
      throw new Error('The voice timing could not be matched to this passage. Try simplifying its punctuation.');
    }
    const previousEnd = words[cursor - 1].end;
    const nextStart = words[cursor].start;
    const cut = (previousEnd + nextStart) / 2;
    if (!Number.isFinite(cut) || cut <= cuts.at(-1) || cut >= duration) {
      throw new Error('The voice returned invalid segment timing. Please try recording again.');
    }
    cuts.push(cut);
  }
  cuts.push(duration);
  return segments.map((_, i) => [cuts[i], cuts[i + 1]]);
}
