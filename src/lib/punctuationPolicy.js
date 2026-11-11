// Which spoken punctuation students hear. The rule: play it when the student
// has to produce it, cut it when they don't.
//
//   sentence ends (period, question mark…): notebook always; typed only in
//     segments, where it is the only way to know a segment closes the sentence
//   inner marks (colon, semicolon, quotes): notebook, or typed with
//     Punctuation marked (Check)
//   new paragraph: notebook only (typed answers have no paragraphs)
//
// The teacher can override the rule per assignment (`spokenPunctuation`):
// 'auto' (the rule), 'all', 'ends' (sentence ends only), 'none'.
import { deliveryFor } from './delivery.js';

export const SPOKEN_PUNCTUATION_CHOICES = [
  { value: 'auto', name: 'By the rule (recommended)' },
  { value: 'all', name: 'All, as recorded' },
  { value: 'ends', name: 'Sentence ends only' },
  { value: 'none', name: 'None' },
];

// What a recording dictates, chosen by the teacher before voice actors read
// (RecordingSetupDialog): nothing, sentence ends, inner marks too, or commas
// as well. TTS and studio voices dictate nothing. Marking with Punctuation =
// Check counts only this (grading.js `dictated`).
export const DICTATION_LEVELS = [
  { value: 'none', icon: '🔇', name: 'No punctuation', description: 'Actors read the words only. Students know a sentence ends; punctuation is never marked.' },
  { value: 'ends', icon: '⏺', name: 'Sentence ends', description: 'Period, question mark, exclamation mark. The way to know a segment closes the sentence.' },
  { value: 'inner', icon: '❝', name: 'Ends and inner marks', description: 'Also colons, semicolons and quotation marks, for a dictation that teaches them.' },
  { value: 'all', icon: '✍️', name: 'Everything, commas too', description: 'A full classroom dictation: every mark is said, and every mark can be marked.' },
];
const LEVEL_RANK = { none: 0, ends: 1, inner: 2, all: 3 };
export const dictationLevelAtLeast = (level, floor) => (LEVEL_RANK[level] ?? 0) >= LEVEL_RANK[floor];

/**
 * What students hear dictated, as grading.js classes ('ends,inner,commas'):
 * what the actors said (their script's level) less what this dictation cuts.
 * Checked punctuation marks exactly this.
 */
export function heardPunctuation(level, policy) {
  const heard = [];
  if (dictationLevelAtLeast(level, 'ends') && policy.ends) heard.push('ends');
  if (dictationLevelAtLeast(level, 'inner') && policy.inner) heard.push('inner');
  if (level === 'all' && policy.inner) heard.push('commas');
  return heard.join(',');
}

export function describeHeard(heard) {
  const set = new Set(String(heard || '').split(',').filter(Boolean));
  if (!set.size) return 'no punctuation';
  const parts = [];
  if (set.has('ends')) parts.push('sentence ends');
  if (set.has('inner')) parts.push('colons, semicolons and quotes');
  if (set.has('commas')) parts.push('commas');
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
}

/** The level the rule suggests: what the student has to produce. */
export function defaultDictationLevel({ mode, delivery, grading } = {}) {
  const rule = spokenPunctuationRule({ mode, delivery, grading });
  if (mode === 'notebook') return 'all';
  if (rule.inner) return 'all';
  return rule.ends ? 'ends' : 'none';
}

/** The policy that keeps exactly what a level dictates. */
export function policyForLevel(level, mode) {
  return { ends: dictationLevelAtLeast(level, 'ends'), inner: dictationLevelAtLeast(level, 'inner'), paragraph: mode === 'notebook' && level !== 'none' };
}

export function spokenPunctuationRule({ mode, delivery, grading } = {}) {
  const notebook = mode === 'notebook';
  const segments = deliveryFor({ mode, delivery }) === 'phrases';
  const checked = !!grading && grading.ignorePunctuation === false;
  return { ends: notebook || segments, inner: notebook || checked, paragraph: notebook };
}

/** The policy in force: the override, or the rule. */
export function spokenPunctuationPolicy(record = {}) {
  const choice = record.spokenPunctuation || 'auto';
  const notebook = record.mode === 'notebook';
  if (choice === 'all') return { ends: true, inner: true, paragraph: notebook };
  if (choice === 'ends') return { ends: true, inner: false, paragraph: false };
  if (choice === 'none') return { ends: false, inner: false, paragraph: false };
  return spokenPunctuationRule(record);
}

export function describeSpokenPunctuation(policy) {
  if (!policy.ends && !policy.inner) return 'spoken punctuation cut out';
  if (policy.ends && policy.inner) return policy.paragraph ? 'spoken punctuation kept' : 'spoken punctuation kept, new paragraphs cut';
  if (policy.ends) return 'spoken punctuation: sentence ends only';
  return 'spoken punctuation: inner marks only';
}
