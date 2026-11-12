import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// reuseAudio pulls in notebookAudio (and its voice-server client), so it is
// bundled the way audioSplits.test.mjs bundles notebookAudio.
const bundled = await build({ entryPoints: ['src/lib/reuseAudio.js'], bundle: true, write: false,
  platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
const { joinClips, regroupRecordings } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const RATE = 1000;
// A clip as the studio stores them: a lead-in of silence, then sound.
function clip(leadSeconds, soundSeconds) {
  const samples = new Float32Array(Math.round((leadSeconds + soundSeconds) * RATE));
  for (let i = Math.round(leadSeconds * RATE); i < samples.length; i++) samples[i] = 0.3 * Math.sin(i * 0.5);
  return { sampleRate: RATE, length: samples.length, duration: samples.length / RATE, getChannelData: () => samples };
}
const context = { createBuffer: (_, length, sampleRate) => {
  const samples = new Float32Array(length);
  return { sampleRate, length, duration: length / sampleRate, getChannelData: () => samples };
} };

test('joining phrase clips drops the lead-in silence between them', () => {
  const joined = joinClips(context, [clip(0.4, 1.0), clip(0.4, 0.8)]);
  // 1.4 s + (0.8 s + the 0.1 s kept before the sound): the second lead-in is mostly gone.
  assert.ok(Math.abs(joined.duration - 2.3) < 0.05, `duration ${joined.duration}`);
  assert.equal(joinClips(context, [clip(0.4, 1.0)]).duration, 1.4);
});

test('phrases regroup into their sentences, and sentences re-cut into phrases', () => {
  const phrases = ['Moving abroad', 'helped him understand', 'his own culture.', 'We celebrated the festival.'];
  const buffers = phrases.map(() => clip(0.4, 0.6));
  const sentences = regroupRecordings(context, phrases, buffers, { lang: 'en-US', delivery: 'sentences' });
  assert.deepEqual(sentences.map((r) => r.segments), [['Moving abroad helped him understand his own culture.'], ['We celebrated the festival.']]);
  assert.equal(sentences[0].source, 'reused');
  assert.ok(Math.abs(sentences[0].buffer.duration - (1.0 + 0.7 + 0.7)) < 0.05);
  assert.deepEqual(sentences[0].cuts, [0, sentences[0].buffer.duration]);

  const back = regroupRecordings(context, sentences.map((r) => r.segments[0]), sentences.map((r) => r.buffer), { lang: 'en-US', delivery: 'phrases' });
  assert.equal(back.length, 2);
  assert.equal(back[0].sentence, 'Moving abroad helped him understand his own culture.');
  assert.ok(back[0].segments.length > 1, 'cut into phrases again');
  assert.equal(back[0].segments.join(' '), back[0].sentence);
  assert.equal(back[0].cuts.length, back[0].segments.length + 1);

  assert.throws(() => regroupRecordings(context, phrases, buffers.slice(1), { lang: 'en-US', delivery: 'sentences' }));
});

test('changing delivery retains the recording punctuation metadata', () => {
  for (const delivery of ['sentences', 'phrases']) {
    const recordings = regroupRecordings(context, ['Moving abroad helped him understand his own culture.'], [clip(0.4, 4)], {
      lang: 'en-US', delivery, dictatedPunctuation: 'ends,inner,commas',
    });
    assert.ok(recordings.every((recording) => recording.dictated === 'ends,inner,commas'));
    assert.equal(recordings[0].buffer.duration, 4.4);
  }
});
