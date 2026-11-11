import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { sentenceCuts, estimatedCuts, validateCuts, moveSplitWord } from './audioSplits.js';

const boundaries = [
  { text: 'Moving', start: 0.1, end: 0.46 },
  { text: 'abroad', start: 0.475, end: 0.9 },
  { text: 'helped', start: 0.9125, end: 1.16 },
  { text: 'him', start: 1.175, end: 1.29 },
];

test('cuts use the gap between phrases, retaining the complete recording', () => {
  assert.deepEqual(sentenceCuts(['Moving abroad', 'helped him.'], boundaries, 1.5), [0, 0.90625, 1.5]);
  assert.deepEqual(sentenceCuts(['One sentence.'], undefined, 2), [0, 2]);
});
test('contractions and punctuation can use different voice tokenization', () => {
  assert.deepEqual(sentenceCuts(["Don't", 'go!'], [
    { text: 'Don', start: 0.1, end: 0.2 }, { text: 't', start: 0.2, end: 0.3 },
    { text: 'go', start: 0.4, end: 0.5 },
  ], 1), [0, 0.35, 1]);
});
test('expanded numbers, incomplete timing and invalid ranges require review', () => {
  assert.throws(() => sentenceCuts(['12', 'people.'], [{ text: 'twelve', start: 0.1, end: 0.3 }], 1));
  assert.throws(() => sentenceCuts(['Moving abroad', 'helped him.'], boundaries.slice(0, 3), 1.5));
  assert.throws(() => sentenceCuts(['Moving abroad', 'helped him.'], [{ ...boundaries[0], start: NaN }, ...boundaries.slice(1)], 1.5));
  for (const cuts of [[0, 1, 0.5, 2], [0, 1, 1, 2], [0, NaN, 2], [0, 1, 3]]) {
    assert.throws(() => validateCuts(cuts, cuts.length - 1, 2));
  }
  const estimates = estimatedCuts(['12', 'people.'], 2);
  validateCuts(estimates, 2, 2);
});

const bundled = await build({ entryPoints: ['src/lib/notebookAudio.js'], bundle: true, write: false,
  platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
const { prepareSentenceRecording, prepareHumanSentenceRecording, prepareReviewedAudio, recordingClips } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const buffer = { sampleRate: 100, duration: 1.5, length: 150, getChannelData: () => Float32Array.from({ length: 150 }, () => 0.2) };

test('synthesis receives the full sentence once; manual cuts reuse its audio', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(new URL(url, 'http://localhost'));
    return { ok: true, json: async () => ({ audio: 'AA==', boundaries }) };
  });
  const recording = await prepareSentenceRecording('Moving abroad helped him.', {
    lang: 'en-US', rate: 1, segments: ['Moving abroad', 'helped him.'], punctuation: false,
    context: { decodeAudioData: async () => buffer },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('text'), 'Moving abroad helped him.');
  assert.equal(requests[0].searchParams.get('timings'), '1');
  const before = recordingClips(recording);
  recording.cuts[1] = 0.8;
  const after = recordingClips(recording);
  assert.ok(after[0].size < before[0].size);
  assert.ok(after[1].size > before[1].size);
  assert.equal(requests.length, 1);
});
test('uncertain alignment only produces estimated clips when review is enabled', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ audio: 'AA==', boundaries: [] }) }));
  const options = { lang: 'en-US', rate: 1, segments: ['Moving abroad', 'helped him.'], punctuation: false,
    context: { decodeAudioData: async () => buffer } };
  await assert.rejects(prepareSentenceRecording('Moving abroad helped him.', options));
  const result = await prepareSentenceRecording('Moving abroad helped him.', { ...options, allowEstimated: true });
  assert.ok(result.warning);
  assert.equal(recordingClips(result).length, 2);
});
test('synthetic voices dictate no punctuation; a cue is only ever an explicit, separate last-clip recording', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(new URL(url, 'http://localhost').searchParams.get('text'));
    return { ok: true, json: async () => ({ audio: 'AA==', boundaries }), arrayBuffer: async () => new ArrayBuffer(1) };
  });
  const options = { lang: 'en-US', rate: 1, segments: ['Moving abroad', 'helped him.'], context: { decodeAudioData: async () => buffer } };
  // By default (every TTS path now): no "Period." request, no cue.
  const bare = await prepareSentenceRecording('Moving abroad helped him.', options);
  assert.deepEqual(requests, ['Moving abroad helped him.']);
  assert.equal(bare.cue, null);
  requests.length = 0;
  const result = await prepareSentenceRecording('Moving abroad helped him.', { ...options, punctuation: true });
  assert.deepEqual(requests, ['Moving abroad helped him.', 'Period.']);
  const clips = recordingClips(result);
  const plain = recordingClips({ ...result, cue: null });
  assert.equal(clips[0].size, plain[0].size);
  assert.ok(clips[1].size > plain[1].size);
});

