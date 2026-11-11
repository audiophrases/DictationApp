// The punctuation a human reader says aloud in a dictation, written into the
// lines of a PinPlay recording session in [square brackets] so the actor
// remembers to say it: periods, question and exclamation marks, colons,
// semicolons, commas, quotation marks and new paragraphs, in the dictation's language.
//
//   He said: “Stop.”   →   He said: [colon] [open quote] “Stop.” [period] [close quote]
//
// Notes go where the mark is said: an opening quote's before it, the others
// after their run of punctuation, in reading order. Only these notes are ever
// removed again (stripSpokenPunctuation), so a passage's own brackets such as
// [sic] stay part of the sentence.
import { splitIntoSentences } from './sentences.js';

const WORDS = {
  en: { comma: 'comma', period: 'period', question: 'question mark', exclamation: 'exclamation mark', ellipsis: 'ellipsis',
    colon: 'colon', semicolon: 'semicolon', openQuote: 'open quote', closeQuote: 'close quote',
    paragraph: 'new paragraph' },
  ca: { comma: 'coma', period: 'punt', question: 'signe d’interrogació', exclamation: 'signe d’exclamació', ellipsis: 'punts suspensius',
    colon: 'dos punts', semicolon: 'punt i coma', openQuote: 'obre cometes', closeQuote: 'tanca cometes',
    paragraph: 'nou paràgraf', periodParagraph: 'punt i a part' },
  es: { comma: 'coma', period: 'punto', question: 'signo de interrogación', exclamation: 'signo de exclamación', ellipsis: 'puntos suspensivos',
    colon: 'dos puntos', semicolon: 'punto y coma', openQuote: 'abre comillas', closeQuote: 'cierra comillas',
    paragraph: 'nuevo párrafo', periodParagraph: 'punto y aparte',
    openQuestion: 'abre interrogación', closeQuestion: 'cierra interrogación',
    openExclamation: 'abre exclamación', closeExclamation: 'cierra exclamación' },
  fr: { comma: 'virgule', period: 'point', question: 'point d’interrogation', exclamation: 'point d’exclamation', ellipsis: 'points de suspension',
    colon: 'deux-points', semicolon: 'point-virgule', openQuote: 'ouvrez les guillemets', closeQuote: 'fermez les guillemets',
    paragraph: 'à la ligne', periodParagraph: 'point à la ligne' },
  de: { comma: 'Komma', period: 'Punkt', question: 'Fragezeichen', exclamation: 'Ausrufezeichen', ellipsis: 'Auslassungspunkte',
    colon: 'Doppelpunkt', semicolon: 'Semikolon', openQuote: 'Anführungszeichen auf', closeQuote: 'Anführungszeichen zu',
    paragraph: 'neuer Absatz' },
  it: { comma: 'virgola', period: 'punto', question: 'punto interrogativo', exclamation: 'punto esclamativo', ellipsis: 'puntini di sospensione',
    colon: 'due punti', semicolon: 'punto e virgola', openQuote: 'aperte virgolette', closeQuote: 'chiuse virgolette',
    paragraph: 'a capo', periodParagraph: 'punto e a capo' },
  pt: { comma: 'vírgula', period: 'ponto final', question: 'ponto de interrogação', exclamation: 'ponto de exclamação', ellipsis: 'reticências',
    colon: 'dois pontos', semicolon: 'ponto e vírgula', openQuote: 'abre aspas', closeQuote: 'fecha aspas',
    paragraph: 'parágrafo', periodParagraph: 'ponto parágrafo' },
  ro: { comma: 'virgulă', period: 'punct', question: 'semn de întrebare', exclamation: 'semn de exclamare', ellipsis: 'puncte de suspensie',
    colon: 'două puncte', semicolon: 'punct și virgulă', openQuote: 'deschid ghilimelele', closeQuote: 'închid ghilimelele',
    paragraph: 'de la capăt', periodParagraph: 'punct și de la capăt' },
  ru: { comma: 'запятая', period: 'точка', question: 'вопросительный знак', exclamation: 'восклицательный знак', ellipsis: 'многоточие',
    colon: 'двоеточие', semicolon: 'точка с запятой', openQuote: 'открыть кавычки', closeQuote: 'закрыть кавычки',
    paragraph: 'абзац' },
  uk: { comma: 'кома', period: 'крапка', question: 'знак питання', exclamation: 'знак оклику', ellipsis: 'три крапки',
    colon: 'двокрапка', semicolon: 'крапка з комою', openQuote: 'відкрити лапки', closeQuote: 'закрити лапки',
    paragraph: 'абзац' },
  ar: { comma: 'فاصلة', period: 'نقطة', question: 'علامة استفهام', exclamation: 'علامة تعجب', ellipsis: 'نقاط الحذف',
    colon: 'نقطتان', semicolon: 'فاصلة منقوطة', openQuote: 'افتح علامتي التنصيص', closeQuote: 'أغلق علامتي التنصيص',
    paragraph: 'فقرة جديدة' },
};
const wordsFor = (lang) => WORDS[String(lang || '').split('-')[0]] || WORDS.en;

