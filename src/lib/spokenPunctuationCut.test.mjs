import assert from 'node:assert/strict';
import test from 'node:test';
import { spokenScript, noteKind, annotateSentence } from './spokenPunctuation.js';
import { spokenPunctuationRule, spokenPunctuationPolicy, describeSpokenPunctuation } from './punctuationPolicy.js';
import { planPunctuationCuts, removeSpans, applyPunctuationPolicy, GAP } from './spokenPunctuationCut.js';
import { sentenceCuts } from './audioSplits.js';

test('the rule: play punctuation when the student has to produce it', () => {
  const ignore = { ignoreCase: true, ignorePunctuation: true, ignoreAccents: true };
  const check = { ...ignore, ignorePunctuation: false };
  assert.deepEqual(spokenPunctuationRule({ mode: 'notebook', delivery: 'phrases' }), { ends: true, inner: true, paragraph: true });
  assert.deepEqual(spokenPunctuationRule({ mode: 'notebook', delivery: 'sentences' }), { ends: true, inner: true, paragraph: true });
  assert.deepEqual(spokenPunctuationRule({ mode: 'typing', delivery: 'sentences', grading: ignore }), { ends: false, inner: false, paragraph: false });
  assert.deepEqual(spokenPunctuationRule({ mode: 'typing', delivery: 'phrases', grading: ignore }), { ends: true, inner: false, paragraph: false });
  assert.deepEqual(spokenPunctuationRule({ mode: 'typing', delivery: 'sentences', grading: check }), { ends: false, inner: true, paragraph: false });
  assert.deepEqual(spokenPunctuationRule({ mode: 'typing', delivery: 'phrases', grading: check }), { ends: true, inner: true, paragraph: false });
  // Older typed records without an explicit delivery read full sentences.
  assert.deepEqual(spokenPunctuationRule({ mode: 'typing', grading: ignore }), { ends: false, inner: false, paragraph: false });
  // The override.
  assert.deepEqual(spokenPunctuationPolicy({ mode: 'typing', delivery: 'sentences', grading: ignore, spokenPunctuation: 'all' }), { ends: true, inner: true, paragraph: false });
  assert.deepEqual(spokenPunctuationPolicy({ mode: 'notebook', spokenPunctuation: 'all' }), { ends: true, inner: true, paragraph: true });
  assert.deepEqual(spokenPunctuationPolicy({ mode: 'notebook', spokenPunctuation: 'ends' }), { ends: true, inner: false, paragraph: false });
  assert.deepEqual(spokenPunctuationPolicy({ mode: 'notebook', spokenPunctuation: 'none' }), { ends: false, inner: false, paragraph: false });
  assert.deepEqual(spokenPunctuationPolicy({ mode: 'notebook', spokenPunctuation: 'auto' }), { ends: true, inner: true, paragraph: true });
  assert.equal(describeSpokenPunctuation({ ends: true, inner: false, paragraph: false }), 'spoken punctuation: sentence ends only');
  assert.equal(describeSpokenPunctuation({ ends: false, inner: false, paragraph: false }), 'spoken punctuation cut out');
});

test('the spoken script lists what the actor says, with each note’s kind', () => {
  const line = annotateSentence('He asked: "Are you homesick?"', 'en-US', { paragraph: true });
  assert.equal(line, 'He asked: [colon] [open quote] "Are you homesick?" [question mark] [close quote] [new paragraph]');
  const tokens = spokenScript(line);
  assert.deepEqual(tokens.map((t) => t.text), ['He', 'asked:', 'colon', 'open', 'quote', '"Are', 'you', 'homesick?"', 'question', 'mark', 'close', 'quote', 'new', 'paragraph']);
  assert.deepEqual(tokens.map((t) => t.note), [null, null, 'inner', 'inner', 'inner', null, null, null, 'end', 'end', 'inner', 'inner', 'paragraph', 'paragraph']);
  assert.deepEqual([...new Set(tokens.filter((t) => t.note).map((t) => t.group))], [1, 2, 3, 4, 5]);
  assert.equal(noteKind('punt i a part'), 'endParagraph');
  assert.equal(noteKind('signe d’interrogació'), 'end');
  assert.equal(noteKind('sic'), null);
  // A passage's own brackets are words, not notes.
  assert.deepEqual(spokenScript('He wrote [sic] this. [period]').map((t) => t.note), [null, null, null, null, 'end']);
});

