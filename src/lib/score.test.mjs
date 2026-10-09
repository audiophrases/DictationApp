// Marked-up words, as tiles: `node src/lib/score.test.mjs`.
//
// The interesting cases are the ones that are NOT substitutions — a word simply
// left out, or a word typed that isn't in the original. Those have no partner
// to pair with and must stay exactly where the diff put them, or the sentence
// stops reading in order.
import { gradeSentence } from './grading.js';
import { reviewTiles, reviewSummary } from './score.js';

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

// Renders the way the screen reads: right words bare, the rest tagged.
const marked = (original, typed) =>
  reviewTiles(gradeSentence(original, typed).segments).map((t) => {
    if (t.kind === 'right') return t.expected;
    if (t.kind === 'wrong') return `${t.typed}→${t.expected}`;
    if (t.kind === 'missing') return `+${t.expected}`;
    return `-${t.typed}`;
  });

// A real word swap, not a case slip: marking ignores case by default, so a
// case-only difference is no longer a substitution at all.
check(
  'a substitution pairs what was typed with the right word',
  marked('Lava comes out of it.', 'Water comes out of it.'),
  ['Water→Lava', 'comes', 'out', 'of', 'it.']
);

check(
  'a word left out stays in place',
  marked('The big red house', 'The red house'),
  ['The', '+big', 'red', 'house']
);

check(
  'an added word stays in place too',
  marked('The red house', 'The big red house'),
  ['The', '-big', 'red', 'house']
);

check(
  'a fully correct sentence is all right words',
  marked('It can erupt.', 'It can erupt.'),
  ['It', 'can', 'erupt.']
);

check(
  'several substitutions each pair independently',
  marked('A cat sat on a mat', 'A dog sat on a rug'),
  ['A', 'dog→cat', 'sat', 'on', 'a', 'rug→mat']
);

check(
  'equal-length runs pair word by word',
  marked('A cat sat here', 'A dog sit here'),
  ['A', 'dog→cat', 'sit→sat', 'here']
);

check(
  'unequal runs stay together as one fix',
  marked('I saw the big dog', 'I saw a dog'),
  ['I', 'saw', 'a→the big', 'dog']
);

check(
  'an empty answer is all missing words, nothing red',
  marked('Two short words', ''),
  ['+Two', '+short', '+words']
);

check(
  'the summary counts words, so a grouped fix counts each word it replaced',
  reviewSummary(reviewTiles(gradeSentence('I saw the big dog today', 'I saw a dog now today extra').segments)),
  { right: 4, wrong: 2, missing: 0, extra: 2 }
);

// Tiles must never invent, drop or duplicate a word.
const sample = gradeSentence('A volcano is a mountain that opens downward.', 'a volcano is mountain that open downwards');
const tiles = reviewTiles(sample.segments);
const words = (list) => list.flatMap((t) => (t ? t.split(' ') : [])).sort();
check(
  'tiles keep every original word',
  words(tiles.map((t) => t.expected)),
  words(sample.segments.filter((s) => s.type !== 'extra').map((s) => s.words.join(' ')))
);
check(
  'tiles keep every typed-only word',
  words(tiles.map((t) => t.typed)),
  words(sample.segments.filter((s) => s.type === 'extra').map((s) => s.words.join(' ')))
);
const summary = reviewSummary(tiles);
check('the summary agrees with the grade', [summary.right, summary.wrong + summary.missing], [sample.correct, sample.missed]);

console.log(failures === 0 ? '\nAll marking checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
