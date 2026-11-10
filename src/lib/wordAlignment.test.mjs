import assert from 'node:assert/strict';
import test from 'node:test';
import { alignWords, alignedBoundaries, alignmentScore } from './wordAlignment.js';
import { sentenceCuts } from './audioSplits.js';

const heard = (pairs) => pairs.map(([text, start, end]) => ({ text, start, end }));

test('heard words pair with the sentence words in order, tolerating mistakes', () => {
  assert.deepEqual(alignWords(['Moving', 'abroad', 'helped', 'him.'], ['Moving', 'aboard', 'helped', 'him']), [0, 1, 2, 3]);
  // A missed word, an extra word, a wrong word.
  assert.deepEqual(alignWords(['Moving', 'abroad', 'helped', 'him.'], ['Moving', 'helped', 'um', 'him']), [0, -1, 1, 3]);
  assert.deepEqual(alignWords(['Moving', 'abroad', 'helped', 'him.'], ['Moving', 'abroad', 'kept', 'him']), [0, 1, -1, 3]);
  // Punctuation and case never matter.
  assert.deepEqual(alignWords(['“Yes”,', 'he', 'said.'], ['yes', 'he', 'said']), [0, 1, 2]);
  assert.deepEqual(alignWords(['Dr.', 'Smith'], ['Doctor', 'Smith']), [-1, 1]);
});

test('boundaries carry the recogniser’s timings and interpolate the rest', () => {
  const sentence = 'Moving abroad helped him a lot.';
  const words = heard([['Moving', 0.5, 0.9], ['abroad', 0.95, 1.4], ['helped', 1.6, 1.9], ['him', 1.9, 2.0], ['a', 2.05, 2.1], ['lot', 2.1, 2.5]]);
  const exact = alignedBoundaries(sentence, words, 3.0);
  assert.deepEqual(exact.map((w) => w.text), ['Moving', 'abroad', 'helped', 'him', 'a', 'lot.']);
  assert.equal(exact[1].start, 0.95);
  assert.equal(exact[5].end, 2.5);
  // sentenceCuts accepts them and cuts between the right words.
  const cuts = sentenceCuts(['Moving abroad', 'helped him a lot.'], exact, 3.0);
  assert.equal(cuts[1], (1.4 + 1.6) / 2);

  // "helped him" misheard as one word: it lends its timing to the word it
  // resembles, and "him" is squeezed into the gap before the next word.
  const gappy = alignedBoundaries(sentence, heard([['Moving', 0.5, 0.9], ['abroad', 0.95, 1.4], ['helpedim', 1.6, 2.0], ['a', 2.05, 2.1], ['lot', 2.1, 2.5]]), 3.0);
  assert.ok(gappy, 'enough matched');
  assert.equal(gappy[2].start, 1.6);
  assert.equal(gappy[3].start, 2.0);
  assert.equal(gappy[3].end, 2.05);
  assert.ok(gappy[2].end > gappy[2].start && gappy[3].start >= gappy[2].end);
  assert.doesNotThrow(() => sentenceCuts(['Moving abroad', 'helped him a lot.'], gappy, 3.0));

  // Leading and trailing words missed: spread from 0 and up to the end.
  const ends = alignedBoundaries(sentence, heard([['abroad', 0.95, 1.4], ['helped', 1.6, 1.9], ['him', 1.9, 2.0], ['a', 2.05, 2.1]]), 3.0);
  assert.equal(ends[0].start, 0);
  assert.equal(ends[5].end, 3.0);
});

test('too little recognised, or timings running backwards, gives nothing', () => {
  const sentence = 'Moving abroad helped him a lot.';
  assert.equal(alignedBoundaries(sentence, heard([['the', 0.1, 0.2], ['cat', 0.3, 0.4]]), 3.0), null);
  assert.equal(alignedBoundaries(sentence, heard([['Moving', 1.5, 1.9], ['abroad', 0.2, 0.5], ['helped', 0.6, 0.9], ['him', 1.0, 1.2]]), 3.0), null);
  assert.equal(alignedBoundaries(sentence, [], 3.0), null);
  assert.equal(alignedBoundaries('', heard([['x', 0, 1]]), 3.0), null);
  assert.equal(alignmentScore(sentence, heard([['moving', 0, 1], ['abroad', 1, 2], ['nothing', 2, 3]])), 2 / 6);
});
