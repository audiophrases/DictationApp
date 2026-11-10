import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annotateSentence, endsParagraph, hasSpokenPunctuation, paragraphEnds, stripSpokenPunctuation,
} from './spokenPunctuation.js';
import { sentenceEndCue } from './notebookShared.js';
import { splitIntoSentences } from './sentences.js';

const say = (sentence, lang, paragraph = false) => annotateSentence(sentence, lang, { paragraph });

test('American English: the main punctuation, in reading order', () => {
  assert.equal(say('Moving abroad was hard.'), 'Moving abroad was hard. [period]');
  assert.equal(say('Was it hard?'), 'Was it hard? [question mark]');
  assert.equal(say('It was hard!'), 'It was hard! [exclamation mark]');
  assert.equal(say('He waited...'), 'He waited... [ellipsis]');
  assert.equal(say('You need three things: time, money and luck.'), 'You need three things: [colon] time, money and luck. [period]');
  assert.equal(say('It rained; we stayed in.'), 'It rained; [semicolon] we stayed in. [period]');
  assert.equal(say('He said: “Stop.”'), 'He said: [colon] [open quote] “Stop.” [period] [close quote]');
  assert.equal(say('"Why?" she asked.'), '[open quote] "Why?" [question mark] [close quote] she asked. [period]');
  assert.equal(say('The word “home” matters.'), 'The word [open quote] “home” [close quote] matters. [period]');
  assert.equal(say('“Yes”, he said.'), '[open quote] “Yes” [close quote], he said. [period]');
  assert.equal(say('The end.', 'en-US', true), 'The end. [period] [new paragraph]');
  assert.equal(say('Is it the end?', 'en-US', true), 'Is it the end? [question mark] [new paragraph]');
});

test('only real punctuation is said: not commas, abbreviations, times, links or apostrophes', () => {
  assert.equal(say('Dr. Smith met Mr. Jones at 10:30, didn’t he?'), 'Dr. Smith met Mr. Jones at 10:30, didn’t he? [question mark]');
  assert.equal(say('See https://example.com for the 3.5 version.'), 'See https://example.com for the 3.5 version. [period]');
  assert.equal(say('What?! Really?!'), 'What?! [question mark] [exclamation mark] Really?! [question mark] [exclamation mark]');
  assert.equal(say('Stop!!!'), 'Stop!!! [exclamation mark]');
  assert.equal(say('A title without a period'), 'A title without a period');
  assert.equal(say('He wrote [sic] this.'), 'He wrote [sic] this. [period]');
});

test('each language says it its own way', () => {
  assert.equal(say('¿Vienes mañana?', 'es-ES'), '[abre interrogación] ¿Vienes mañana? [cierra interrogación]');
  assert.equal(say('¡Qué bien!', 'es-ES'), '[abre exclamación] ¡Qué bien! [cierra exclamación]');
  assert.equal(say('Fin.', 'es-ES', true), 'Fin. [punto y aparte]');
  assert.equal(say('Dijo: «Ven».', 'es-ES', true), 'Dijo: [dos puntos] [abre comillas] «Ven». [cierra comillas] [punto y aparte]');
  assert.equal(say('Ja és aquí.', 'ca-ES', true), 'Ja és aquí. [punt i a part]');
  assert.equal(say('Ja és aquí?', 'ca-ES', true), 'Ja és aquí? [signe d’interrogació] [nou paràgraf]');
  assert.equal(say('Il dit : « Bonjour ! »', 'fr-FR'),
    'Il dit : [deux-points] [ouvrez les guillemets] « Bonjour ! » [point d’exclamation] [fermez les guillemets]');
  assert.equal(say('C’est fini.', 'fr-FR', true), 'C’est fini. [point à la ligne]');
  assert.equal(say('Er sagte: „Komm.“', 'de-DE', true),
    'Er sagte: [Doppelpunkt] [Anführungszeichen auf] „Komm.“ [Punkt] [Anführungszeichen zu] [neuer Absatz]');
  assert.equal(say('È finita.', 'it-IT', true), 'È finita. [punto e a capo]');
  assert.equal(say('Acabou.', 'pt-PT', true), 'Acabou. [ponto parágrafo]');
  assert.equal(say('Он ушёл; всё.', 'ru-RU', true), 'Он ушёл; [точка с запятой] всё. [точка] [абзац]');
  assert.equal(say('هل أنت هنا؟', 'ar-MA'), 'هل أنت هنا؟ [علامة استفهام]');
});

test('sentence ends match the TTS punctuation cues the app already says', () => {
  for (const lang of ['en-US', 'ca-ES', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'ro-RO', 'ru-RU', 'uk-UA', 'ar-MA']) {
    for (const sentence of ['Word.', 'Word?', 'Word!', 'Word...']) {
      const cue = sentenceEndCue(sentence, lang);
      const said = lang.startsWith('de') ? cue : cue[0].toLowerCase() + cue.slice(1);
      assert.equal(say(sentence, lang), `${sentence} [${said}]`, `${lang} ${sentence}`);
    }
  }
});

test('the notes come off again exactly, and nothing else does', () => {
  const sentences = [
    'He said: “Stop.”', '"Why?" she asked.', '“Yes”, he said.', 'He wrote [sic] this.', 'He said:“Hi.”', '(“Quoted”) text.',
    'Il dit : « Bonjour ! »', 'Er sagte: „Komm.“', '¿Vienes? ¡Sí!', 'It rained; we stayed in.', 'Dr. Smith at 10:30.',
    'What?! Really?!', 'He waited...', 'هل أنت هنا؟', 'A title without a period',
  ];
  const langs = { 'Il dit : « Bonjour ! »': 'fr-FR', 'Er sagte: „Komm.“': 'de-DE', '¿Vienes? ¡Sí!': 'es-ES', 'هل أنت هنا؟': 'ar-MA' };
  for (const sentence of sentences) {
    for (const paragraph of [false, true]) {
      const notes = say(sentence, langs[sentence] || 'en-US', paragraph);
      assert.equal(stripSpokenPunctuation(notes), sentence, notes);
      assert.equal(endsParagraph(notes), paragraph, notes);
    }
  }
  assert.equal(hasSpokenPunctuation('Moving abroad. [period]'), true);
  assert.equal(hasSpokenPunctuation('He wrote [sic] this.'), false);
  assert.equal(stripSpokenPunctuation('A [footnote] here.'), 'A [footnote] here.');
});

test('a new paragraph follows a line break, never the last sentence', () => {
  const passage = 'One. Two?\nThree.\n\n  \nFour: five.';
  const sentences = splitIntoSentences(passage);
  assert.deepEqual(sentences, ['One.', 'Two?', 'Three.', 'Four: five.']);
  assert.deepEqual(paragraphEnds(passage, sentences), [false, true, true, false]);
  assert.deepEqual(paragraphEnds('One. Two? Three. Four: five.', sentences), [false, false, false, false]);
  assert.deepEqual(paragraphEnds('', sentences), [false, false, false, false]);
});
