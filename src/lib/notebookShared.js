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

const normalized = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Align the voice's words against each segment without relying on whitespace
// token counts (French elisions, numbers and contractions may be tokenized differently).
export function segmentTimes(segments, boundaries, duration) {
  if (segments.length === 1) return [[0, duration]];
  const words = boundaries.filter((b) => normalized(b.text));
  const cuts = [0];
  let cursor = 0;
  for (const segment of segments.slice(0, -1)) {
    const target = normalized(segment);
    let matched = '';
    while (cursor < words.length && matched.length < target.length) {
      matched += normalized(words[cursor++].text);
    }
    if (matched !== target || cursor >= words.length) {
      throw new Error('The voice timing could not be matched to this passage. Try simplifying its punctuation.');
    }
    const previousEnd = words[cursor - 1].end;
    const nextStart = words[cursor].start;
    const cut = (previousEnd + nextStart) / 2;
    if (!Number.isFinite(cut) || cut <= cuts.at(-1) || cut >= duration) {
      throw new Error('The voice returned invalid segment timing. Please try recording again.');
    }
    cuts.push(cut);
  }
  cuts.push(duration);
  return segments.map((_, i) => [cuts[i], cuts[i + 1]]);
}
