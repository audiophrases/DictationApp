// Where each word of a known sentence was said, from a speech recogniser's
// words with timestamps. The transcript need not be right: the sentence is
// known, so the heard words are matched to it in order and only lend their
// timings. A misheard word costs nothing more than an interpolated timing;
// what matters is the gap between two words at a phrase boundary.
//
//   alignedBoundaries('Moving abroad helped him.', heard, duration)
//     → [{ text: 'Moving', start, end }, …]   (sentenceCuts takes these)
//     or null when too little of the sentence was recognised.

const normalized = (text) => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const wordsOf = (text) => String(text || '').trim().split(/\s+/u).filter(Boolean);

// 1 for the same word, down to 0: a Levenshtein ratio, so "abroad" ≈ "aboard"
// and a plural or a dropped letter still count for something.
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[cols - 1] / Math.max(a.length, b.length);
}

const MATCH_MIN = 0.5; // below this two words are not the same word
const GAP = -0.4; // skipping a word on either side

/**
 * Pairs sentence words with heard words, in order (Needleman–Wunsch on word
 * similarity). Returns, per sentence word, the index of its heard word or -1.
 */
export function alignWords(sentenceWords, heardWords) {
  const a = sentenceWords.map(normalized);
  const b = heardWords.map(normalized);
  const n = a.length;
  const m = b.length;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const from = Array.from({ length: n + 1 }, () => new Int8Array(m + 1)); // 0 diag, 1 up (skip sentence word), 2 left (skip heard word)
  for (let i = 1; i <= n; i++) { score[i][0] = i * GAP; from[i][0] = 1; }
  for (let j = 1; j <= m; j++) { score[0][j] = j * GAP; from[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = similarity(a[i - 1], b[j - 1]);
      const diag = score[i - 1][j - 1] + (s >= MATCH_MIN ? s : GAP * 1.5);
      const up = score[i - 1][j] + GAP;
      const left = score[i][j - 1] + GAP;
      if (diag >= up && diag >= left) { score[i][j] = diag; from[i][j] = 0; }
      else if (up >= left) { score[i][j] = up; from[i][j] = 1; }
      else { score[i][j] = left; from[i][j] = 2; }
    }
  }
  const matched = new Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = from[i][j];
    if (i > 0 && j > 0 && step === 0) {
      if (similarity(a[i - 1], b[j - 1]) >= MATCH_MIN) matched[i - 1] = j - 1;
      i--; j--;
    } else if (i > 0 && (j === 0 || step === 1)) i--;
    else j--;
  }
  return matched;
}

const MIN_WORD = 0.02; // seconds: a timing never collapses to nothing

/**
 * The sentence's words with timings: matched words from the recogniser,
 * the rest spread over the time between their matched neighbours in
 * proportion to their length. Null when fewer than `minMatched` of the words
 * were recognised, or the heard timings run backwards.
 */
export function alignedBoundaries(sentence, heard, duration, { minMatched = 0.6 } = {}) {
  const words = wordsOf(sentence);
  const said = (heard || []).filter((w) => normalized(w.text) && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  if (!words.length || !said.length || !(duration > 0)) return null;
  const matched = alignWords(words, said.map((w) => w.text));
  const count = matched.filter((k) => k >= 0).length;
  if (count < Math.max(1, Math.ceil(words.length * minMatched))) return null;
  const timing = words.map(() => null);
  let last = -1;
  for (let i = 0; i < words.length; i++) {
    if (matched[i] < 0) continue;
    const w = said[matched[i]];
    const start = Math.max(0, Math.min(duration, w.start));
    const end = Math.max(start + MIN_WORD, Math.min(duration, w.end));
    if (last >= 0 && start < timing[last].start) return null; // timings must run forwards
    timing[i] = { start, end };
    last = i;
  }
  // Unmatched runs: share the gap between the neighbours' timings by length.
  let i = 0;
  while (i < words.length) {
    if (timing[i]) { i++; continue; }
    let j = i;
    while (j < words.length && !timing[j]) j++;
    const lo = i > 0 ? timing[i - 1].end : 0;
    const hi = j < words.length ? timing[j].start : duration;
    const weights = words.slice(i, j).map((w) => Math.max(1, normalized(w).length));
    const total = weights.reduce((s, w) => s + w, 0);
    const span = Math.max(hi - lo, MIN_WORD * (j - i));
    let at = Math.min(lo, duration - span);
    for (let k = i; k < j; k++) {
      const width = span * weights[k - i] / total;
      timing[k] = { start: at, end: at + width };
      at += width;
    }
    i = j;
  }
  // Keep the sequence monotonic after interpolation squeezes.
  for (let k = 1; k < timing.length; k++) {
    if (timing[k].start < timing[k - 1].end) timing[k].start = timing[k - 1].end;
    if (timing[k].end < timing[k].start + MIN_WORD) timing[k].end = timing[k].start + MIN_WORD;
  }
  if (timing.at(-1).end > duration + 0.1) return null;
  return words.map((text, k) => ({ text, start: timing[k].start, end: timing[k].end }));
}

export const alignmentScore = (sentence, heard) => {
  const words = wordsOf(sentence);
  if (!words.length) return 0;
  return alignWords(words, (heard || []).map((w) => w.text)).filter((k) => k >= 0).length / words.length;
};
