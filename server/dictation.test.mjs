// Passage fetching's network behaviour: `node server/dictation.test.mjs`.
//
// These guard the fix for the bug where "Fetch a passage" stopped working for
// every Wikipedia-only language. Wikimedia caps a client whose User-Agent
// carries no contact at ~10 API requests per window, shared across all of its
// hosts, and fetchDictation can spend 5 attempts per source -- so one click
// could exhaust the allowance and the next click failed outright.
//
// Both halves of that are invisible to a normal test run: the User-Agent is a
// string nobody exercises, and the retry loop only misbehaves against a live
// 429. So they are pinned here, with fetch stubbed.
import { fetchDictation, SOURCES } from './dictation.js';

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    if (detail) console.log(`     ${detail}`);
    failures += 1;
  }
}

// An extract that comfortably clears buildPassage's filters, so any failure
// below is about network handling and never about passage quality.
const ARTICLE = {
  query: {
    pages: {
      1: {
        title: 'Water',
        fullurl: 'https://example.org/Water',
        revisions: [{ timestamp: '2026-01-01T00:00:00Z' }],
        extract:
          'Water is a clear liquid. People drink it every day. '
          + 'It covers most of the planet. Rivers carry it to the sea.',
      },
    },
  },
};

const ok200 = () => ({ ok: true, status: 200, json: async () => ARTICLE });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

const realFetch = globalThis.fetch;
// The warnings fetchDictation emits are deliberate -- a silent catch is what
// hid this bug in production -- but they would drown out the test output, so
// they are collected and asserted on rather than printed.
const realWarn = console.warn;
let warnings = [];
console.warn = (msg) => warnings.push(String(msg));
/** Replace global fetch with `responder(host)`; returns the recorded calls. */
function stub(responder) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const host = new URL(String(url)).host;
    calls.push({ host, headers: opts.headers || {} });
    return responder(host, calls.length);
  };
  return calls;
}

// ------------------------------------------------- the User-Agent identifies us
{
  const calls = stub(() => ok200());
  await fetchDictation(SOURCES['pt-PT'], 'short');
  const ua = calls[0]?.headers['User-Agent'] || '';
  // A contact is what Wikimedia's policy asks for, and what lifts the cap from
  // ~10 requests per window. Deleting it is a silent, total regression.
  check(
    'the User-Agent carries a contact (URL or email)',
    /https?:\/\/\S+|\S+@\S+\.\S+/.test(ua),
    `User-Agent was ${JSON.stringify(ua)}`
  );
  check('the same User-Agent is sent as Api-User-Agent', calls[0]?.headers['Api-User-Agent'] === ua);
}

// ------------------------------------------------------ a 429 stops the retries
{
  // ar-MA has exactly one source, so the count is unambiguous.
  warnings = [];
  const calls = stub(() => fail(429));
  let threw = null;
  try {
    await fetchDictation(SOURCES['ar-MA'], 'short', { attemptsPerSource: 5 });
  } catch (err) {
    threw = err;
  }
  check(
    'a 429 gives up on the source instead of retrying',
    calls.length === 1,
    `expected 1 request, made ${calls.length}`
  );
  check('an all-429 run reports UPSTREAM_UNAVAILABLE', threw?.code === 'UPSTREAM_UNAVAILABLE');
  check(
    'the message says we are being rate-limited, not that the source is unreachable',
    /limiting how often/i.test(threw?.message || ''),
    `message was ${JSON.stringify(threw?.message)}`
  );
  check(
    'the 429 is logged, so a rate limit is diagnosable from the server logs',
    warnings.some((w) => /rate-limited \(429\)/.test(w) && w.includes('ary.wikipedia.org')),
    `warnings were ${JSON.stringify(warnings)}`
  );
}

// -------------------------------------------- other failures are still retried
{
  // A 500 or a timeout really is a transient blip, and a different random
  // article may well work, so those must keep their retries.
  const calls = stub(() => fail(500));
  try {
    await fetchDictation(SOURCES['ar-MA'], 'short', { attemptsPerSource: 5 });
  } catch { /* expected */ }
  check(
    'a 500 still retries up to attemptsPerSource',
    calls.length === 5,
    `expected 5 requests, made ${calls.length}`
  );
}

// ------------------------------- a rate-limited source does not block the next
{
  // en-US is simple.wikipedia first, en.wikipedia second. Vikidia-backed
  // languages depend on this too: being blocked by one site must not cost the
  // fallback its turn.
  const calls = stub((host) => (host === 'simple.wikipedia.org' ? fail(429) : ok200()));
  const result = await fetchDictation(SOURCES['en-US'], 'short', { attemptsPerSource: 5 });
  check('a 429 on the first source still lets the second one answer', result?.title === 'Water');
  check(
    'and it reaches the second source in one request, not six',
    calls.length === 2,
    `made ${calls.length} requests: ${calls.map((c) => c.host).join(', ')}`
  );
}

// ------------------------------------------------------ the happy path is intact
{
  stub(() => ok200());
  const result = await fetchDictation(SOURCES['pt-PT'], 'short');
  check('a good article still becomes a passage', !!result?.text);
  check('the citation keeps the source label', result?.source === 'Wikipedia');
  check('the citation keeps the revision date', result?.date === '2026-01-01T00:00:00Z');
}

globalThis.fetch = realFetch;
console.warn = realWarn;

console.log(failures === 0 ? '\nAll fetch checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