const RATE = 1000;
const context = { createBuffer: (_, length, sampleRate) => {
  const samples = new Float32Array(length);
  return { sampleRate, length, duration: length / sampleRate, getChannelData: () => samples };
} };
function take(duration) {
  const samples = Float32Array.from({ length: duration * RATE }, (_, i) => Math.sin(i / 7) * 0.3);
  return { sampleRate: RATE, length: samples.length, duration, getChannelData: () => samples };
}
const said = (pairs) => pairs.map(([text, start, end]) => ({ text, start, end }));

test('notes are cut only by the policy and only when every word of them was heard', () => {
  const line = 'He asked: [colon] [open quote] "Are you homesick?" [question mark] [close quote]';
  const heard = said([['He', 0.2, 0.4], ['asked', 0.4, 0.7], ['colon', 0.8, 1.1], ['open', 1.2, 1.4], ['quote', 1.4, 1.7],
    ['are', 1.8, 1.9], ['you', 1.9, 2.0], ['homesick', 2.0, 2.5], ['question', 2.6, 2.9], ['mark', 2.9, 3.1], ['close', 3.2, 3.4], ['quote', 3.4, 3.7]]);
  const none = planPunctuationCuts(line, heard, 4.0, { ends: false, inner: false, paragraph: false });
  assert.equal(none.notes.cut, 4);
  // Notes said one after the other come out as one span ("colon, open quote"; "question mark, close quote").
  assert.deepEqual(none.removals.map((r) => [r.start.toFixed(2), r.end.toFixed(2), r.atEnd]),
    [['0.76', '1.74', false], ['2.56', '4.00', true]]);
  assert.deepEqual(none.boundaries.map((w) => w.text), ['He', 'asked:', '"Are', 'you', 'homesick?"']);
  const endsOnly = planPunctuationCuts(line, heard, 4.0, { ends: true, inner: false, paragraph: false });
  assert.equal(endsOnly.notes.cut, 3);
  assert.equal(endsOnly.notes.kept, 1);
  assert.equal(endsOnly.removals.some((r) => r.start > 2.5 && r.end < 3.15), false, 'the question mark stays');
  const all = planPunctuationCuts(line, heard, 4.0, { ends: true, inner: true, paragraph: true });
  assert.deepEqual(all.removals, []);
  // "quote" never heard the second time: that note is left alone, not guessed.
  const partial = planPunctuationCuts(line, heard.filter((w, i) => i !== 11), 4.0, { ends: false, inner: false, paragraph: false });
  assert.equal(partial.notes.unsure, 1);
  assert.equal(partial.removals.length, 2);
  assert.equal(partial.removals.at(-1).atEnd, false, 'the unsure close quote at the end stays');
  // The recogniser lost: nothing is planned.
  assert.equal(planPunctuationCuts(line, said([['the', 0.1, 0.2]]), 4.0, { ends: false, inner: false, paragraph: false }), null);
});

test('spans come out of the audio, inner ones leave a short gap, and timings follow', () => {
  const buffer = take(4.0);
  const removals = [{ start: 1.0, end: 1.5, atEnd: false }, { start: 3.5, end: 4.0, atEnd: true }];
  const { buffer: cut, map } = removeSpans(buffer, removals, context);
  assert.ok(Math.abs(cut.duration - (4.0 - 0.5 + GAP - 0.5)) < 0.002, `duration ${cut.duration}`);
  assert.equal(map(0.5), 0.5);
  assert.ok(Math.abs(map(2.0) - (2.0 - 0.5 + GAP)) < 0.002);
  assert.equal(map(1.2), map(1.0), 'inside a removed span collapses to its start');
  assert.ok(Math.abs(map(3.5) - cut.duration) < 0.002);
  assert.equal(removeSpans(buffer, [], context).buffer, buffer);
});