const assignmentBundle = await build({ entryPoints: ['src/lib/buildAssignment.js'], bundle: true, write: false,
  platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
const { uploadPreparedClips, rerecordSegments, recordSentences } = await import(`data:text/javascript;base64,${Buffer.from(assignmentBundle.outputFiles[0].text).toString('base64')}`);

test('reviewed studio splits obey delivery for typing and notebook uploads', async (t) => {
  const uploads = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options?.method, 'PUT', 'reviewed audio must never be synthesized again');
    uploads.push({ url, ...options });
    return { ok: true, json: async () => ({}) };
  });
  for (const mode of ['typing', 'notebook']) {
    const cue = mode === 'notebook' ? buffer : null;
    const recordings = [
      { sentence: 'Moving abroad helped him.', segments: ['Moving', 'abroad helped him.'],
        buffer, cuts: [0.1, 0.5, 1.4], cue },
      { sentence: 'It was hard.', segments: ['It was', 'hard.'],
        buffer, cuts: [0.2, 0.8, 1.3], cue },
    ];
    for (const delivery of ['sentences', 'phrases']) {
      uploads.length = 0;
      const prepared = prepareReviewedAudio(recordings, delivery);
      const expected = delivery === 'sentences'
        ? recordings.map((r) => ({ ...r, segments: [r.sentence], cuts: [r.cuts[0], r.cuts.at(-1)] }))
        : recordings;
      assert.deepEqual(prepared.segments, delivery === 'sentences'
        ? ['Moving abroad helped him.', 'It was hard.']
        : ['Moving', 'abroad helped him.', 'It was', 'hard.']);
      const expectedClips = expected.flatMap(recordingClips);
      assert.equal(prepared.clips.length, expectedClips.length);
      for (let i = 0; i < expectedClips.length; i++) {
        assert.deepEqual(await prepared.clips[i].arrayBuffer(), await expectedClips[i].arrayBuffer(),
          'whole sentences retain their exact trimmed audio and one final cue, without gaps at phrase cuts');
      }
      assert.deepEqual(await recordSentences('test', prepared.segments, {
        mode, delivery, text: 'Moving abroad helped him. It was hard.', prepared,
      }), []);
      assert.equal(uploads.length, expectedClips.length);
      uploads.forEach((upload, i) => {
        assert.ok(upload.url.endsWith(`/audio/${i}`));
        assert.equal(upload.body, prepared.clips[i]);
      });
    }
    assert.deepEqual(recordings.map((r) => r.cuts), [[0.1, 0.5, 1.4], [0.2, 0.8, 1.3]],
      'exporting full sentences leaves the studio edits intact');
    assert.deepEqual(recordings.map((r) => r.segments), [['Moving', 'abroad helped him.'], ['It was', 'hard.']]);
  }
});

