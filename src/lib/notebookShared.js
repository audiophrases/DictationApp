import { splitIntoSentences } from './sentences.js';

// The teacher browser supplies the phrase plan. Check it against the original
// passage without loading the English language model in the assignment Worker.
export function validatedNotebookSegments(text, segments) {
  if (!Array.isArray(segments) || !segments.length || segments.some((s) => typeof s !== 'string' || !s.trim())) return null;
  const compact = (value) => value.trim().replace(/\s+/gu, ' ');
  const expected = compact(splitIntoSentences(text).join(' '));
  if (compact(segments.join(' ')) !== expected) return null;
  return segments.map(compact);
}

const END_CUES = {
  en: ['Period', 'Question mark', 'Exclamation mark', 'Ellipsis'],
  ca: ['Punt', 'Signe d’interrogació', 'Signe d’exclamació', 'Punts suspensius'],
  fr: ['Point', 'Point d’interrogation', 'Point d’exclamation', 'Points de suspension'],
  de: ['Punkt', 'Fragezeichen', 'Ausrufezeichen', 'Auslassungspunkte'],
  it: ['Punto', 'Punto interrogativo', 'Punto esclamativo', 'Puntini di sospensione'],
  ar: ['نقطة', 'علامة استفهام', 'علامة تعجب', 'نقاط الحذف'],
  pt: ['Ponto final', 'Ponto de interrogação', 'Ponto de exclamação', 'Reticências'],
  ro: ['Punct', 'Semn de întrebare', 'Semn de exclamare', 'Puncte de suspensie'],
  ru: ['Точка', 'Вопросительный знак', 'Восклицательный знак', 'Многоточие'],
  es: ['Punto', 'Signo de interrogación', 'Signo de exclamación', 'Puntos suspensivos'],
  uk: ['Крапка', 'Знак питання', 'Знак оклику', 'Три крапки'],
};

export function sentenceEndCue(sentence, lang = 'en-US') {
  const end = sentence.trim().match(/(\.{3}|…|[.!?؟。！？])["'”’»)\]]*$/u)?.[1];
  if (!end) return '';
  const cues = END_CUES[lang.split('-')[0]] || END_CUES.en;
  const index = /^(?:\.{3}|…)$/.test(end) ? 3 : /[?؟？]/u.test(end) ? 1 : /[!！]/u.test(end) ? 2 : 0;
  return cues[index];
}

// What the voice is given for one phrase. A phrase that doesn't end the
// sentence gets a trailing comma if it has no punctuation of its own, so it is
// read with a continuing rise rather than the drop of a finished sentence.
// Voice text only: what students write and are marked on is the phrase itself.
export function spokenPhrase(phrase, isLast) {
  if (isLast || /[,;:—–]["”’»)]*$/u.test(phrase)) return phrase;
  return `${phrase},`;
}