test('a take comes back cut, with the sentence words placed and usable for splitting', () => {
  const line = 'Moving abroad helped him. [period] [new paragraph]';
  const buffer = take(3.0);
  const heard = said([['Moving', 0.2, 0.6], ['abroad', 0.6, 1.0], ['helped', 1.1, 1.4], ['him', 1.4, 1.6], ['period', 1.8, 2.2], ['new', 2.3, 2.5], ['paragraph', 2.5, 2.9]]);
  const typed = applyPunctuationPolicy(line, heard, buffer, { ends: false, inner: false, paragraph: false }, context);
  assert.equal(typed.notes.cut, 2);
  assert.ok(typed.buffer.duration < 1.85 && typed.buffer.duration > 1.6, `cut to ${typed.buffer.duration}`);
  assert.deepEqual(typed.boundaries.map((w) => w.text), ['Moving', 'abroad', 'helped', 'him.']);
  assert.equal(typed.boundaries[3].end, 1.6);
  const cuts = sentenceCuts(['Moving abroad', 'helped him.'], typed.boundaries, typed.buffer.duration);
  assert.equal(cuts[1], (1.0 + 1.1) / 2);
  // Segments, typed: the period stays, the paragraph goes.
  const segments = applyPunctuationPolicy(line, heard, buffer, { ends: true, inner: false, paragraph: false }, context);
  assert.equal(segments.notes.cut, 1);
  assert.ok(segments.buffer.duration > 2.2 && segments.buffer.duration < 2.35, `kept the period: ${segments.buffer.duration}`);
  // Notebook: nothing changes.
  const notebook = applyPunctuationPolicy(line, heard, buffer, { ends: true, inner: true, paragraph: true }, context);
  assert.equal(notebook.buffer, buffer);
  assert.equal(notebook.notes.kept, 2);
});

test('with the audio at hand, a removal runs from the gap before the note to the gap after it', () => {
  // Speech only where words were said; silence between them.
  const spans = [[0.2, 0.6], [0.6, 1.0], [1.1, 1.4], [1.4, 1.6], [1.75, 2.25], [2.4, 2.9]];
  const samples = new Float32Array(3.0 * RATE);
  for (const [a, b] of spans) for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) samples[i] = 0.3 * Math.sin(i / 3);
  const buffer = { sampleRate: RATE, length: samples.length, duration: 3.0, getChannelData: () => samples };
  const line = 'Moving abroad helped him. [period] [new paragraph]';
  // The recogniser hears the period short and late, inside the word it was said over (1.75–2.25).
  const heard = said([['Moving', 0.2, 0.6], ['abroad', 0.6, 1.0], ['helped', 1.1, 1.4], ['him', 1.4, 1.6], ['period', 1.9, 2.1], ['new', 2.4, 2.6], ['paragraph', 2.6, 2.9]]);
  const plan = planPunctuationCuts(line, heard, buffer, { ends: false, inner: false, paragraph: false });
  assert.equal(plan.removals.length, 1, 'period and new paragraph merge');
  const [r] = plan.removals;
  assert.ok(r.start > 1.6 && r.start < 1.76, `starts in the gap before the period: ${r.start}`);
  assert.equal(r.end, 3.0);
  // Same take with only the paragraph cut: the gap after the period is found too.
  const ends = planPunctuationCuts(line, heard, buffer, { ends: true, inner: false, paragraph: false });
  assert.ok(ends.removals[0].start > 2.25 && ends.removals[0].start < 2.41, `starts in the gap after the period: ${ends.removals[0].start}`);
});

test('levels: what actors say, what students hear, what gets marked', async () => {
  const { scriptLevel } = await import('./spokenPunctuation.js');
  const { heardPunctuation, describeHeard, policyForLevel, dictationLevelAtLeast } = await import('./punctuationPolicy.js');
  const sentence = 'He asked: "Are you, friend, homesick?"';
  for (const level of ['none', 'ends', 'inner', 'all']) {
    assert.equal(scriptLevel([annotateSentence(sentence, 'en-US', { level, paragraph: true })]), level, level);
  }
  assert.equal(scriptLevel(['No notes here.']), 'none');
  assert.equal(scriptLevel(['Fin. [punto y aparte]']), 'ends');
  // Typed full sentences with Check: the period is cut, commas and colons heard.
  const typedFull = spokenPunctuationRule({ mode: 'typing', delivery: 'sentences', grading: { ignorePunctuation: false } });
  assert.equal(heardPunctuation('all', typedFull), 'inner,commas');
  assert.equal(heardPunctuation('ends', typedFull), '');
  // Typed segments, punctuation ignored: only sentence ends are played.
  assert.equal(heardPunctuation('all', spokenPunctuationRule({ mode: 'typing', delivery: 'phrases', grading: { ignorePunctuation: true } })), 'ends');
  assert.equal(heardPunctuation('all', spokenPunctuationRule({ mode: 'notebook' })), 'ends,inner,commas');
  assert.equal(heardPunctuation('none', spokenPunctuationRule({ mode: 'notebook' })), '');
  assert.equal(describeHeard('ends,inner,commas'), 'sentence ends, colons, semicolons and quotes and commas');
  assert.equal(describeHeard(''), 'no punctuation');
  assert.deepEqual(policyForLevel('ends', 'notebook'), { ends: true, inner: false, paragraph: true });
  assert.equal(dictationLevelAtLeast('inner', 'ends'), true);
});