test('upload retries preserve reviewed bytes and never call the voice service', async (t) => {
  const clips = [new Blob(['first'], { type: 'audio/wav' }), new Blob(['second'], { type: 'audio/wav' })];
  const segments = ['Moving abroad', 'helped him.'];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    return { ok: calls.length !== 2, status: 503, json: async () => ({}) };
  });
  assert.deepEqual(await uploadPreparedClips('test', segments, { segments, clips }), [1]);
  assert.deepEqual(await uploadPreparedClips('test', segments, { segments, clips }, { only: [1] }), []);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.method === 'PUT'));
  assert.equal(calls[2].body, clips[1]);
  await assert.rejects(uploadPreparedClips('test', ['different text'], { segments, clips }));
  assert.equal(calls.length, 3);
});

test('re-recording one stored phrase synthesizes its entire original sentence', async (t) => {
  const calls = [];
  const OriginalContext = globalThis.AudioContext;
  globalThis.AudioContext = class { async decodeAudioData() { return buffer; } async close() {} };
  t.after(() => { globalThis.AudioContext = OriginalContext; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url, 'http://localhost'), options });
    return { ok: true, json: async () => options?.method === 'PUT' ? {} : { audio: 'AA==', boundaries } };
  });
  const failed = await rerecordSegments('test', ['Moving abroad', 'helped him.', 'Another sentence.'], {
    lang: 'en-US', rate: 1, mode: 'typing', only: [1],
  });
  assert.deepEqual(failed, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('text'), 'Moving abroad helped him.');
  assert.ok(calls[1].url.pathname.endsWith('/audio/1'));
});


test('moving words changes the text and audio boundary without changing the sentence', () => {
  const recording = { segments: ['Moving abroad', 'helped him.'], boundaries, buffer,
    cuts: [0, 0.90625, 1.5], warning: '' };
  const moved = moveSplitWord(recording, 1, -1);
  assert.deepEqual(moved.segments, ['Moving', 'abroad helped him.']);
  assert.equal(moved.cuts[1], (0.46 + 0.475) / 2);
  assert.equal(moved.buffer, recording.buffer);
  const twice = moveSplitWord(moveSplitWord(moved, 1, 1), 1, 1);
  assert.deepEqual(twice.segments, ['Moving abroad helped', 'him.']);
  assert.equal(twice.segments.join(' '), recording.segments.join(' '));
  assert.throws(() => moveSplitWord(twice, 1, 1));
  assert.throws(() => moveSplitWord(moved, 1, -1));
  assert.deepEqual(recording.segments, ['Moving abroad', 'helped him.']);
});

test('word moves with uncertain metadata require review', () => {
  const moved = moveSplitWord({ segments: ['Moving abroad', 'helped him.'], boundaries: [], buffer,
    cuts: [0, 0.9, 1.5], warning: '' }, 1, -1);
  assert.equal(moved.checked, false);
  assert.ok(moved.warning);
  validateCuts(moved.cuts, 2, buffer.duration);
});

test('custom reviewed segmentation uploads without reverting to automatic phrases', async (t) => {
  const segments = ['Moving', 'abroad helped him.'];
  const prepared = { segments, clips: [new Blob(['one']), new Blob(['two'])] };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({}) };
  });
  assert.deepEqual(await recordSentences('test', segments, {
    text: 'Moving abroad helped him.', lang: 'en-US', rate: 1, delivery: 'phrases', prepared,
  }), []);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.method === 'PUT'));
  await assert.rejects(recordSentences('test', segments, {
    text: 'A different passage.', lang: 'en-US', rate: 1, prepared,
  }));
  assert.equal(calls.length, 2);
});


test('human takes keep their audio and phrase plan without calling TTS', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected TTS call'); });
  const part = { sentence: 'Moving abroad helped him.', segments: ['Moving abroad', 'helped him.'] };
  const result = await prepareHumanSentenceRecording(part, buffer, { punctuation: false });
  assert.equal(result.buffer, buffer);
  assert.deepEqual(result.segments, part.segments);
  assert.equal(result.source, 'human');
  assert.equal(result.warning, '', 'no listening check to tick');
  assert.equal(result.cue, null);
  assert.equal(recordingClips(result).length, 2);
});

