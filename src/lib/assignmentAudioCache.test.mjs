import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { AssignmentAudioCache } from './assignmentAudioCache.js';

const response = (index, size = 40) => new Response(new Uint8Array(size).fill(index), {
  headers: { 'X-Audio-Version': `v${index}`, 'X-Audio-Type': 'audio/wav' },
});
const urlFor = (index) => String(index);

test('preloads every segment once, upcoming first, with at most two downloads', async () => {
  let active = 0;
  let peak = 0;
  const requests = [];
  const cache = new AssignmentAudioCache({ urlFor, fetchImpl: async (url, options) => {
    requests.push(Number(url));
    assert.equal(options.cache, 'no-store');
    peak = Math.max(peak, ++active);
    await setImmediate();
    active -= 1;
    return response(Number(url));
  } });
  await Promise.all([cache.prefetch(6, 0), cache.prefetch(6, 0)]);
  assert.deepEqual(requests, [1, 2, 3, 4, 5, 0]);
  assert.equal(peak, 2);
  assert.equal(cache.clips.size, 6);
  assert.equal(cache.get(1).version, 'v1');
  assert.equal(cache.get(1).type, 'audio/wav');
  await cache.prefetch(6, 3);
  assert.equal(requests.length, 6);
  cache.dispose();
});

test('jumping ahead reprioritizes queued segments without duplicate requests', async () => {
  const requests = [];
  const release = new Map();
  const cache = new AssignmentAudioCache({ urlFor, fetchImpl: async (url) => {
    const index = Number(url);
    requests.push(index);
    if (requests.length <= 2) await new Promise((resolve) => release.set(index, resolve));
    return response(index);
  } });
  const first = cache.prefetch(6, 0);
  const jumped = cache.prefetch(6, 4);
  release.get(1)();
  await setImmediate();
  release.get(2)();
  await Promise.all([first, jumped]);
  assert.deepEqual(requests, [1, 2, 5, 0, 3, 4]);
  cache.dispose();
});

test('memory is bounded and evicted clips are not downloaded in a loop', async () => {
  const requests = [];
  const cache = new AssignmentAudioCache({ urlFor, maxBytes: 85, concurrency: 1, fetchImpl: async (url) => {
    requests.push(Number(url));
    return response(Number(url));
  } });
  await cache.prefetch(5, 0);
  assert.equal(cache.bytes, 80);
  assert.deepEqual([...cache.clips.keys()], [1, 0]);
  assert.equal(cache.get(4), undefined);
  await cache.prefetch(5, 2);
  assert.equal(requests.length, 5);
  cache.delete(1);
  assert.equal(cache.bytes, 40);
  cache.dispose();
  assert.equal(cache.bytes, 0);
  assert.equal(cache.clips.size, 0);
});

test('failed, empty, malformed and oversized downloads leave other segments usable', async () => {
  const cache = new AssignmentAudioCache({ urlFor, maxBytes: 85, fetchImpl: async (url) => {
    const index = Number(url);
    if (index === 1) throw new Error('Offline');
    if (index === 2) return new Response('No session', { status: 401 });
    if (index === 3) return new Response('Old server without cache headers');
    if (index === 4) return response(index, 10);
    if (index === 5) return response(index, 90);
    return response(index);
  } });
  await cache.prefetch(7, 0);
  assert.deepEqual([...cache.clips.keys()], [6, 0]);
  cache.dispose();
});

test('disposing aborts in-flight work and ignores downloads that finish late', async () => {
  const requests = [];
  let release;
  const late = new Promise((resolve) => { release = resolve; });
  const cache = new AssignmentAudioCache({ urlFor, fetchImpl: async (url, { signal }) => {
    requests.push({ url, signal });
    await late;
    return response(Number(url));
  } });
  const done = cache.prefetch(10, 0);
  cache.dispose();
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ signal }) => signal.aborted));
  release();
  await done;
  await setImmediate();
  assert.equal(cache.clips.size, 0);
  assert.equal(cache.bytes, 0);
  assert.equal(requests.length, 2);
});

test('a stalled preload times out and releases a download slot', async () => {
  const cache = new AssignmentAudioCache({ urlFor, timeoutMs: 5, fetchImpl: async (url, { signal }) => {
    if (url === '1') await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted'))));
    return response(Number(url));
  } });
  await cache.prefetch(3, 0);
  assert.equal(cache.get(1), undefined);
  assert.ok(cache.get(2));
  assert.ok(cache.get(0));
  cache.dispose();
});
