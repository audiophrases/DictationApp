// Splitting a passage into the sentences a student will type one at a time.
//
// A period is only sometimes the end of a sentence. "John M. Smith was born"
// has three of them that are not, and splitting there hands the student "John
// M." as a whole dictation item — short, meaningless, and impossible to punctuate
// correctly. So each candidate is judged rather than trusted.
//
// The rules below are deliberately biased towards NOT splitting. An over-long
// item is a bad dictation; a fragment like "Dr." is a broken one.

// Abbreviations that are followed by more of the same sentence often enough to
// assume they always are — titles and reference markers, which essentially never
// end a sentence. Case-sensitive: "No. 5" is an abbreviation but "digo que no."
// is a full stop, and lowercase "dr." is normal in Romanian.
//
// Deliberately absent: etc., cf., al. Those genuinely do end sentences, and the
// "followed by a lowercase word" rule below already keeps "etc. and so on"
// together while letting "etc. Then we left." split correctly.
const ABBREVIATIONS = new Set([
  // English
  'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Rev', 'Hon', 'St', 'Ste', 'Jr', 'Sr',
  'Capt', 'Gen', 'Col', 'Lt', 'Sgt', 'Adm', 'Gov', 'Pres', 'Sen', 'Rep',
  'No', 'Nos', 'Vol', 'Fig', 'Ed', 'Eds', 'pp', 'Ave', 'Blvd', 'Rd', 'Mt',
  'Inc', 'Ltd', 'Co', 'Corp', 'Dept', 'Univ', 'Est',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  // Catalan / Spanish
  'Sra', 'Srta', 'Dra', 'Dña', 'Ud', 'Uds', 'Vd', 'Vds', 'Sta', 'Sto',
  'núm', 'pàg', 'pág', 'págs', 'Av', 'Avda', 'Ctra', 'admin',
  // French
  'Mme', 'Mlle', 'Mgr', 'Pr', 'boul', 'av', 'éd', 'coll',
  // German
  'Hr', 'Nr', 'Bd', 'bzw', 'ca', 'evtl', 'ggf', 'usw', 'Str', 'Abb', 'Aufl',
  // Italian
  'Sig', 'Dott', 'Egr', 'Gent', 'pag', 'sig',
  // Portuguese
  'Exmo', 'Exma', 'Eng',
  // Romanian
  'dl', 'dna', 'dr', 'prof', 'str', 'nr',
  // Russian / Ukrainian
  'г', 'гг', 'ул', 'обл', 'им', 'см', 'рис', 'табл', 'стр', 'тыс', 'млн', 'млрд',
]);

// A run of terminal punctuation, plus any closing quote or bracket that belongs
// with it — "he left." and «il est parti.» both end at the same place.
const TERMINATOR = /[.!?…]+["'”’»)\]]*/g;

/** The word immediately before a position, or '' if there isn't one. */
function wordBefore(line, index) {
  const match = line.slice(0, index).match(/[\p{L}\p{N}]+$/u);
  return match ? match[0] : '';
}

/**
 * Does this run of punctuation actually end a sentence?
 *
 * `index` is where the punctuation starts, `end` where it finishes.
 */
function endsSentence(line, index, end) {
  const after = line.slice(end);

  // Last thing on the line: whatever it is, the sentence stops here.
  if (!/\S/.test(after)) return true;

  // No space after it, so it is inside a token rather than between two:
  // 3.14, example.com, U.S.A.
  if (!/^\s/.test(after)) return false;

  // A lowercase word next means the sentence carried on: "etc. and so on",
  // "e.g. apples". Languages without case (Arabic) fall through to the checks
  // below, which is the right default — there a period really is a full stop.
  if (/^\s+\p{Ll}/u.test(after)) return false;

  // Everything below is about a single period. "!", "?" and "…" are not used
  // to abbreviate, so having got this far they end the sentence.
  if (line.slice(index, end).replace(/["'”’»)\]]/g, '') !== '.') return true;

  const previous = wordBefore(line, index);

  // A single letter is an initial: "John M. Smith", and German "z. B.".
  // The cost of being wrong is a sentence ending in a lone letter, which is
  // far rarer than a middle initial.
  if (previous.length === 1 && /\p{L}/u.test(previous)) return false;

  if (ABBREVIATIONS.has(previous)) return false;

  // A number alone on the line so far is a list marker — "1. First item" is
  // one dictation item, not two. A number mid-sentence ("born in 1990.") is
  // untouched by this, because the text before it is not only digits.
  if (/^\s*\d+$/.test(line.slice(0, index))) return false;

  return true;
}

/**
 * Split a passage into sentences for dictation.
 *
 * Line breaks always end a sentence (poems, lists, and lesson sentences, which
 * arrive one per line), and text without a terminal . ! ? is kept as its own
 * sentence instead of being dropped.
 */
export function splitIntoSentences(text) {
  const sentences = [];

  for (const line of (text || '').split(/\n+/)) {
    let start = 0;
    TERMINATOR.lastIndex = 0;
    let match;

    while ((match = TERMINATOR.exec(line)) !== null) {
      const end = match.index + match[0].length;
      if (!endsSentence(line, match.index, end)) continue;

      const sentence = line.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
    }

    const tail = line.slice(start).trim();
    if (tail) sentences.push(tail);
  }

  return sentences;
}

export function countWords(text) {
  const trimmed = (text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
