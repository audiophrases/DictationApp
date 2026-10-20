import { splitIntoSentences } from './sentences.js';
import { phraseSegments } from './notebookPhrases.js';

// The phrases a sentence is read out in. Words and punctuation are preserved,
// so the phrases joined with spaces are the sentence itself.
export function segmentSentence(sentence, lang = 'en-US') {
  return phraseSegments(sentence.trim(), lang);
}

export function notebookPlan(text, lang = 'en-US', delivery = 'phrases') {
  return splitIntoSentences(text).map((sentence) => ({
    sentence,
    segments: delivery === 'sentences' ? [sentence] : segmentSentence(sentence, lang),
  }));
}

export { sentenceEndCue } from './notebookShared.js';
