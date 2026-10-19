import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notebookPlan, segmentSentence, segmentTimes, classroomLink } from './notebook.js';

test('short sentences stay whole; long sentences split at commas without losing words', () => {
  assert.deepEqual(segmentSentence('Before lunch, we went home.'), ['Before lunch, we went home.']);
  const text = 'When the sun rose over the quiet village, the children packed their bags for school, and their parents walked with them to the old stone bridge.';
  const segments = segmentSentence(text);
  assert.equal(segments.length, 3);
  assert.equal(segments[0], 'When the sun rose over the quiet village,');
  assert.equal(segments.join(' '), text);
});

test('long unpunctuated clauses have bounded segments; sentence boundaries are preserved', () => {
  const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ') + '.';
  assert.ok(segmentSentence(text).every((segment) => segment.split(/\s+/).length <= 18));
  assert.equal(segmentSentence(text).join(' '), text);
  assert.deepEqual(notebookPlan('Dr. Smith arrived. We went home.').map((p) => p.sentence), ['Dr. Smith arrived.', 'We went home.']);
  assert.deepEqual(notebookPlan(''), []);
});

test('multilingual punctuation and closing quotes survive segmentation', () => {
  for (const text of [
    '« Quand nous sommes arrivés dans la petite ville, les enfants jouaient tranquillement dans le grand jardin, et les adultes préparaient ensemble le repas du soir. »',
    'حين وصلنا إلى المدينة في الصباح الباكر، كان الأطفال يلعبون في الحديقة قرب المدرسة، وكان الآباء ينتظرون بهدوء أمام الباب الكبير.',
  ]) {
    assert.equal(segmentSentence(text).join(' '), text);
  }
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

test('Classroom links cannot carry script URLs or lookalike domains', () => {
  assert.equal(classroomLink('https://classroom.google.com/c/class/a/work'), 'https://classroom.google.com/c/class/a/work');
  for (const value of ['javascript:alert(1)', 'https://classroom.google.com.evil.test/', 'http://classroom.google.com/', 'https://user:pw@classroom.google.com/', '']) assert.equal(classroomLink(value), '');
});
