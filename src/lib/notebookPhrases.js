import nlp from 'compromise/two';

// A notebook dictation reads each sentence out a phrase at a time, the way a
// teacher does: each phrase a whole grammatical unit — who, does what, to
// what, where — short enough to remember while writing. "Moving abroad /
// helped him understand / his own culture." Two words are fine when they are
// a whole unit like "Moving abroad"; scraps like "but we" never are.
//
// Rather than cutting greedily, every way of dividing the sentence is scored
// and the cheapest wins: each phrase costs something (so a short sentence stays
// whole), lengths outside 2–6 words cost more, and each cut costs or earns
// points by what sits either side of it, which is what rules out the scraps.
// Punctuation is a strong preference, not a rule, so "Yes, I do." can stay
// together.
const MAX_SPAN = 12;
const PHRASE_COST = 3;
const LENGTH_COST = [Infinity, 30, 4, 0, 0, 1, 3, 7, 14];
const lengthCost = (n) => (n < LENGTH_COST.length ? LENGTH_COST[n] : 14 + 8 * (n - 8));

const PAUSE = /[,;:—–]["”’»)]*$/u;
const STOP = /[.!?…]["”’»)]*$/u;
const ABBREVIATION = /^(?:\p{Lu}\p{Ll}{0,3}|\p{L})\.$/u; // Dr. Mr. St. J.

const SUBORDINATORS = new Set([
  'when', 'while', 'if', 'although', 'though', 'because', 'since', 'unless', 'until',
  'whereas', 'whether', 'before', 'after', 'once', 'where', 'which', 'who', 'whom', 'whose',
]);
const COORDINATORS = new Set(['and', 'but', 'or', 'so', 'yet', 'nor']);
const SUBJECT_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they']);
const RELATIVES = new Set(['who', 'which', 'that']);
const COMPOUND_PREPOSITIONS = [
  'in front of', 'on top of', 'in spite of', 'out of', 'because of',
  'instead of', 'next to', 'according to', 'away from', 'due to',
];

// Words a phrase must never end on in languages without a tagger: articles,
// prepositions, conjunctions, subject pronouns and the helping verbs of
// compound tenses, which all lean on the word after them.
const LEANING = {
  ca: 'el la els les l un una uns unes de del dels a al als en amb per que i o però si quan jo tu ell ella nosaltres vosaltres ells elles em et es ens us li he has ha hem heu han sóc ets és som sou són',
  es: 'el la los las lo un una unos unas de del a al en con por para que y o pero si cuando yo tú él ella nosotros vosotros ellos ellas me te se nos os le les he has ha hemos habéis han soy eres es somos sois son',
  fr: 'le la les l un une des du de d à au aux en dans avec pour par sur que qu et ou mais si quand je j tu il elle on nous vous ils elles me m te t se s ai as a avons avez ont suis es est sommes êtes sont',
  it: 'il lo la i gli le l un uno una di del della a al alla in con per su che e o ma se quando io tu lui lei noi voi loro mi ti si ci vi ho hai ha abbiamo avete hanno sono sei è siamo siete',
  pt: 'o a os as um uma uns umas de do da dos das em no na com por para que e ou mas se quando eu tu ele ela nós vós eles elas me te se nos vos tenho tens tem temos tendes têm sou és é somos sois são',
  de: 'der die das den dem des ein eine einen einem einer und oder aber wenn dass mit von zu in im auf für ich du er sie es wir ihr habe hast hat haben habt bin bist ist sind seid',
  ro: 'un o de la în cu pe pentru că și sau dar dacă când eu tu el ea noi voi ei ele mă te se ne vă am ai a ați au sunt ești este suntem sunteți',
};

const plain = (text) => text.toLowerCase().replace(/[^\p{L}]/gu, '');

function tagWords(sentence, english) {
  const words = [...sentence.matchAll(/\S+/gu)].map((match) => ({ text: match[0], index: match.index, tags: new Set() }));
  if (!english) return words;
  // Keep the original whitespace-delimited tokens: the tagger expands some
  // contractions internally, but the text and voice must never gain/lose words.
  const terms = nlp(sentence).json({ offset: true }).flatMap((part) => part.terms);
  for (const word of words) {
    for (const term of terms) {
      const start = term.offset.start;
      if (term.offset.length > 0 && start >= word.index && start < word.index + word.text.length) {
        term.tags.forEach((tag) => word.tags.add(tag));
      }
    }
  }
  const normals = words.map((word) => plain(word.text));
  for (const phrase of COMPOUND_PREPOSITIONS) {
    const parts = phrase.split(' ');
    for (let i = 0; i <= words.length - parts.length; i++) {
      if (parts.every((part, j) => normals[i + j] === part)) {
        // The tagger reads the compound as one term, so only its first word
        // gets tags; the last must lean on what follows just as "of" does.
        words[i].tags.add('Preposition');
        words[i + parts.length - 1].tags.add('Preposition');
        for (let j = 1; j < parts.length; j++) words[i + j].glued = true;
      }
    }
  }
  return words;
}

const is = (word, tag) => !!word?.tags.has(tag);

// Whether the noun ending at `index` is a sentence subject rather than the
// object of a verb or preposition: "the farmer / walked" is a fair break,
// "helps people / connect" is not. Walks back over the whole noun phrase,
// including any "in front of the school" attached to it, and looks at what
// governs it.
const NOUN_PHRASE = ['Noun', 'Adjective', 'Determiner', 'Possessive', 'Adverb', 'Preposition'];
function isSubject(words, index) {
  let start = index;
  while (start > 0 && !is(words[start - 1], 'Verb')
    && (words[start].glued || NOUN_PHRASE.some((tag) => is(words[start - 1], tag)))) start--;
  // A noun phrase can't begin with its preposition: that one governs it.
  while (start < index && is(words[start], 'Preposition')) start++;
  const before = words[start - 1];
  if (!before) return true;
  if (is(before, 'Preposition')) return false;
  if (!is(before, 'Verb') || is(before, 'Gerund')) return true;
  // "The man who lives next door / has…": the verb belongs to a relative
  // clause, so the whole thing describes the subject.
  let relative = start - 2;
  while (relative >= 0 && is(words[relative], 'Adverb')) relative--;
  return RELATIVES.has(plain(words[relative]?.text || '')) && relative > 0
    && is(words[relative - 1], 'Noun') && isSubject(words, relative - 1);
}

// Whether words[index] is the first real verb of its clause, so everything
// before it — back to the last pause or linking word — is the subject, even a
// subject with no noun in it like "Moving abroad". "-ing" forms don't count:
// they are part of such a subject.
function opensClause(words, index) {
  for (let i = index - 1; i >= 0; i--) {
    const word = words[i];
    if (PAUSE.test(word.text) || SUBORDINATORS.has(plain(word.text)) || COORDINATORS.has(plain(word.text))) return i < index - 1;
    if (is(word, 'Verb') && !is(word, 'Gerund')) return false;
  }
  return index > 0;
}

// What a cut before words[index] costs; negative means a good place.
function cutCost(words, index, lang) {
  const left = words[index - 1];
  const right = words[index];
  const next = words[index + 1];
  const leftWord = plain(left.text);
  const rightWord = plain(right.text);
  let cost = 0;

  if (PAUSE.test(left.text) || STOP.test(left.text)) cost -= 14;
  if (ABBREVIATION.test(left.text) || right.glued || is(right, 'Particle')) cost += 30;
  if (is(left, 'ProperNoun') && is(right, 'ProperNoun')) cost += 30;

  const leaning = LEANING[lang];
  if (leaning) return cost + (` ${leaning} `.includes(` ${leftWord} `) ? 25 : 0);
  if (!/^en$/.test(lang)) return cost;

  // Good places: before a clause, a preposition, or "to" + verb.
  if (SUBORDINATORS.has(rightWord) && !is(right, 'Determiner')) cost -= 7;
  else if (rightWord === 'that' && !is(right, 'Determiner')) cost -= 5;
  else if (COORDINATORS.has(rightWord) && is(right, 'Conjunction')) cost -= 4;
  else if (rightWord === 'to' && is(next, 'Verb')) cost -= 4;
  else if (is(right, 'Preposition')) cost -= 4;

  else if (is(right, 'QuestionWord')) cost -= 5;

  // A subject before its verb is a good break — "the farmer / walked",
  // "Moving abroad / helped" — but a pronoun one is not ("we / should"), and
  // an object stays with the verb that follows it ("helped him understand",
  // "helps people connect").
  // An adverb in front of the verb goes with it: "the mist / still covered".
  let verb = index;
  while (is(words[verb], 'Adverb') && !is(words[verb], 'Verb')) verb++;
  const verbStarts = verb < words.length && is(words[verb], 'Verb') && !is(left, 'Verb') && !is(left, 'Adverb');
  const gerundSubject = is(right, 'Verb') && is(left, 'Adverb') && opensClause(words, index)
    && words.slice(0, index).some((word) => is(word, 'Gerund'));
  if (verbStarts && SUBJECT_PRONOUNS.has(leftWord)) cost += 12;
  else if (verbStarts && is(left, 'Pronoun')) cost += 12;
  else if (gerundSubject || (verbStarts && (is(left, 'Noun') ? isSubject(words, index - 1) : opensClause(words, index)))) cost -= 7;
  else if (verbStarts && is(left, 'Noun')) cost += 6;
  else if (is(right, 'Verb') && is(left, 'Adverb')) cost += 6;

  // After a whole verb group, the object can start a phrase of its own.
  if (is(left, 'Verb') && !is(left, 'Auxiliary') && !is(left, 'Copula')
    && (is(right, 'Determiner') || is(right, 'Possessive'))) cost -= 1;

  // Bad places: after a word that leans on the next one.
  // "the / old school" or "in front of / the" can't be said as a phrase at all;
  // "has / not called" can, but badly.
  if (leftWord === 'to' || is(left, 'Determiner') || is(left, 'Possessive')
    || is(left, 'Preposition') || is(left, 'Conjunction') || is(left, 'QuestionWord')
    || SUBORDINATORS.has(leftWord)) cost += 25;
  else if (is(left, 'Negative') || is(left, 'Auxiliary') || is(left, 'Modal') || is(left, 'Copula')) cost += 15;
  if (is(left, 'Adjective') && (is(right, 'Noun') || is(right, 'Adjective'))) cost += 20;
  if (is(left, 'Adverb') && (is(right, 'Adjective') || is(right, 'Adverb'))) cost += 6;
  if (is(left, 'Verb') && is(right, 'Noun') && !is(right, 'Possessive')) cost += 2;
  return cost;
}

export function phraseSegments(sentence, lang = 'en-US') {
  const base = lang.split('-')[0].toLowerCase();
  const words = tagWords(sentence, base === 'en');
  if (!words.length) return [];

  const best = [{ cost: 0, from: -1 }];
  for (let end = 1; end <= words.length; end++) {
    best[end] = { cost: Infinity, from: 0 };
    for (let start = Math.max(0, end - MAX_SPAN); start < end; start++) {
      const cut = start > 0 ? cutCost(words, start, base) : 0;
      const cost = best[start].cost + PHRASE_COST + lengthCost(end - start) + cut;
      if (cost < best[end].cost) best[end] = { cost, from: start };
    }
  }

  const phrases = [];
  for (let end = words.length; end > 0; end = best[end].from) {
    const start = best[end].from;
    const last = words[end - 1];
    phrases.unshift(sentence.slice(words[start].index, last.index + last.text.length));
  }
  return phrases;
}
