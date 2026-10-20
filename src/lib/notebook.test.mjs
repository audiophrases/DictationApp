import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notebookPlan, segmentSentence, sentenceEndCue } from './notebook.js';
import { spokenPhrase, validatedNotebookSegments } from './notebookShared.js';
import { trimTrailingSilence, wavClip } from './notebookWav.js';

const words = (phrase) => phrase.split(/\s+/).length;

test('sentences split into phrases a teacher would say, not two-word scraps', () => {
  const cases = {
    'I agree with your point, but we should consider the budget.': ['I agree with your point,', 'but we should consider the budget.'],
    'In my opinion, the long-term benefits are more important.': ['In my opinion,', 'the long-term benefits are more important.'],
    'She gave evidence to support her argument.': ['She gave evidence', 'to support her argument.'],
    'We reached a compromise after a long discussion.': ['We reached a compromise', 'after a long discussion.'],
    "It's hard to decide when both options seem reasonable.": ["It's hard to decide", 'when both options seem reasonable.'],
    'They challenged the proposal with specific examples.': ['They challenged the proposal', 'with specific examples.'],
    'The quick brown fox jumps over the lazy dog.': ['The quick brown fox', 'jumps over the lazy dog.'],
    'The statue in front of the old school was beautiful.': ['The statue in front of the old school', 'was beautiful.'],
    'The man who lives next door has not called me yet.': ['The man who lives next door', 'has not called me yet.'],
    'Before lunch, we went home.': ['Before lunch, we went home.'],
    'Yes, I do.': ['Yes, I do.'],
    'Moving abroad helped him understand his own culture.': ['Moving abroad helped him', 'understand his own culture.'],
    'We celebrated the festival with music and traditional food.': ['We celebrated the festival', 'with music and traditional food.'],
    'Language is a key part of personal identity.': ['Language is a key part', 'of personal identity.'],
    'I was surprised by how quickly local customs felt natural.': ['I was surprised', 'by how quickly local customs felt natural.'],
    // An object followed by its verb ("helps people connect") is not a subject break.
    'Sharing stories helps people connect across differences.': ['Sharing stories helps people connect across differences.'],
  };
  for (const [text, expected] of Object.entries(cases)) assert.deepEqual(segmentSentence(text), expected, text);
});

test('the farmer passage splits at its clauses and prepositions, three words or more', () => {
  const text = 'In the early morning, when the mist still covered the valley, the farmer walked slowly to the barn, carrying two heavy buckets of fresh water for the animals.';
  const segments = segmentSentence(text);
  assert.deepEqual(segments, [
    'In the early morning,', 'when the mist still covered the valley,',
    'the farmer walked slowly', 'to the barn,',
    'carrying two heavy buckets', 'of fresh water for the animals.',
  ]);
  assert.equal(segments.join(' '), text);
});

test('no phrase ends on a word that leans on the next one', () => {
  const leaning = /^(the|a|an|to|of|in|on|at|with|for|and|but|or|my|your|his|her|their|our|its)$/i;
  for (const text of [
    'We met all the children at exactly 12:30, then counted 1,000 small stones beside the river, before walking together back to the village.',
    'The teacher asked the students to write a short story about their favourite holiday in the mountains.',
    'My brother and his friends were playing football in the park near our house when it started to rain.',
  ]) {
    const segments = segmentSentence(text);
    assert.equal(segments.join(' '), text);
    for (const segment of segments) {
      assert.ok(words(segment) >= 3, `too short: "${segment}"`);
      assert.ok(!leaning.test(segment.split(/\s+/).at(-1).replace(/[^\p{L}]/gu, '')), `ends on a leaning word: "${segment}"`);
    }
  }
});

test('phrases that continue the sentence are voiced with a continuing comma', () => {
  assert.equal(spokenPhrase("It's hard to decide", false), "It's hard to decide,");
  assert.equal(spokenPhrase('I agree with your point,', false), 'I agree with your point,');
  assert.equal(spokenPhrase('In this case:', false), 'In this case:');
  assert.equal(spokenPhrase('when both options seem reasonable.', true), 'when both options seem reasonable.');
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
  assert.deepEqual(
    segmentSentence('« Quand nous sommes arrivés dans la petite ville, les enfants jouaient. »', 'fr-FR')[0],
    '« Quand nous sommes arrivés',
  );
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

test('the punctuation cue keeps only a short tail of its trailing silence', async () => {
  const rate = 100; // 0.15 s tail = 15 samples
  const spoken = [0.5, -0.5, 0.5];
  const padded = Float32Array.from([...spoken, ...Array(125).fill(0.001)]);
  assert.equal(trimTrailingSilence(padded, rate).length, 3 + 15);
  assert.equal(trimTrailingSilence(Float32Array.from([...spoken, 0, 0]), rate).length, 5);
  const original = { sampleRate: rate, length: 2, getChannelData: () => Float32Array.from([0.25, 0.25]) };
  const cue = { sampleRate: rate, length: padded.length, getChannelData: () => padded };
  const clip = new DataView(await wavClip(original, 0, 0.02, cue).arrayBuffer());
  assert.equal(clip.getUint32(40, true), (2 + 35 + 3 + 15) * 2);
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