// ---------------------------------------------------------------- merging and splitting
const { mergeSplit, mergeAll, splitSegment, pauseCuts, speechBounds, quietestNear, trimEnds, trimSilence } = await import('./audioSplits.js');
const { validatedNotebookSegments, segmentGroups } = await import('./notebookShared.js');

// Speech-like blocks with quiet gaps: [seconds, loud?]
function speech(pattern, sampleRate = 1000) {
  const samples = [];
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (const [seconds, loud] of pattern) {
    for (let i = 0; i < Math.round(seconds * sampleRate); i++) samples.push(noise() * (loud ? 0.8 : 0.001));
  }
  const data = Float32Array.from(samples);
  return { sampleRate, length: data.length, duration: data.length / sampleRate, getChannelData: () => data };
}
// "Moving abroad" | pause 1.30-1.55 | "helped him."
const spoken = speech([[0.3, false], [1.0, true], [0.25, false], [0.8, true], [0.4, false]]);

test('speech bounds skip leading and trailing silence', () => {
  const [start, end] = speechBounds(spoken.getChannelData(0), spoken.sampleRate);
  assert.ok(Math.abs(start - 0.3) < 0.03, `start ${start}`);
  assert.ok(Math.abs(end - 2.35) < 0.03, `end ${end}`);
});

test('cuts without word timings land in the pause between phrases', () => {
  const cuts = pauseCuts(['Moving abroad', 'helped him.'], spoken.getChannelData(0), spoken.sampleRate);
  assert.equal(cuts.length, 3);
  assert.ok(cuts[1] > 1.3 && cuts[1] < 1.55, `cut ${cuts[1]}`);
  // Centred on the pause, not at its edge.
  assert.ok(Math.abs(cuts[1] - 1.425) < 0.06, `cut ${cuts[1]}`);
  assert.deepEqual(pauseCuts(['One phrase.'], spoken.getChannelData(0), spoken.sampleRate), [0, spoken.duration]);
  // Never outside the allowed range, even with nothing quiet nearby.
  const flat = Float32Array.from({ length: 1000 }, () => 0.5);
  const t = quietestNear(flat, 1000, 0.5, 0.45, 0.55);
  assert.ok(t >= 0.45 && t <= 0.55);
});

test('merging phrases keeps the words, the audio and the other cuts', () => {
  const recording = { segments: ['Moving', 'abroad helped', 'him.'], boundaries, buffer,
    cuts: [0, 0.4675, 1.1675, 1.5], warning: '', checked: true };
  const merged = mergeSplit(recording, 1);
  assert.deepEqual(merged.segments, ['Moving abroad helped', 'him.']);
  assert.deepEqual(merged.cuts, [0, 1.1675, 1.5]);
  assert.equal(merged.buffer, buffer);
  assert.equal(merged.checked, true);
  assert.deepEqual(mergeSplit(merged, 1).segments, ['Moving abroad helped him.']);
  assert.deepEqual(mergeSplit(merged, 1).cuts, [0, 1.5]);
  const one = mergeAll(recording);
  assert.deepEqual(one.segments, ['Moving abroad helped him.']);
  assert.deepEqual(one.cuts, [0, 1.5]);
  for (const bad of [0, 3, 1.5]) assert.throws(() => mergeSplit(recording, bad));
  assert.deepEqual(recording.segments, ['Moving', 'abroad helped', 'him.']);
});

