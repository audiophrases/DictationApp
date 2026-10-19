import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notebookPlan, segmentSentence, segmentTimes, sentenceEndCue } from './notebook.js';
import { validatedNotebookSegments } from './notebookShared.js';
import { wavClip } from './notebookWav.js';

test('short sentences split into subject and predicate phrases', () => {
  assert.deepEqual(segmentSentence('The quick brown fox jumps over the lazy dog.'), [
    'The quick brown fox', 'jumps over the lazy dog.',
  ]);
  assert.deepEqual(segmentSentence('Before lunch, we went home.'), ['Before lunch,', 'we went home.']);
});

test('the requested farmer passage splits into small grammatical phrases', () => {
  const text = 'In the early morning, when the mist still covered the valley, the farmer walked slowly to the barn, carrying two heavy buckets of fresh water for the animals.';
  assert.deepEqual(segmentSentence(text), [
    'In the early morning,', 'when the mist still covered the valley,',
    'the farmer', 'walked slowly', 'to the barn,',
    'carrying two heavy buckets', 'of fresh water', 'for the animals.',
  ]);
  assert.equal(segmentSentence(text).join(' '), text);
});

test('grammar tags do not expand contractions or split names and phrasal verbs', () => {
  for (const text of [
    "The little boy didn't want to go home.",
    'Dr. Smith visited New York at 12:30.',
    'They carefully picked up the old book.',
    'The statue in front of the old school was beautiful.',
  ]) {
    const segments = segmentSentence(text);
    assert.equal(segments.join(' '), text);
    for (const phrase of ['New York', 'picked up', 'in front of']) {
      if (text.includes(phrase)) assert.ok(segments.some((segment) => segment.includes(phrase)));
    }
  }
});

test('long unpunctuated clauses have bounded segments; sentence boundaries are preserved', () => {
  const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ') + '.';
  assert.ok(segmentSentence(text).every((segment) => segment.split(/\s+/).length <= 7));
  assert.equal(segmentSentence(text).join(' '), text);
  assert.deepEqual(notebookPlan('Dr. Smith arrived. We went home.').map((p) => p.sentence), ['Dr. Smith arrived.', 'We went home.']);
  assert.deepEqual(notebookPlan(''), []);
});

test('other languages get short fallback segments and preserve punctuation and quotes', () => {
  for (const [lang, text] of [
    ['fr-FR', '« Quand nous sommes arrivés dans la petite ville, les enfants jouaient tranquillement dans le grand jardin, et les adultes préparaient ensemble le repas du soir. »'],
    ['ar-MA', 'حين وصلنا إلى المدينة في الصباح الباكر، كان الأطفال يلعبون في الحديقة قرب المدرسة، وكان الآباء ينتظرون بهدوء أمام الباب الكبير.'],
  ]) {
    const segments = segmentSentence(text, lang);
    assert.equal(segments.join(' '), text);
    assert.ok(segments.every((segment) => segment.split(/\s+/).length <= 7));
  }
});

test('sentence-ending cue follows terminal punctuation and is localized', () => {
  assert.equal(sentenceEndCue('The dog.'), 'Period');
  assert.equal(sentenceEndCue('The dog, carrying a bag'), '');
  assert.equal(sentenceEndCue('The number is 3.14'), '');
  assert.equal(sentenceEndCue('« Bonjour.»', 'fr-FR'), 'Point');
  assert.equal(sentenceEndCue('Did she leave?'), 'Question mark');
  assert.equal(sentenceEndCue('Look!'), 'Exclamation mark');
  assert.equal(sentenceEndCue('Maybe...'), 'Ellipsis');
  assert.equal(sentenceEndCue('Maybe…'), 'Ellipsis');
  assert.equal(sentenceEndCue('أين الكتاب؟', 'ar-MA'), 'علامة استفهام');
});

test('punctuation recording is appended after silence within the same WAV clip', async () => {
  const audio = (values) => ({ sampleRate: 20, length: values.length, getChannelData: () => Float32Array.from(values) });
  const original = audio([0.25, 0.5, -0.25, -0.5]);
  const cue = audio([-1, 1]);
  const plain = new DataView(await wavClip(original, 0, 0.1).arrayBuffer());
  assert.equal(plain.getUint32(40, true), 4);
  const appended = new DataView(await wavClip(original, 0.1, 0.2, cue).arrayBuffer());
  assert.equal(appended.getUint32(40, true), (2 + 7 + 2) * 2);
  assert.equal(appended.getInt16(44, true), -8192);
  for (let i = 2; i < 9; i++) assert.equal(appended.getInt16(44 + i * 2, true), 0);
  assert.equal(appended.getInt16(44 + 9 * 2, true), -32768);
  assert.equal(appended.getInt16(44 + 10 * 2, true), 32767);
});

test('assignment validation accepts only segment plans preserving every original word', () => {
  const text = 'The quick brown fox jumps over the lazy dog.';
  const segments = segmentSentence(text);
  assert.deepEqual(validatedNotebookSegments(text, segments), segments);
  assert.equal(validatedNotebookSegments(text, [segments[0], segments[0], segments[1]]), null);
  assert.equal(validatedNotebookSegments(text, ['The quick fox', segments[1]]), null);
  assert.equal(validatedNotebookSegments(text, [text, 'Period']), null);
  assert.equal(validatedNotebookSegments(text, null), null);
});

test('numbers, clock times and URLs are not split at internal punctuation', () => {
  const text = 'We met all the children at exactly 12:30, then counted 1,000 small stones beside the river, before walking together back to the village.';
  const segments = segmentSentence(text);
  assert.equal(segments.join(' '), text);
  assert.ok(segments.some((segment) => segment.includes('1,000')));
  assert.ok(segments.some((segment) => segment.includes('12:30')));
});

test('voice timings align contractions and elisions and cut within pauses', () => {
  const boundaries = [
    { text: 'L', start: 0.1, end: 0.2 }, { text: 'enfant', start: 0.2, end: 0.8 },
    { text: 'arrive', start: 0.9, end: 1.2 }, { text: 'Hello', start: 1.8, end: 2.2 },
    { text: 'world', start: 2.3, end: 2.8 },
  ];
  assert.deepEqual(segmentTimes(["L’enfant arrive,", 'Hello world.'], boundaries, 3), [[0, 1.5], [1.5, 3]]);
  assert.deepEqual(segmentTimes(['Whole sentence.'], [], 2), [[0, 2]]);
  assert.throws(() => segmentTimes(['Missing words,', 'Hello world.'], boundaries, 3), /timing could not be matched/);
  assert.throws(() => segmentTimes(['Hello,', 'world.'], [{ text: 'Hello', start: 0, end: 5 }, { text: 'world', start: 6, end: 7 }], 3), /invalid segment timing/);
});
