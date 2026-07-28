// Sentence splitting: `node src/lib/sentences.test.mjs`.
//
// This is the one piece of logic a bad change breaks invisibly — a passage
// still dictates, it just does it in the wrong pieces. The cases below are the
// ones that decide whether a period is a full stop, in both directions: things
// that must NOT split, and things that still must.
import { splitIntoSentences } from './sentences.js';

let failures = 0;
function check(label, text, expected) {
  const actual = splitIntoSentences(text);
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    console.log(`     expected ${JSON.stringify(expected)}`);
    console.log(`     got      ${JSON.stringify(actual)}`);
    failures += 1;
  }
}

// ---------------------------------------------------------- must not split
check(
  'a middle initial',
  'John M. Smith was born in Ohio. He later moved.',
  ['John M. Smith was born in Ohio.', 'He later moved.']
);

check(
  'a string of initials',
  'J. R. R. Tolkien wrote it.',
  ['J. R. R. Tolkien wrote it.']
);

check(
  'a title before a name',
  'Dr. Fleming met Mr. Chain and Prof. Florey.',
  ['Dr. Fleming met Mr. Chain and Prof. Florey.']
);

check(
  'a decimal number',
  'Pi is about 3.14 in most classrooms.',
  ['Pi is about 3.14 in most classrooms.']
);

check(
  'an acronym with periods',
  'She moved to the U.S.A. and stayed.',
  ['She moved to the U.S.A. and stayed.']
);

check(
  'a reference marker',
  'See No. 5 for the answer.',
  ['See No. 5 for the answer.']
);

check(
  'a lowercase word after the period',
  'We packed apples, pears, etc. and then we left.',
  ['We packed apples, pears, etc. and then we left.']
);

check(
  'a domain name',
  'Visit example.com for more.',
  ['Visit example.com for more.']
);

check(
  'a numbered list marker',
  '1. Wash the apples',
  ['1. Wash the apples']
);

check(
  'German spaced abbreviations',
  'Er mag Tiere, z. B. Hunde und Katzen.',
  ['Er mag Tiere, z. B. Hunde und Katzen.']
);

// ------------------------------------------------------------- must split
check(
  'plain sentences',
  'The sun rose. The birds sang. We left.',
  ['The sun rose.', 'The birds sang.', 'We left.']
);

check(
  'a question and an exclamation',
  'Where is it? I found it! Good.',
  ['Where is it?', 'I found it!', 'Good.']
);

check(
  'an abbreviation that really did end the sentence',
  'We packed apples, pears, etc. Then we left.',
  ['We packed apples, pears, etc.', 'Then we left.']
);

check(
  'a year at the end of a sentence',
  'He was born in 1990. He died in 2050.',
  ['He was born in 1990.', 'He died in 2050.']
);

check(
  'a closing quote stays with its sentence',
  '"Stop." Then he ran.',
  ['"Stop."', 'Then he ran.']
);

check(
  'an ellipsis before a new sentence',
  'She waited… Nobody came.',
  ['She waited…', 'Nobody came.']
);

// ------------------------------------------------------- structure & edges
check(
  'line breaks always end a sentence',
  'Roses are red\nViolets are blue',
  ['Roses are red', 'Violets are blue']
);

check(
  'a lesson, one sentence per line',
  'Hi, my name is Marc.\nI am from Barcelona.',
  ['Hi, my name is Marc.', 'I am from Barcelona.']
);

check('text with no terminal punctuation is kept', 'no full stop here', ['no full stop here']);
check('empty input gives nothing', '', []);
check('whitespace only gives nothing', '   \n  ', []);
check('undefined is tolerated', undefined, []);

check(
  'trailing whitespace is trimmed away',
  '  The sun rose.   The birds sang.  ',
  ['The sun rose.', 'The birds sang.']
);

// Nothing may be lost: every non-space character must survive the split.
const passage =
  'Dr. J. M. Smith arrived in 1990. He paid 3.14 euros, etc. Then he left! Did he? Yes…';
const joined = splitIntoSentences(passage).join(' ').replace(/\s+/g, '');
const original = passage.replace(/\s+/g, '');
const intact = joined === original;
console.log(`${intact ? 'ok  ' : 'FAIL'} splitting never drops a character`);
if (!intact) {
  console.log(`     expected ${original}`);
  console.log(`     got      ${joined}`);
  failures += 1;
}

console.log(failures === 0 ? '\nAll splitting checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
