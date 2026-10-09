// Where a score sits on the good / fair / poor scale, as a CSS class. One
// definition, so a percentage is coloured the same on the student's results
// screen and in the teacher's tables.
export function accuracyClass(accuracy) {
  if (accuracy >= 0.9) return 'badge-good';
  if (accuracy >= 0.7) return 'badge-ok';
  return 'badge-poor';
}

/**
 * Turns a sentence's diff into the tiles the marked sentence is drawn from,
 * the way a teacher corrects on paper: the sentence reads in its own order,
 * and each mistake carries the right word with what the student wrote under it.
 *
 *  - right:   { expected }          a word reproduced
 *  - wrong:   { expected, typed }   a word replaced by something else
 *  - missing: { expected }          a word left out
 *  - extra:   { typed }             a word typed that isn't in the sentence
 *
 * A substitution is a missed run followed by a typed one. When the two runs
 * are the same length they are paired word by word ("cat sat" → "dog sit"
 * reads as two fixes, not one); otherwise there is no telling which word
 * replaced which, so the runs stay together as one tile.
 *
 * Presentation only, so it applies to attempts already stored in R2 as well.
 */
export function reviewTiles(segments) {
  const tiles = [];
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i];
    const next = segments[i + 1];
    if (current.type === 'missed' && next?.type === 'extra') {
      if (current.words.length === next.words.length) {
        current.words.forEach((word, j) => tiles.push({ kind: 'wrong', expected: word, typed: next.words[j] }));
      } else {
        tiles.push({ kind: 'wrong', expected: current.words.join(' '), typed: next.words.join(' ') });
      }
      i += 1;
    } else if (current.type === 'missed') {
      current.words.forEach((word) => tiles.push({ kind: 'missing', expected: word }));
    } else if (current.type === 'extra') {
      current.words.forEach((word) => tiles.push({ kind: 'extra', typed: word }));
    } else {
      current.words.forEach((word) => tiles.push({ kind: 'right', expected: word }));
    }
  }
  return tiles;
}

const wordCount = (text) => (text ? text.split(' ').length : 0);

// How many of the sentence's words fell into each kind of tile. Counted in
// words, not tiles, so a grouped substitution counts every word it replaced.
export function reviewSummary(tiles) {
  const counts = { right: 0, wrong: 0, missing: 0, extra: 0 };
  for (const tile of tiles) {
    counts[tile.kind] += wordCount(tile.kind === 'extra' ? tile.typed : tile.expected);
  }
  return counts;
}
