import { splitIntoSentences } from './sentences.js';
import { phraseSegments } from './notebookPhrases.js';

// Punctuation sets the clause boundaries; grammar sets the smaller phrases
// inside them. Words and punctuation are preserved in the correction passage.
export function segmentSentence(sentence, lang = 'en-US') {
  const clauses = [];
  let start = 0;
  for (const match of sentence.matchAll(/[,;:،，；：]["”’»)]*(?=\s|$)/gu)) {
    const end = match.index + match[0].length;
    clauses.push(sentence.slice(start, end));
    start = end;
  }
  if (start < sentence.length) clauses.push(sentence.slice(start));
  return clauses.map((clause) => clause.trim()).filter(Boolean)
    .flatMap((clause) => phraseSegments(clause, lang));
}

export function notebookPlan(text, lang = 'en-US') {
  return splitIntoSentences(text).map((sentence) => ({ sentence, segments: segmentSentence(sentence, lang) }));
}

export { sentenceEndCue, segmentTimes } from './notebookShared.js';
