import nlp from 'compromise/two';

const MAX_WORDS = 7;
const TARGET_WORDS = 4;
const has = (word, tag) => word.tags?.has(tag);
const SUBORDINATE = /^(when|while|if|although|because|since|unless|until|before|after|once|where|which|who|whose)\b/i;
const COMPOUND_PREPOSITIONS = [
  'in front of', 'on top of', 'in spite of', 'out of', 'because of',
  'instead of', 'next to', 'according to', 'away from', 'due to',
];

// Bound memory load when a phrase is too long, preferring cuts before a new
// noun phrase and avoiding determiners, auxiliaries or adjectives left hanging.
function bounded(words) {
  const chunks = [];
  while (words.length > MAX_WORDS) {
    let best = 4;
    let bestScore = Infinity;
    for (let i = 2; i <= MAX_WORDS; i++) {
      const left = words[i - 1];
      const right = words[i];
      let score = Math.abs(i - TARGET_WORDS);
      if (['Determiner', 'Preposition', 'Auxiliary', 'Negative'].some((tag) => has(left, tag))) score += 8;
      if (has(left, 'Adjective') && (has(right, 'Adjective') || has(right, 'Noun'))) score += 6;
      if (has(left, 'ProperNoun') && has(right, 'ProperNoun')) score += 8;
      if (right.keepWithPrevious) score += 20;
      if (has(right, 'Determiner')) score -= 1;
      if (words.length - i === 1) score += 5;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    chunks.push(words.slice(0, best));
    words = words.slice(best);
  }
  if (words.length) chunks.push(words);
  return chunks;
}

function englishPhrases(clause) {
  const terms = nlp(clause).json({ offset: true }).flatMap((part) => part.terms);
  // Keep the original whitespace-delimited tokens: the tagger expands some
  // contractions internally, but the text and voice must never gain/lose words.
  const words = [...clause.matchAll(/\S+/gu)].map((match) => ({
    text: match[0],
    tags: new Set(terms.filter((term) => term.offset.length > 0
      && term.offset.start >= match.index && term.offset.start < match.index + match[0].length)
      .flatMap((term) => term.tags)),
  }));
  if (words.length <= MAX_WORDS && SUBORDINATE.test(clause.replace(/^["“‘«(]+/u, ''))) return [words];

  const cuts = new Set([0, words.length]);
  const protectedCuts = new Set();
  const normals = words.map((word) => word.text.toLowerCase().replace(/[^\p{L}]/gu, ''));
  for (const phrase of COMPOUND_PREPOSITIONS) {
    const parts = phrase.split(' ');
    for (let i = 0; i <= words.length - parts.length; i++) {
      if (parts.every((part, j) => normals[i + j] === part)) {
        if (i > 0) cuts.add(i);
        for (let j = 1; j < parts.length; j++) {
          protectedCuts.add(i + j);
          words[i + j].keepWithPrevious = true;
        }
      }
    }
  }
  for (let i = 1; i < words.length; i++) {
    if (has(words[i], 'Preposition') && !has(words[i], 'Verb') && !protectedCuts.has(i)) cuts.add(i);
  }

  const firstVerb = words.findIndex((word) => has(word, 'Verb'));
  if (firstVerb > 0 && words.slice(0, firstVerb).some((word) => has(word, 'Noun'))) {
    let start = firstVerb;
    while (start > 0 && has(words[start - 1], 'Adverb')) start--;
    if (start > 0) cuts.add(start);
  }

  const indexes = [...cuts].sort((a, b) => a - b);
  const phrases = indexes.slice(0, -1).map((start, i) => words.slice(start, indexes[i + 1]));
  // "jumps / over the lazy dog" and a lone subject pronoun are easier to hear
  // with their neighbour. "walked slowly" already has substance of its own.
  for (let i = 0; i + 1 < phrases.length; i++) {
    if (phrases[i].length === 1 && phrases[i].length + phrases[i + 1].length <= MAX_WORDS) {
      phrases.splice(i, 2, [...phrases[i], ...phrases[i + 1]]);
    }
  }
  return phrases.flatMap(bounded);
}

export function phraseSegments(clause, lang) {
  const phrases = /^en(?:-|$)/i.test(lang)
    ? englishPhrases(clause)
    : bounded(clause.match(/\S+/gu).map((text) => ({ text })));
  return phrases.map((words) => words.map((word) => word.text).join(' '));
}
