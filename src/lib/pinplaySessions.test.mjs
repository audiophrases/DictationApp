import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionFields, validateSession, sessionPassage, actorLink, takeUrl, autoTrim, trimTake, sessionRequest, loadTake } from './pinplaySessions.js';

const plan = [{ sentence: 'Moving abroad helped him.', segments: ['Moving abroad', 'helped him.'] }];
const id = 'abcd234567';
const key = `voice-actors/${id}/l1-123.webm`;
const session = { id, lines: [{ id: 'l1', text: plan[0].sentence, speaker: 'Narrator', status: 'ok', take: { key } }] };

test('sessions send complete sentences with the punctuation to say, and disable actor text editing', () => {
  const fields = sessionFields(plan, ['Alex'], 'My dictation');
  assert.equal(fields.allowEdits, false);
  assert.equal(fields.lines.length, 1);
  assert.equal(fields.lines[0].text, 'Moving abroad helped him. [period]');
  assert.equal(fields.lines[0].direction, '');
  assert.equal(fields.lines[0].speaker, 'Alex');
  assert.throws(() => sessionFields([{ sentence: 'x'.repeat(601) }], [], 'Long'));
  // The notes count towards PinPlay's 600 characters (it would cut the line short).
  assert.throws(() => sessionFields([{ sentence: `${'x'.repeat(592)}.` }], [], 'Long'), /punctuation notes/);
  assert.throws(() => sessionFields(Array(301).fill(plan[0]), [], 'Long'));
  assert.equal(new URL(actorLink(id, 'Alex & Jo')).searchParams.get('c'), 'Alex & Jo');
});

test('paragraphs come from the passage’s line breaks; notes never break matching', () => {
  const passage = 'He asked: "Why?" Nobody answered.\nThe end came; it was quiet.\n\n¿Vienes? Sí.';
  const two = [{ sentence: 'He asked: "Why?"' }, { sentence: 'Nobody answered.' }, { sentence: 'The end came; it was quiet.' }];
  const lines = sessionFields(two, [], 't', { passage: passage.split('\n\n')[0] }).lines.map((l) => l.text);
  assert.deepEqual(lines, [
    'He asked: [colon] [open quote] "Why?" [question mark] [close quote]',
    'Nobody answered. [period] [new paragraph]',
    'The end came; [semicolon] it was quiet. [period]',
  ]);
  // Catalan says period and new paragraph in one go.
  assert.equal(sessionFields(two, [], 't', { lang: 'ca-ES', passage: passage.split('\n\n')[0] }).lines[1].text,
    'Nobody answered. [punt i a part]');
  // Phrases stored in an assignment (no passage): no paragraphs, nothing invented.
  assert.equal(sessionFields(two, [], 't', { passage: 'Something else.' }).lines[1].text, 'Nobody answered. [period]');

  const annotated = { id, lines: lines.map((text, i) => ({ id: `l${i + 1}`, text, speaker: 'Narrator', status: 'ok', take: { key } })) };
  validateSession(annotated, two, true);
  // A passage rebuilt from the session keeps its paragraphs.
  assert.equal(sessionPassage(annotated), 'He asked: "Why?" Nobody answered.\nThe end came; it was quiet.');
  // Sessions made before the notes: still one sentence per line.
  const old = { lines: two.map((part) => ({ text: part.sentence })) };
  assert.equal(sessionPassage(old), two.map((part) => part.sentence).join('\n'));
});

test('only matching approved takes can enter the splitting studio', () => {
  validateSession(session, plan, true);
  for (const status of ['todo', 'recorded', 'redo']) {
    assert.throws(() => validateSession({ ...session, lines: [{ ...session.lines[0], status }] }, plan, true));
  }
  assert.throws(() => validateSession({ ...session, lines: [{ ...session.lines[0], text: 'Different words.' }] }, plan));
  assert.throws(() => validateSession({ ...session, lines: [] }, plan));
  assert.throws(() => validateSession({ ...session, lines: [{ ...session.lines[0], take: null }] }, plan, true));
  assert.equal(sessionPassage(session), plan[0].sentence);
  assert.throws(() => sessionPassage({ lines: [{ text: 'Two sentences. Another one.' }] }));
});

test('takes can only be fetched from this PinPlay session media folder', () => {
  assert.equal(takeUrl(id, key), `https://api.pinplay.win/api/media/${key}`);
  for (const value of ['https://example.com/take', `voice-actors/${id}/../other.wav`, 'voice-actors/other/l1.wav', `voice-actors/${id}/%2e%2e/a`]) {
    assert.throws(() => takeUrl(id, value));
  }
});

function audio(channels, sampleRate = 1000) {
  return { sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate,
    numberOfChannels: channels.length, getChannelData: (i) => channels[i] };
}
const context = { createBuffer: (_, length, sampleRate) => audio([new Float32Array(length)], sampleRate) };

test('PinPlay automatic trim keeps breathing room and source audio untouched', () => {
  const samples = new Float32Array(2000);
  samples.fill(0.2, 600, 1200);
  const source = audio([samples]);
  assert.deepEqual(autoTrim(source), { s: 480, e: 1400 });
  const piece = trimTake(source, null, context);
  assert.equal(piece.length, 920);
  assert.equal(source.length, 2000);
  assert.equal(samples[600], Math.fround(0.2));
});

test('trim validation rejects silence and bad ranges; stereo is mixed to mono', () => {
  const source = audio([new Float32Array(1000).fill(0.2), new Float32Array(1000).fill(0.4)]);
  const piece = trimTake(source, { s: 100, e: 500 }, context);
  assert.equal(piece.numberOfChannels, 1);
  assert.equal(piece.length, 400);
  assert.ok(Math.abs(piece.getChannelData(0)[0] - 0.3) < 0.0001);
  for (const trim of [{ s: -1, e: 500 }, { s: 500, e: 100 }, { s: 0, e: 1001.1 }, { s: NaN, e: 500 }, { s: 0, e: 10 }]) {
    assert.throws(() => trimTake(source, trim, context));
  }
  assert.throws(() => trimTake(audio([new Float32Array(1000)]), null, context));
});

test('PinPlay requests use the explicit password and surface authentication errors', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: false, json: async () => ({ error: 'Wrong password.' }) };
  });
  await assert.rejects(sessionRequest('get', '', { id }), /password/);
  assert.equal(calls.length, 0);
  await assert.rejects(sessionRequest('get', 'pinplay-password', { id }), /Wrong password/);
  assert.equal(calls[0].url, 'https://api.pinplay.win/api/rec/get');
  assert.deepEqual(JSON.parse(calls[0].options.body), { id, password: 'pinplay-password' });
});

test('failed or oversized downloads are never decoded', async (t) => {
  let decodes = 0;
  const decoder = { decodeAudioData() { decodes++; } };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  await assert.rejects(loadTake(id, session.lines[0], decoder));
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4 * 1024 * 1024 + 1) });
  await assert.rejects(loadTake(id, session.lines[0], decoder));
  assert.equal(decodes, 0);
});
