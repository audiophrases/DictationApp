// Marking rules: `node src/lib/grading.test.mjs`.
//
// The defaults are a product decision, not an implementation detail: a student
// who hears the words and types them in the wrong case, without the accent, or
// missing a comma has still done the dictation. These pin that the three
// leniencies start ON everywhere, and that turning one off really does bite.
import { gradeSentence, DEFAULT_GRADING_OPTIONS } from './grading.js';

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    if (detail) console.log(`     ${detail}`);
    failures += 1;
  }
}

const pct = (g) => Math.round(g.accuracy * 100);

// ------------------------------------------------------------ the defaults
check('ignore case is on by default', DEFAULT_GRADING_OPTIONS.ignoreCase === true);
check('ignore punctuation is on by default', DEFAULT_GRADING_OPTIONS.ignorePunctuation === true);
check('ignore accents is on by default', DEFAULT_GRADING_OPTIONS.ignoreAccents === true);

// ---------------------------------------------- lenient marking, by default
{
  const g = gradeSentence('The café opened at noon.', 'the cafe opened at noon');
  check('case, accent and punctuation differences are all forgiven by default', pct(g) === 100,
    `scored ${pct(g)}%: ${JSON.stringify(g.segments)}`);
}

// --------------------------------------------- each switch still does its job
{
  const strictCase = { ...DEFAULT_GRADING_OPTIONS, ignoreCase: false };
  const g = gradeSentence('The café opened at noon.', 'the cafe opened at noon', strictCase);
  check('turning off ignore case marks "the" wrong', g.correct === 4 && g.total === 5,
    `${g.correct}/${g.total} correct`);
}
{
  const strictAccents = { ...DEFAULT_GRADING_OPTIONS, ignoreAccents: false };
  const g = gradeSentence('The café opened at noon.', 'the cafe opened at noon', strictAccents);
  check('turning off ignore accents marks "cafe" wrong', g.correct === 4 && g.total === 5,
    `${g.correct}/${g.total} correct`);
}
{
  const strictPunct = { ...DEFAULT_GRADING_OPTIONS, ignorePunctuation: false };
  const g = gradeSentence('The café opened at noon.', 'the cafe opened at noon', strictPunct);
  check('turning off ignore punctuation marks "noon" wrong for the missing stop',
    g.correct === 4 && g.total === 5, `${g.correct}/${g.total} correct`);
}

// ------------------------------------------ what the defaults must not hide
{
  const g = gradeSentence('The café opened at noon.', 'the cafe closed at noon');
  check('a genuinely wrong word is still marked wrong under the defaults',
    g.correct === 4 && g.extra === 1 && g.missed === 1,
    `${g.correct} correct, ${g.missed} missed, ${g.extra} extra`);
}
{
  const g = gradeSentence("It's cold.", 'It’s cold.');
  check('curly and straight apostrophes are the same word regardless of the switches',
    pct(g) === 100, `scored ${pct(g)}%`);
}

console.log(failures === 0 ? '\nAll marking checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
