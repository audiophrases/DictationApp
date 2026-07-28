// Ordering of marked-up words: `node src/lib/score.test.mjs`.
//
// The interesting cases are the ones that are NOT substitutions — a word simply
// left out, or a word typed that isn't in the original. Those have no partner
// to swap with and must stay exactly where the diff put them, or the sentence
// stops reading in order.
import { gradeSentence } from './grading.js';
import { orderForReview } from './score.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    console.log(`     expected ${JSON.stringify(expected)}`);
    console.log(`     got      ${JSON.stringify(actual)}`);
    failures += 1;
  }
}

// Renders the way the screen does: type-tagged words in display order.
const marked = (original, typed) =>
  orderForReview(gradeSentence(original, typed).segments).map(
    (s) => `${s.type === 'correct' ? '' : s.type === 'extra' ? 'R:' : 'G:'}${s.words.join(' ')}`
  );

check(
  'a substitution reads mistake first, correction after',
  marked('Lava comes out of it.', 'lava comes out of it.'),
  ['R:lava', 'G:Lava', 'comes out of it.']
);

check(
  'a word left out stays in place, with nothing before it',
  marked('The big red house', 'The red house'),
  ['The', 'G:big', 'red house']
);

check(
  'an added word stays in place too',
  marked('The red house', 'The big red house'),
  ['The', 'R:big', 'red house']
);

check(
  'a fully correct sentence is one run',
  marked('It can erupt.', 'It can erupt.'),
  ['It can erupt.']
);

check(
  'several substitutions each swap independently',
  marked('A cat sat on a mat', 'A dog sat on a rug'),
  ['A', 'R:dog', 'G:cat', 'sat on a', 'R:rug', 'G:mat']
);

check(
  'an empty answer is all correction, nothing red',
  marked('Two short words', ''),
  ['G:Two short words']
);

// Reordering must never invent, drop or duplicate a word.
const sample = gradeSentence('A volcano is a mountain that opens downward.', 'a volcano is mountain that open downwards');
const before = sample.segments.flatMap((s) => s.words).sort();
const after = orderForReview(sample.segments).flatMap((s) => s.words).sort();
check('reordering preserves every word', after, before);

console.log(failures === 0 ? '\nAll ordering checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
