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

// With punctuation checked, only what the recording dictated counts (the
// 'dictated' level): nothing for TTS, up to commas for voice actors.
{
  const checked = { ignoreCase: true, ignorePunctuation: false, ignoreAccents: true };
  const mark = (dictated, typed) => gradeSentence('Yes, please: "now".', typed, { ...checked, dictated });
  check('TTS dictates nothing: no punctuation is marked', mark('none', 'yes please now').correct === 3);
  check('sentence ends dictated: the period counts, the comma and colon do not',
    mark('ends', 'Yes please: now').correct === 2 && mark('ends', 'Yes please now.').correct === 3);
  check('inner marks dictated: the colon and quotes count too, the comma does not',
    mark('inner', 'Yes please: "now".').correct === 3 && mark('inner', 'Yes please now.').correct === 1);
  check('everything dictated: the comma counts',
    mark('all', 'Yes please: "now".').correct === 2 && mark('all', 'Yes, please: "now".').correct === 3);
  check('ignored punctuation ignores it all whatever was dictated',
    gradeSentence('Yes, please.', 'yes please', { ...checked, ignorePunctuation: true, dictated: 'all' }).correct === 2);
  // Classes, not levels: a typed full-sentence dictation hears commas but never the period.
  check('commas heard, period cut: the comma counts, the period does not',
    gradeSentence('Yes, please.', 'Yes please.', { ...checked, dictated: 'inner,commas' }).correct === 1
    && gradeSentence('Yes, please.', 'Yes, please', { ...checked, dictated: 'inner,commas' }).correct === 2);
  check('nothing dictated (\'\' or none) marks no punctuation; apostrophes still count',
    gradeSentence('It\'s here, now.', 'its here now', { ...checked, dictated: '' }).correct === 2
    && gradeSentence('It\'s here, now.', 'It\'s here now', { ...checked, dictated: 'none' }).correct === 3);
  check('without a dictated setting (free practice), Check marks all punctuation as before',
    gradeSentence('Yes, please.', 'Yes please.', checked).correct === 1);
  // Matched words read as the original writes them, with what was typed alongside.
  const shown = gradeSentence('Yes, please.', 'yes please', { ...checked, dictated: '' }).segments;
  check('matched words keep the original’s punctuation for the feedback',
    shown.length === 1 && shown[0].words.join(' ') === 'Yes, please.' && shown[0].typed.join(' ') === 'yes please');
}

console.log(failures === 0 ? '\nAll marking checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