test('splitting a phrase uses word timings when the voice gave them', () => {
  const recording = { segments: ['Moving abroad helped him.'], boundaries, buffer, cuts: [0, 1.5], warning: '', checked: true };
  const split = splitSegment(recording, 0, 2);
  assert.deepEqual(split.segments, ['Moving abroad', 'helped him.']);
  assert.deepEqual(split.cuts, [0, 0.90625, 1.5]);
  assert.equal(split.warning, '');
  assert.equal(split.checked, true);
  const again = splitSegment(split, 1, 1);
  assert.deepEqual(again.segments, ['Moving abroad', 'helped', 'him.']);
  assert.equal(again.cuts[2], (1.16 + 1.175) / 2);
  for (const words of [0, 4, 1.5]) assert.throws(() => splitSegment(recording, 0, words));
  assert.throws(() => splitSegment(recording, 1, 1));
});

test('splitting audio without word timings goes to the pause and asks for a listen', () => {
  const recording = { segments: ['Moving abroad helped him.'], boundaries: [], buffer: spoken,
    cuts: [0, spoken.duration], warning: '', checked: true };
  const split = splitSegment(recording, 0, 2);
  assert.deepEqual(split.segments, ['Moving abroad', 'helped him.']);
  assert.ok(split.cuts[1] > 1.3 && split.cuts[1] < 1.55, `cut ${split.cuts[1]}`);
  assert.ok(split.warning);
  assert.equal(split.checked, false);
  const moved = moveSplitWord({ ...split, checked: true }, 1, -1);
  assert.deepEqual(moved.segments, ['Moving', 'abroad helped him.']);
  assert.equal(moved.checked, false);
  validateCuts(moved.cuts, 2, spoken.duration);
});

test('human takes never ask for a listening check, however they are split', () => {
  const human = { segments: ['Moving abroad helped him.'], boundaries: [], buffer: spoken,
    cuts: [0, spoken.duration], source: 'human', warning: '', checked: true };
  const split = splitSegment(human, 0, 2);
  assert.ok(split.cuts[1] > 1.3 && split.cuts[1] < 1.55, `cut ${split.cuts[1]}`);
  assert.equal(split.warning, '');
  assert.equal(split.checked, true);
  const moved = moveSplitWord(split, 1, -1);
  assert.equal(moved.warning, '');
  assert.equal(moved.checked, true);
});

test('merged and split phrase plans are still valid assignment answers', () => {
  const text = 'Moving abroad helped him. It was hard at first.';
  for (const segments of [
    ['Moving abroad helped him.', 'It was hard at first.'],
    ['Moving abroad', 'helped him.', 'It was', 'hard', 'at first.'],
  ]) {
    assert.deepEqual(validatedNotebookSegments(text, segments), segments);
    const groups = segmentGroups(segments);
    assert.deepEqual(groups.map((g) => g.sentence), ['Moving abroad helped him.', 'It was hard at first.']);
    assert.equal(groups.reduce((n, g) => n + g.count, 0), segments.length);
  }
});

test('the sentence start and end can move in, discarding the audio outside', () => {
  // 0.3 s silence, speech, 0.25 s pause, speech, 0.4 s silence (see `spoken`).
  const recording = { segments: ['Moving abroad', 'helped him.'], boundaries: [], buffer: spoken,
    cuts: [0, 1.4, spoken.duration], source: 'human', warning: '', checked: true };
  const trimmed = trimSilence(recording);
  assert.ok(trimmed.cuts[0] > 0.15 && trimmed.cuts[0] < 0.3, `start ${trimmed.cuts[0]}`);
  assert.ok(trimmed.cuts.at(-1) > spoken.duration - 0.4 && trimmed.cuts.at(-1) < spoken.duration - 0.2, `end ${trimmed.cuts.at(-1)}`);
  assert.equal(trimmed.cuts[1], 1.4, 'inner splits untouched');
  // The clips are cut from the kept part only.
  const clips = recordingClips(trimmed);
  assert.equal(clips.length, 2);
  // Ends never cross the phrase next to them, nor leave the recording.
  const squeezed = trimEnds(recording, { start: 5, end: -1 });
  assert.ok(squeezed.cuts[0] < 1.4 && squeezed.cuts[0] > 1.3);
  assert.ok(squeezed.cuts.at(-1) > 1.4 && squeezed.cuts.at(-1) < 1.5);
  assert.deepEqual(trimEnds(recording, { start: -2, end: 99 }).cuts, [0, 1.4, spoken.duration]);
  // Merging keeps the trimmed ends; the untrimmed original is still reachable through Reset.
  assert.deepEqual(mergeAll(trimmed).cuts, [trimmed.cuts[0], trimmed.cuts.at(-1)]);
  assert.deepEqual(recording.cuts, [0, 1.4, spoken.duration]);
});