// Every note in every language: only these are ever stripped. Notes said
// before their mark take the space after them with them, the others the
// space before.
const BEFORE = new Set();
const AFTER = new Set();
const PARAGRAPH = new Set();
// What each note is, for deciding whether students hear it (punctuationPolicy.js):
// 'end' closes the sentence, 'inner' sits inside it, 'paragraph' starts a new
// one, 'endParagraph' does both in one phrase (Catalan "punt i a part").
const KINDS = { comma: 'inner', period: 'end', question: 'end', exclamation: 'end', ellipsis: 'end', closeQuestion: 'end', closeExclamation: 'end',
  colon: 'inner', semicolon: 'inner', openQuote: 'inner', closeQuote: 'inner', openQuestion: 'inner', openExclamation: 'inner',
  paragraph: 'paragraph', periodParagraph: 'endParagraph' };
const NOTE_KIND = new Map();
for (const w of Object.values(WORDS)) {
  for (const [key, word] of Object.entries(w)) { (/^open/.test(key) ? BEFORE : AFTER).add(word); NOTE_KIND.set(word, KINDS[key]); }
  PARAGRAPH.add(w.paragraph);
  if (w.periodParagraph) PARAGRAPH.add(w.periodParagraph);
}
export const noteKind = (word) => NOTE_KIND.get(word) || null;

/**
 * The words an actor says for an annotated line, in order: the sentence's
 * words (note: null) and each bracket note's words (note: its kind, group:
 * one id per note), so a recording can be aligned against what was said.
 */
export function spokenScript(line) {
  const tokens = [];
  let group = 0;
  const re = /\[([^[\]]{1,40})\]|\S+/gu;
  for (const m of String(line || '').matchAll(re)) {
    const kind = m[1] !== undefined ? noteKind(m[1]) : null;
    if (m[1] !== undefined && !kind) { tokens.push({ text: m[0], note: null }); continue; } // a passage's own [sic]
    if (kind) { group += 1; for (const word of m[1].split(/\s+/u)) tokens.push({ text: word, note: kind, group }); }
    else tokens.push({ text: m[0], note: null });
  }
  return tokens;
}

const compact = (text) => String(text || '').replace(/\s+/gu, ' ').trim();
const SPACE = /[\s  ]/u;
const QUESTION = /[?？؟]/u;
const EXCLAMATION = /[!！]/u;
const SEMICOLON = /[;؛]/u;
const CLOSERS = /[)\]’'›]/u; // carried along in a run of punctuation, never said

