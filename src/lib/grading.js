import * as Diff from 'diff';

export const DEFAULT_GRADING_OPTIONS = {
  ignoreCase: false,
  ignorePunctuation: false,
  ignoreAccents: false,
};

const PUNCTUATION_RE = /[\p{P}\p{S}]/gu;
const COMBINING_MARKS_RE = /\p{M}/gu;
// Curly/smart quotes (‘’) and the occasional grave-accent stand-in (`) are
// typographic variants of the same apostrophe, not a spelling difference —
// pasted passages commonly use curly quotes while keyboards type straight
// ones. Always normalized to '\'', independent of ignorePunctuation, so a
// student is never marked wrong for an apostrophe style mismatch.
const APOSTROPHE_RE = /[‘’`]/g;

function normalizeToken(word, opts) {
  let w = word.replace(APOSTROPHE_RE, "'");
  if (opts.ignoreCase) w = w.toLocaleLowerCase();
  if (opts.ignoreAccents) w = w.normalize('NFD').replace(COMBINING_MARKS_RE, '');
  if (opts.ignorePunctuation) w = w.replace(PUNCTUATION_RE, '');
  return w;
}

// Tokens that normalize to nothing (e.g. a lone dash when punctuation is
// ignored) are excluded from grading entirely.
function tokenize(text, opts) {
  return (text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ word, norm: normalizeToken(word, opts) }))
    .filter((t) => t.norm.length > 0);
}

/**
 * Grade one typed sentence against the original.
 * Returns display segments (built from the real words, so highlighting keeps
 * original casing/punctuation) plus word counts:
 *  - correct: original words the student reproduced
 *  - missed:  original words absent from the answer
 *  - extra:   words the student typed that are not in the original
 */
export function gradeSentence(original, typed, opts = DEFAULT_GRADING_OPTIONS) {
  const originalTokens = tokenize(original, opts);
  const typedTokens = tokenize(typed, opts);
  const parts = Diff.diffArrays(originalTokens, typedTokens, {
    comparator: (a, b) => a.norm === b.norm,
  });

  let correct = 0;
  let missed = 0;
  let extra = 0;
  const segments = parts.map((part) => {
    const words = part.value.map((t) => t.word);
    if (part.added) {
      extra += words.length;
      return { type: 'extra', words };
    }
    if (part.removed) {
      missed += words.length;
      return { type: 'missed', words };
    }
    correct += words.length;
    return { type: 'correct', words };
  });

  const total = originalTokens.length;
  return {
    original,
    typed: typed || '',
    segments,
    correct,
    missed,
    extra,
    total,
    accuracy: total > 0 ? correct / total : 1,
  };
}

/**
 * Grade a whole session. `typedSentences` may be shorter than `sentences`
 * (finished early) — missing answers grade as fully missed.
 */
export function gradeDictation(sentences, typedSentences, opts = DEFAULT_GRADING_OPTIONS) {
  const results = sentences.map((s, i) => gradeSentence(s, typedSentences[i] ?? '', opts));
  const totals = results.reduce(
    (acc, r) => {
      acc.correct += r.correct;
      acc.missed += r.missed;
      acc.extra += r.extra;
      acc.total += r.total;
      return acc;
    },
    { correct: 0, missed: 0, extra: 0, total: 0 }
  );
  return {
    sentences: results,
    ...totals,
    accuracy: totals.total > 0 ? totals.correct / totals.total : 1,
  };
}