test('recognised word timings place the cut, then the nearest pause settles it', async () => {
  // `spoken`: 0.3 s silence, 1.0 s speech, a 0.25 s pause (1.3–1.55), 0.8 s speech, 0.4 s silence.
  const part = { sentence: 'Moving abroad helped him.', segments: ['Moving abroad', 'helped him.'] };
  // Timings 0.2 s late, as a recogniser's tend to be: the gap they suggest is at 1.6 s.
  const late = [['Moving', 0.5, 0.9], ['abroad', 0.95, 1.5], ['helped', 1.7, 2.0], ['him.', 2.0, 2.3]]
    .map(([text, start, end]) => ({ text, start, end }));
  const recording = await prepareHumanSentenceRecording(part, spoken, { punctuation: false, boundaries: late });
  assert.equal(recording.timingsFrom, 'recognition');
  assert.equal(recording.boundaries, late);
  assert.ok(recording.cuts[1] > 1.3 && recording.cuts[1] < 1.56, `settled into the pause: ${recording.cuts[1]}`);
  // Timings that don't fit the words: pauses alone, as before.
  const wrong = await prepareHumanSentenceRecording(part, spoken, { punctuation: false, boundaries: late.slice(0, 2) });
  assert.deepEqual(wrong.boundaries, []);
  assert.equal(wrong.timingsFrom, undefined);
  // Splitting with recognised timings is exact too, and settles the same way.
  const whole = await prepareHumanSentenceRecording({ sentence: part.sentence, segments: [part.sentence] }, spoken, { punctuation: false, boundaries: late });
  const split = splitSegment(whole, 0, 2);
  assert.ok(split.cuts[1] > 1.3 && split.cuts[1] < 1.56, `split cut ${split.cuts[1]}`);
  assert.equal(split.warning, '');
});

test('a recognised cut only moves to a real pause, never to a soft spot inside a word', async () => {
  // Continuous speech from 0.3 s to 2.3 s: no pause anywhere near 1.0 s.
  const continuous = speech([[0.3, false], [2.0, true], [0.4, false]]);
  const part = { sentence: 'Moving abroad helped him.', segments: ['Moving abroad', 'helped him.'] };
  const words = [['Moving', 0.3, 0.6], ['abroad', 0.6, 0.98], ['helped', 1.02, 1.6], ['him.', 1.6, 2.3]]
    .map(([text, start, end]) => ({ text, start, end }));
  const recording = await prepareHumanSentenceRecording(part, continuous, { punctuation: false, boundaries: words });
  assert.equal(recording.cuts[1], 1.0, 'the recogniser’s boundary stands');
  const { refineCuts, speechThreshold } = await import('./audioSplits.js');
  assert.deepEqual(refineCuts([0, 1.0, continuous.duration], continuous.getChannelData(0), continuous.sampleRate), [0, 1.0, continuous.duration]);
  // With a real pause nearby (spoken: 1.3–1.55 s), a slightly-off cut settles into it.
  const spokenSamples = spoken.getChannelData(0);
  assert.ok(speechThreshold(spokenSamples, spoken.sampleRate) > 0);
  const settled = refineCuts([0, 1.25, spoken.duration], spokenSamples, spoken.sampleRate)[1];
  assert.ok(settled > 1.3 && settled < 1.56, `settled ${settled}`);
});