// A straight " opens when it starts a word, otherwise it closes.
function straightQuoteOpens(text, i) {
  const before = text[i - 1];
  const after = text[i + 1];
  return (!before || SPACE.test(before) || /[([{—–-]/u.test(before)) && !!after && !SPACE.test(after);
}

// What each character says: { before: word } | { after: word } | null.
function marks(sentence, w, lang, paragraph) {
  const de = String(lang || '').startsWith('de');
  const end = sentence.match(/(\.{3}|…|[.!?؟。！？])["'“”’»)\]\s]*$/u);
  const endIndex = end ? end.index + end[1].length - 1 : -1;
  const endsWithPeriod = !!end && end[1] === '.';
  const out = [];
  let openQuestion = false;
  let openExclamation = false;
  for (let i = 0; i < sentence.length; i++) {
    const ch = sentence[i];
    const next = sentence[i + 1];
    const freeAfter = !next || SPACE.test(next) || /["“”«»„)]/u.test(next);
    let mark = null;
    if (ch === '¿' && w.openQuestion) { mark = { before: w.openQuestion }; openQuestion = true; }
    else if (ch === '¡' && w.openExclamation) { mark = { before: w.openExclamation }; openExclamation = true; }
    else if (QUESTION.test(ch)) {
      if (!QUESTION.test(sentence[i - 1] || '')) mark = { after: openQuestion ? w.closeQuestion : w.question };
      openQuestion = false;
    } else if (EXCLAMATION.test(ch)) {
      if (!EXCLAMATION.test(sentence[i - 1] || '')) mark = { after: openExclamation ? w.closeExclamation : w.exclamation };
      openExclamation = false;
    } else if (i === endIndex && (ch === '…' || end[1] === '...')) mark = { after: w.ellipsis };
    else if (i === endIndex && endsWithPeriod) mark = { after: paragraph && w.periodParagraph ? w.periodParagraph : w.period };
    else if (ch === ',' && freeAfter) mark = { after: w.comma };
    else if (ch === ':' && freeAfter) mark = { after: w.colon };
    else if (SEMICOLON.test(ch) && freeAfter) mark = { after: w.semicolon };
    else if (ch === '«' || ch === '„' || (ch === '“' && !de)) mark = { before: w.openQuote };
    else if (ch === '»' || ch === '”' || (ch === '“' && de)) mark = { after: w.closeQuote };
    else if (ch === '"') mark = straightQuoteOpens(sentence, i) ? { before: w.openQuote } : { after: w.closeQuote };
    out.push(mark);
  }
  return out;
}

// Does the run of punctuation that character i belongs to go on after it?
function runContinues(sentence, found, i) {
  const next = sentence[i + 1];
  if (next === undefined) return false;
  if (found[i + 1]?.after || CLOSERS.test(next) || /[.…?!？！؟]/u.test(next)) return true;
  // French spacing: « Bonjour ! » keeps the space inside the run.
  return SPACE.test(next) && !!found[i + 2]?.after && /[?!:;»؟！？]/u.test(sentence[i + 2]);
}

/** The sentence with its punctuation to say aloud in [brackets]. */
export function annotateSentence(sentence, lang = 'en-US', { paragraph = false } = {}) {
  const text = compact(sentence);
  const w = wordsFor(lang);
  const found = marks(text, w, lang, paragraph);
  let out = '';
  let pending = [];
  const flush = () => { out += pending.map((word) => ` [${word}]`).join(''); pending = []; };
  for (let i = 0; i < text.length; i++) {
    if (found[i]?.before) { flush(); out += `[${found[i].before}] `; }
    out += text[i];
    if (found[i]?.after) pending.push(found[i].after);
    if (pending.length && !runContinues(text, found, i)) flush();
  }
  flush();
  const periodSaidIt = paragraph && w.periodParagraph && /\.["'“”’»)\]]*$/u.test(text) && !/\.{3}["'“”’»)\]]*$/u.test(text);
  if (paragraph && !periodSaidIt) out += ` [${w.paragraph}]`;
  return out;
}

/** The sentence again, without the notes annotateSentence added. */
export function stripSpokenPunctuation(text) {
  return compact(String(text || '')
    .replace(/\[([^[\]]{1,40})\]\s*/gu, (all, word) => (BEFORE.has(word) ? '' : all))
    .replace(/\s*\[([^[\]]{1,40})\]/gu, (all, word) => (AFTER.has(word) ? '' : all)));
}

const lastNote = (text) => compact(text).match(/\[([^[\]]{1,40})\]$/u)?.[1] || '';
export const endsParagraph = (text) => PARAGRAPH.has(lastNote(text));
export const hasSpokenPunctuation = (text) => stripSpokenPunctuation(text) !== compact(text);

/**
 * For each sentence, whether a new paragraph starts after it: a line break
 * follows it in the passage and more text comes. All false when the passage
 * isn't the one these sentences came from (an assignment's stored phrases).
 */
export function paragraphEnds(passage, sentences) {
  const lines = String(passage || '').split(/\n+/u).map((line) => splitIntoSentences(line)).filter((line) => line.length);
  const flat = lines.flat();
  if (flat.length !== sentences.length || flat.some((s, i) => compact(s) !== compact(sentences[i]))) return sentences.map(() => false);
  return lines.flatMap((line, l) => line.map((_, k) => k === line.length - 1 && l < lines.length - 1));
}
