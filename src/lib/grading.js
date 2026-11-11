import * as Diff from 'diff';

// All on by default. A student who hears "café" and types "cafe", starts a
// sentence in lower case, or drops a comma has still heard the words — and the
// words are what a dictation is testing. Anyone who wants stricter marking (a
// spelling test, say) turns these off by hand: the student on the results
// screen, the teacher when creating an assignment. This is the one place the
// defaults live; both of those screens start from it.
export const DEFAULT_GRADING_OPTIONS = {
  ignoreCase: true,
  ignorePunctuation: true,
  ignoreAccents: true,
};

const PUNCTUATION_RE = /[\p{P}\p{S}]/gu;
const COMBINING_MARKS_RE = /\p{M}/gu;
// Curly/smart quotes (‘’) and the occasional grave-accent stand-in (`) are
// typographic variants of the same apostrophe, not a spelling difference —
// pasted passages commonly use curly quotes while keyboards type straight
// ones. Always normalized to '\'', independent of ignorePunctuation, so a
// student is never marked wrong for an apostrophe style mismatch.
const APOSTROPHE_RE = /[‘’`]/g;
// With punctuation checked, only the marks students heard dictated count.
// `dictated` names them: a list of classes, 'ends' (period, question and
// exclamation marks, ellipsis), 'inner' (colon, semicolon, quotes, ¿ ¡) and
// 'commas', as an array or a comma-separated string ('' = nothing), or one of
// the levels 'none' | 'ends' | 'inner' | 'all'. TTS and studio voices dictate
// nothing; voice actors say what the teacher chose, minus what the dictation
// cuts (a typed full-sentence dictation never plays the period). All other
// punctuation is removed before comparing, so a mark nobody could hear never
// costs a word; the feedback still shows the original with its punctuation.
// The assignment server sets it from the record (dictatedPunctuation).
// Apostrophes and hyphens are spelling, not dictation: always compared.
const DICTATION_CLASSES = ['ends', 'inner', 'commas'];
const LEVEL_CLASSES = { none: [], ends: ['ends'], inner: ['ends', 'inner'], all: ['ends', 'inner', 'commas'] };
export function dictatedClasses(dictated) {
  const list = Array.isArray(dictated) ? dictated
    : LEVEL_CLASSES[dictated] || String(dictated ?? '').split(',').map((c) => c.trim());
  return new Set(list.filter((c) => DICTATION_CLASSES.includes(c)));
}
function punctuationClass(ch) {
  if (/[.!?…؟。！？]/u.test(ch)) return 'ends';
  if (/[:;؛"«»“”„¿¡]/u.test(ch)) return 'inner';
  if (/[,،]/u.test(ch)) return 'commas';
  if (ch === "'" || ch === '-') return 'spelling';
  return null;
}
export function stripUndictated(word, dictated) {
  const heard = dictated instanceof Set ? dictated : dictatedClasses(dictated);
  return word.replace(PUNCTUATION_RE, (ch) => {
    const kind = punctuationClass(ch);
    return kind === 'spelling' || heard.has(kind) ? ch : '';
  });
}
function normalizeToken(word, opts) {
  let w = word.replace(APOSTROPHE_RE, "'");
  if (opts.ignoreCase) w = w.toLocaleLowerCase();
  if (opts.ignoreAccents) w = w.normalize('NFD').replace(COMBINING_MARKS_RE, '');
  if (opts.ignorePunctuation) w = w.replace(PUNCTUATION_RE, '');
  else if (opts.dictated !== undefined && opts.dictated !== null) w = stripUndictated(w, opts.heard || opts.dictated);
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
  if (opts.dictated !== undefined && opts.dictated !== null && !opts.heard) opts = { ...opts, heard: dictatedClasses(opts.dictated) };
  const originalTokens = tokenize(original, opts);
  const typedTokens = tokenize(typed, opts);
  const parts = Diff.diffArrays(originalTokens, typedTokens, {
    comparator: (a, b) => a.norm === b.norm,
  });

  let correct = 0;
  let missed = 0;
  let extra = 0;
  let at = 0; // position in the original, so matched words read as written there
  let typedAt = 0;
  const segments = parts.map((part) => {
    const words = part.value.map((t) => t.word);
    if (part.added) {
      extra += words.length;
      typedAt += words.length;
      return { type: 'extra', words };
    }
    if (part.removed) {
      missed += words.length;
      at += words.length;
      return { type: 'missed', words };
    }
    correct += words.length;
    // A matched word is shown as the original writes it (its punctuation,
    // capitals and accents), with what was typed alongside: a difference the
    // marking let pass can still be shown, without costing anything.
    const expected = originalTokens.slice(at, at + words.length).map((t) => t.word);
    const typedWords = typedTokens.slice(typedAt, typedAt + words.length).map((t) => t.word);
    at += words.length;
    typedAt += words.length;
    return { type: 'correct', words: expected, typed: typedWords };
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
