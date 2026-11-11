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
