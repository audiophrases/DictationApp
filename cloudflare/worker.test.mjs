// Drives the worker against an in-memory R2 stub, end to end: `npm run test:worker`.
//
// The checks worth keeping an eye on are the ones about the passage text. A
// student must not be able to read the sentences before typing them, and that
// property is easy to break by accident — adding a field to a response, or
// returning the whole record where a summary was meant. Those assertions fail
// loudly if that ever happens.
import worker from './worker.js';
import { createHash } from 'node:crypto';
import { notebookPlan } from '../src/lib/notebook.js';
import { decryptAudio } from '../src/lib/audioCipher.js';

function makeBucket() {
  const objects = new Map();
  const toBytes = (v) =>
    typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v);
  // Etags change on every write, and a put with onlyIf.etagMatches is refused
  // (returns null, as R2 does) when the stored etag differs — which is what
  // lets the worker notice a write that would clobber a concurrent one.
  let version = 0;
  let cancelledBodies = 0;
  return {
    _objects: objects,
    get _cancelledBodies() { return cancelledBodies; },
    async put(key, value, opts = {}) {
      const want = opts.onlyIf?.etagMatches;
      if (want !== undefined && objects.get(key)?.etag !== want) return null;
      version += 1;
      const etag = `v${version}`;
      objects.set(key, { bytes: toBytes(value), customMetadata: opts.customMetadata || {}, httpMetadata: opts.httpMetadata || {}, etag });
      return { key, etag };
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(o.bytes);
          controller.close();
        },
        cancel() { cancelledBodies += 1; },
      });
      return {
        key,
        etag: o.etag,
        size: o.bytes.byteLength,
        body,
        customMetadata: o.customMetadata,
        httpMetadata: o.httpMetadata,
        async json() { return new Response(body).json(); },
      };
    },
    async head(key) {
      const object = objects.get(key);
      return object ? { key, etag: object.etag, size: object.bytes.byteLength } : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => ({ key: k, customMetadata: v.customMetadata }));
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + limit);
      const end = start + page.length;
      return { objects: page, truncated: end < all.length, cursor: String(end) };
    },
  };
}

const PASSWORD = 'test-teacher-pw';
const STUDENT_TOKEN = 'verified-pinplay-session';
const authCalls = [];
const profile = { email: 'testkid@override.local', displayName: 'Test Kid', className: '2ESO B' };
const authService = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = request.method === 'POST' ? await request.json() : null;
    authCalls.push({ path, body, token: request.headers.get('X-Student-Token') });
    if (path === '/api/student/config') {
      return Response.json({ ok: true, loginEnabled: true, googleClientId: 'shared-client', allowedDomains: ['school.cat'] });
    }
    if (path === '/api/student/login') {
      if (body.googleIdToken === 'wrong-school') return Response.json({ error: 'Use your school account.', reason: 'domain' }, { status: 403 });
      if (body.googleIdToken !== 'google-credential') return Response.json({ error: 'Invalid Google sign-in.' }, { status: 401 });
      return Response.json({ ok: true, studentToken: STUDENT_TOKEN, expiresAt: Date.now() + 60000, student: profile });
    }
    if (path === '/api/student/me') {
      if (request.headers.get('X-Student-Token') !== STUDENT_TOKEN) {
        return Response.json({ error: 'Please sign in again.', reason: 'signin' }, { status: 401 });
      }
      return Response.json({ ok: true, student: { ...profile, studentKey: 'do-not-trust-this-key' } });
    }
    return Response.json({ error: 'Unexpected auth request.' }, { status: 404 });
  },
};
const env = {
  ASSIGN_BUCKET: makeBucket(),
  CREATE_PASSWORD_HASH: createHash('sha256').update(PASSWORD.normalize('NFC')).digest('hex'),
  STUDENT_LOGIN_OVERRIDE_USER: 'testkid',
  STUDENT_LOGIN_OVERRIDE_PASS: 'kidpw',
  PINPLAY_AUTH: authService,
};

const BASE = 'https://api.test';
let failures = 0;
function check(label, cond, extra = '') {
  const mark = cond ? 'ok  ' : 'FAIL';
  if (!cond) failures += 1;
  console.log(`${mark} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function call(path, { method = 'GET', body, headers = {}, raw } = {}) {
  const init = { method, headers: { ...headers } };
  if (raw) {
    init.body = raw;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await worker.fetch(new Request(BASE + path, init), env);
  const type = res.headers.get('Content-Type') || '';
  const payload = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, payload, headers: res.headers };
}

// Force an overlap at the persistence boundary: the first request has already
// read and changed its copy when the second commits. This exercises stale
// writes deterministically instead of depending on Promise scheduling.
async function raceAttemptWrite(code, delayedRequest, winningRequest) {
  const bucket = env.ASSIGN_BUCKET;
  const originalPut = bucket.put;
  let reachWrite;
  let releaseWrite;
  const reached = new Promise((resolve) => { reachWrite = resolve; });
  const release = new Promise((resolve) => { releaseWrite = resolve; });
  let paused = false;
  bucket.put = async function (key, value, options) {
    if (!paused && key.startsWith(`assign/${code}/attempts/`) && options?.onlyIf) {
      paused = true;
      reachWrite();
      await release;
    }
    return originalPut.call(this, key, value, options);
  };
  try {
    const delayed = delayedRequest();
    await Promise.race([
      reached,
      delayed.then(() => { throw new Error('Request did not reach an attempt write.'); }),
    ]);
    const winner = await winningRequest();
    releaseWrite();
    return [await delayed, winner];
  } finally {
    releaseWrite();
    bucket.put = originalPut;
  }
}

// ----------------------------------------------------------- shared sign-in
const config = await call('/api/student/config');
check('Google client and school rules come from PinPlay', config.payload.googleClientId === 'shared-client'
  && config.payload.allowedDomains[0] === 'school.cat');
check('authentication responses are not cached', config.headers.get('Cache-Control') === 'no-store');
check('CORS permits student session headers', config.headers.get('Access-Control-Allow-Headers').includes('X-Student-Token'));
const login = await call('/api/student/login', { method: 'POST', body: { googleIdToken: 'google-credential', email: 'impostor@school.cat' } });
check('Google sign-in reuses the PinPlay session', login.payload.studentToken === STUDENT_TOKEN);
check('only the Google credential is forwarded', Object.keys(authCalls.at(-1).body).join(',') === 'googleIdToken');
const refused = await call('/api/student/login', { method: 'POST', body: { googleIdToken: 'wrong-school' } });
check('PinPlay school-account policy is preserved', refused.status === 403 && refused.payload.reason === 'domain');
check('empty Google credentials are refused', (await call('/api/student/login', { method: 'POST', body: {} })).status === 400);
env.PINPLAY_AUTH = undefined;
check('missing auth binding fails clearly', (await call('/api/student/config')).status === 503);
env.PINPLAY_AUTH = { fetch: async () => { throw new Error('offline'); } };
check('unavailable auth service fails clearly', (await call('/api/student/config')).status === 503);
env.PINPLAY_AUTH = { fetch: async () => new Response('<html>bad gateway</html>') };
check('invalid auth responses fail closed', (await call('/api/student/config')).status === 503);
env.PINPLAY_AUTH = { fetch: async () => Response.json({ error: 'Not found' }, { status: 404 }) };
check('an auth service missing the new route fails clearly', (await call('/api/student/config')).status === 503);
env.PINPLAY_AUTH = authService;

// ---------------------------------------------------------------- teacher
const wrong = await call('/api/teacher/verify', { method: 'POST', body: { password: 'nope' } });
check('wrong teacher password rejected', wrong.status === 401);

const good = await call('/api/teacher/verify', { method: 'POST', body: { password: PASSWORD } });
check('right teacher password accepted', good.status === 200);

const created = await call('/api/teacher/assignments/create', {
  method: 'POST',
  body: {
    password: PASSWORD,
    title: 'Volcanoes',
    className: '2ESO',
    text: 'A volcano is a mountain. It can erupt. Lava comes out of it.',
    maxListens: 1,
    attemptsLimit: 1,
    feedbackMode: 'end',
    lang: 'en-US',
    rate: 1,
    // Strict on purpose: the score check further down needs the lower-case,
    // unpunctuated third answer to lose marks.
    grading: { ignoreCase: false, ignorePunctuation: false, ignoreAccents: false },
    source: { title: 'Volcano', url: 'https://simple.wikipedia.org/wiki/Volcano' },
  },
});
const code = created.payload.code;
check('assignment created', created.status === 200 && !!code, `code=${code}`);
check('student slowdown is off by default', created.payload.record.settings.allowSlowdown === false);
check('explicitly disabled grading options remain disabled',
  ['ignoreCase', 'ignorePunctuation', 'ignoreAccents']
    .every((key) => created.payload.record.grading[key] === false));
check('server split the passage', created.payload.sentences?.length === 3,
  JSON.stringify(created.payload.sentences));

// Students must not be able to see a draft.
const draftMeta = await call(`/api/assignments/${code}/meta`);
check('draft assignment is invisible to students', draftMeta.status === 404);

const earlyPublish = await call(`/api/teacher/assignments/${code}/publish`, {
  method: 'POST', body: { password: PASSWORD },
});
check('publish blocked while audio is missing', earlyPublish.status === 400,
  earlyPublish.payload.error);

for (let i = 0; i < 3; i += 1) {
  const up = await call(`/api/teacher/assignments/${code}/audio/${i}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg', 'X-Teacher-Password': PASSWORD },
    raw: new Uint8Array([0xff, 0xfb, i]),
  });
  if (up.status !== 200) check(`audio ${i} uploaded`, false, JSON.stringify(up.payload));
}
check('all three clips uploaded', true);

const badType = await call(`/api/teacher/assignments/${code}/audio/0`, {
  method: 'PUT',
  headers: { 'Content-Type': 'text/plain', 'X-Teacher-Password': PASSWORD },
  raw: new Uint8Array([1, 2, 3]),
});
check('non-mpeg upload rejected', badType.status === 415);

const published = await call(`/api/teacher/assignments/${code}/publish`, {
  method: 'POST', body: { password: PASSWORD },
});
check('assignment published', published.status === 200);

// ---------------------------------------------------------------- student
const meta = await call(`/api/assignments/${code}/meta`);
check('meta available once published', meta.status === 200);
check('meta hides the sentences', !JSON.stringify(meta.payload).includes('volcano'),
  JSON.stringify(meta.payload));
// The citation names the article the passage came from. Handing that over
// before the student has typed a word would let them go and read it.
check('meta hides where the passage came from',
  !JSON.stringify(meta.payload).toLowerCase().includes('wikipedia'),
  JSON.stringify(meta.payload));
check('meta reports the sentence count', meta.payload.meta.sentenceCount === 3);

const badLogin = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { username: 'testkid', password: 'wrong' },
});
check('dictation no longer accepts student passwords', badLogin.status === 401);
const oldLogin = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { username: 'testkid', password: 'kidpw' },
});
check('even a valid legacy password cannot start a dictation', oldLogin.status === 401);
const invalidSession = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { studentToken: 'expired-or-forged', email: profile.email },
});
check('an invalid session cannot be replaced by a claimed email', invalidSession.status === 401);

const start = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN, username: 'Impostor', email: 'impostor@school.cat', studentKey: 'usr_impostor' },
});
const attemptId = start.payload.attemptId;
check('student started an attempt', start.status === 200 && !!attemptId);
check('start response hides the sentences', !JSON.stringify(start.payload).includes('volcano'));
const storedStart = await (await env.ASSIGN_BUCKET.get(`assign/${code}/attempts/usr_${profile.email}/${attemptId}.json`)).json();
check('verified email preserves the existing student key', storedStart.studentKey === `usr_${profile.email}`);
check('name and class come from the shared roster', storedStart.studentName === profile.displayName
  && storedStart.studentEmail === profile.email && storedStart.className === profile.className);

// maxListens = 1 → first play + 1 replay = 2 allowed.
const play1 = await call(`/api/assignments/${code}/audio/0?attemptId=${attemptId}`);
check('first play allowed', play1.status === 200, `left=${play1.headers.get('X-Listens-Left')}`);
const play2 = await call(`/api/assignments/${code}/audio/0?attemptId=${attemptId}`);
check('one replay allowed', play2.status === 200, `left=${play2.headers.get('X-Listens-Left')}`);
const play3 = await call(`/api/assignments/${code}/audio/0?attemptId=${attemptId}`);
check('second replay refused', play3.status === 403, play3.payload.error);

const noAttempt = await call(`/api/assignments/${code}/audio/0?attemptId=at_bogus`);
check('audio needs a real attemptId', noAttempt.status === 401);

const saved = await call(`/api/assignments/${code}/answer`, {
  method: 'POST', body: { attemptId, index: 0, text: 'A volcano is a mountain.' },
});
// Only per-sentence mode marks as it goes. Here the save must stay a bare
// acknowledgement, or the answer route becomes a way to read the passage.
check('saving an answer reveals nothing in end mode',
  saved.payload.feedback === undefined && !JSON.stringify(saved.payload).includes('volcano'),
  JSON.stringify(saved.payload));
await call(`/api/assignments/${code}/warning`, { method: 'POST', body: { attemptId } });

// Resume: same student, unfinished attempt.
const resume = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: {}, headers: { 'X-Student-Token': STUDENT_TOKEN },
});
check('unfinished attempt resumes', resume.payload.resumed === true && resume.payload.attemptId === attemptId);
check('resume knows where to continue', resume.payload.nextIndex === 1, `nextIndex=${resume.payload.nextIndex}`);
check('resume returns the answers so far', resume.payload.answers[0] === 'A volcano is a mountain.');

// Sentence 0 was saved mid-session as 'A volcano is a mountain.'; the hand-in
// sends something else for it. In end mode the hand-in copy is the one that
// counts — nothing was shown before submitting, so there is nothing to copy.
const submit = await call(`/api/assignments/${code}/submit`, {
  method: 'POST',
  body: {
    attemptId,
    answers: ['A volcano is a hill.', 'It can erupt.', 'lava comes out of it'],
  },
});
check('submitted', submit.status === 200);
check('in end mode the hand-in copy replaces a saved answer',
  submit.payload.results?.sentences?.[0]?.typed === 'A volcano is a hill.',
  JSON.stringify(submit.payload.results?.sentences?.[0]));
check('score computed server-side', submit.payload.scorePercent > 60 && submit.payload.scorePercent < 100,
  `score=${submit.payload.scorePercent}%`);
check('results reveal the text after submitting', JSON.stringify(submit.payload.results).includes('Lava'));

const replayAfter = await call(`/api/assignments/${code}/audio/0?attemptId=${attemptId}`);
check('replays are free once submitted', replayAfter.status === 200);

const secondAttempt = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
});
check('a returning student gets their handed-in result back', secondAttempt.status === 200
  && secondAttempt.payload.submitted && secondAttempt.payload.attemptId === attemptId
  && secondAttempt.payload.outcome?.scorePercent === submit.payload.scorePercent);
check('and is told no attempts are left', secondAttempt.payload.canStartNew === false && secondAttempt.payload.attemptsLeft === 0);
const freshBlocked = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN, fresh: true },
});
check('attempts limit enforced', freshBlocked.status === 403, freshBlocked.payload.error);

// ------------------------------------------------------ per-sentence feedback
// Each answer comes back marked, which is the one time the worker hands over
// passage text before submission — so it has to be only the sentence just
// answered, never one further on.

const perSentence = await call('/api/teacher/assignments/create', {
  method: 'POST',
  body: {
    password: PASSWORD,
    title: 'Volcanoes, marked as you go',
    className: '2ESO',
    text: 'A volcano is a mountain. It can erupt. Lava comes out of it.',
    attemptsLimit: 1,
    feedbackMode: 'sentence',
    lang: 'en-US',
    rate: 1,
    // No grading sent: the assignment should take the lenient defaults.
  },
});
const psCode = perSentence.payload.code;
check('per-sentence assignment created', perSentence.status === 200 && !!psCode, `code=${psCode}`);
check('an unsent marking rule takes the lenient default',
  perSentence.payload.record.grading?.ignoreCase === true
    && perSentence.payload.record.grading?.ignorePunctuation === true
    && perSentence.payload.record.grading?.ignoreAccents === true,
  JSON.stringify(perSentence.payload.record.grading));
for (let i = 0; i < 3; i += 1) {
  await call(`/api/teacher/assignments/${psCode}/audio/${i}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg', 'X-Teacher-Password': PASSWORD },
    raw: new Uint8Array([0xff, 0xfb, i]),
  });
}
await call(`/api/teacher/assignments/${psCode}/publish`, { method: 'POST', body: { password: PASSWORD } });
const psMeta = await call(`/api/assignments/${psCode}/meta`);
check('meta tells the app feedback is per sentence', psMeta.payload.meta.feedbackMode === 'sentence');
check('per-sentence meta still hides the sentences', !JSON.stringify(psMeta.payload).includes('volcano'));

const psStart = await call(`/api/assignments/${psCode}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
});
const psAttempt = psStart.payload.attemptId;
check('per-sentence start still hides the sentences', !JSON.stringify(psStart.payload).includes('volcano'));

const first = await call(`/api/assignments/${psCode}/answer`, {
  method: 'POST', body: { attemptId: psAttempt, index: 0, text: 'a volcano is a mountain' },
});
check('the sentence just answered comes back marked',
  first.payload.feedback?.original === 'A volcano is a mountain.', JSON.stringify(first.payload));
check('marked under the lenient defaults: case and the full stop are forgiven',
  first.payload.feedback?.accuracy === 1, `accuracy=${first.payload.feedback?.accuracy}`);
check('the marking carries word segments for the diff view',
  Array.isArray(first.payload.feedback?.segments) && first.payload.feedback.segments.length > 0);
check('only that one sentence is revealed',
  !JSON.stringify(first.payload).includes('erupt') && !JSON.stringify(first.payload).includes('Lava'),
  JSON.stringify(first.payload));

// Skipping to the last sentence is a request to read ahead. The answer is
// kept — it is still their answer — but nothing is revealed for it.
const ahead = await call(`/api/assignments/${psCode}/answer`, {
  method: 'POST', body: { attemptId: psAttempt, index: 2, text: 'guessing' },
});
check('answering ahead of the current sentence is accepted', ahead.status === 200);
check('but reveals nothing',
  ahead.payload.feedback === undefined && !JSON.stringify(ahead.payload).includes('Lava'),
  JSON.stringify(ahead.payload));

const second = await call(`/api/assignments/${psCode}/answer`, {
  method: 'POST', body: { attemptId: psAttempt, index: 1, text: 'It can explode.' },
});
check('the next sentence in order is marked as usual',
  second.payload.feedback?.original === 'It can erupt.', JSON.stringify(second.payload));
check('and a wrong word is marked wrong',
  second.payload.feedback?.missed === 1 && second.payload.feedback?.extra === 1,
  JSON.stringify(second.payload.feedback));

// The sentence has been shown, so typing it back in must earn nothing. The
// repeat is answered — a lost response can be retried — but with the marking
// of the answer already stored, not the copy.
const copied = await call(`/api/assignments/${psCode}/answer`, {
  method: 'POST', body: { attemptId: psAttempt, index: 1, text: 'It can erupt.' },
});
check('re-answering a shown sentence does not replace the stored answer',
  copied.payload.feedback?.typed === 'It can explode.' && copied.payload.feedback?.missed === 1,
  JSON.stringify(copied.payload.feedback));
check('and the repeat still gets the marking back, so a retry is safe',
  copied.payload.feedback?.original === 'It can erupt.');

// The sentence answered ahead earlier ('guessing') is stored; reaching it in
// order now shows it, marked from that stored answer — the early guess was
// final too.
const reached = await call(`/api/assignments/${psCode}/answer`, {
  method: 'POST', body: { attemptId: psAttempt, index: 2, text: 'Lava comes out of it.' },
});
check('a sentence answered ahead is marked from that first answer when reached',
  reached.payload.feedback?.typed === 'guessing' && reached.payload.feedback?.original === 'Lava comes out of it.',
  JSON.stringify(reached.payload.feedback));

// Every sentence has now been shown. Handing in the originals must change
// nothing: in per-sentence mode the stored answers are final and the hand-in
// copy only fills gaps.
const psSubmit = await call(`/api/assignments/${psCode}/submit`, {
  method: 'POST',
  body: { attemptId: psAttempt, answers: ['A volcano is a mountain.', 'It can erupt.', 'Lava comes out of it.'] },
});
check('per-sentence attempt submitted', psSubmit.status === 200);
check('submit reports the real feedback mode', psSubmit.payload.feedbackMode === 'sentence');
check('and still returns the full marked results at the end', !!psSubmit.payload.results?.sentences);
check('handing in the shown sentences does not rewrite the marked answers',
  psSubmit.payload.results?.sentences?.map((s) => s.typed).join('|')
    === 'a volcano is a mountain|It can explode.|guessing',
  JSON.stringify(psSubmit.payload.results?.sentences?.map((s) => s.typed)));
check('so the score is what the real answers earned, not 100',
  psSubmit.payload.scorePercent < 100 && psSubmit.payload.scorePercent > 0,
  `score=${psSubmit.payload.scorePercent}%`);

const psLate = await call(`/api/assignments/${psCode}/answer`, {
  method: 'POST', body: { attemptId: psAttempt, index: 0, text: 'again' },
});
check('answers are refused once submitted, in per-sentence mode too', psLate.status === 409);

// A save that never reached the worker leaves a gap. The hand-in copy fills
// it — that is what the copy is for — without touching what was marked.
const gapAssignment = await call('/api/teacher/assignments/create', {
  method: 'POST',
  body: {
    password: PASSWORD, title: 'Gap', className: '2ESO',
    text: 'A volcano is a mountain. It can erupt. Lava comes out of it.',
    attemptsLimit: 1, feedbackMode: 'sentence', lang: 'en-US', rate: 1,
  },
});
const gapCode = gapAssignment.payload.code;
for (let i = 0; i < 3; i += 1) {
  await call(`/api/teacher/assignments/${gapCode}/audio/${i}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg', 'X-Teacher-Password': PASSWORD },
    raw: new Uint8Array([0xff, 0xfb, i]),
  });
}
await call(`/api/teacher/assignments/${gapCode}/publish`, { method: 'POST', body: { password: PASSWORD } });
const gapStart = await call(`/api/assignments/${gapCode}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
});
const gapAttempt = gapStart.payload.attemptId;
await call(`/api/assignments/${gapCode}/answer`, {
  method: 'POST', body: { attemptId: gapAttempt, index: 0, text: 'A volcano is a mountain.' },
});
// sentence 1's save is lost; sentence 2 arrives out of order and is kept unmarked
const afterGap = await call(`/api/assignments/${gapCode}/answer`, {
  method: 'POST', body: { attemptId: gapAttempt, index: 2, text: 'Lava comes out of it.' },
});
check('a sentence past a gap is stored but not shown', afterGap.payload.feedback === undefined);
const gapResume = await call(`/api/assignments/${gapCode}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
});
check('resume picks up at the gap', gapResume.payload.nextIndex === 1);
check('and says which sentences really have an answer, blanks padded or not',
  JSON.stringify(gapResume.payload.answered) === '[0,2]' && gapResume.payload.answers.length === 3,
  `answered=${JSON.stringify(gapResume.payload.answered)} answers=${JSON.stringify(gapResume.payload.answers)}`);
// the client re-sends the missing one ahead of its next save, so marking resumes
const filled = await call(`/api/assignments/${gapCode}/answer`, {
  method: 'POST', body: { attemptId: gapAttempt, index: 1, text: 'It can erupt.' },
});
check('filling the gap marks that sentence', filled.payload.feedback?.original === 'It can erupt.');
const again = await call(`/api/assignments/${gapCode}/answer`, {
  method: 'POST', body: { attemptId: gapAttempt, index: 2, text: 'Lava comes out of it.' },
});
check('and the sentence past it is shown once the gap is closed',
  again.payload.feedback?.original === 'Lava comes out of it.', JSON.stringify(again.payload));
const gapSubmit = await call(`/api/assignments/${gapCode}/submit`, {
  method: 'POST',
  body: { attemptId: gapAttempt, answers: ['x', 'y', 'z'] },
});
check('nothing marked is replaced at hand-in even with a full client copy',
  gapSubmit.payload.results?.sentences?.map((s) => s.typed).join('|')
    === 'A volcano is a mountain.|It can erupt.|Lava comes out of it.',
  JSON.stringify(gapSubmit.payload.results?.sentences?.map((s) => s.typed)));
check('a fully correct per-sentence attempt scores 100', gapSubmit.payload.scorePercent === 100,
  `score=${gapSubmit.payload.scorePercent}%`);

// Two requests touching one attempt at the same moment. Each reads the
// attempt, changes it and writes it back; without a conditional write the
// second write would discard the first's change — and in per-sentence mode
// a discarded answer is a sentence the student has already read and could
// now answer again for full marks.
const raceAssignment = await call('/api/teacher/assignments/create', {
  method: 'POST',
  body: {
    password: PASSWORD, title: 'Race', className: '2ESO',
    text: 'A volcano is a mountain. It can erupt. Lava comes out of it.',
    attemptsLimit: 0, maxListens: 1, feedbackMode: 'sentence', lang: 'en-US', rate: 1,
  },
});
const raceCode = raceAssignment.payload.code;
for (let i = 0; i < 3; i += 1) {
  await call(`/api/teacher/assignments/${raceCode}/audio/${i}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mpeg', 'X-Teacher-Password': PASSWORD },
    raw: new Uint8Array([0xff, 0xfb, i]),
  });
}
await call(`/api/teacher/assignments/${raceCode}/publish`, { method: 'POST', body: { password: PASSWORD } });
const raceStart = await call(`/api/assignments/${raceCode}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
});
const raceAttempt = raceStart.payload.attemptId;
const [raceAnswer, raceAudio, raceWarning] = await Promise.all([
  call(`/api/assignments/${raceCode}/answer`, {
    method: 'POST', body: { attemptId: raceAttempt, index: 0, text: 'wrong' },
  }),
  call(`/api/assignments/${raceCode}/audio/0?attemptId=${raceAttempt}`),
  call(`/api/assignments/${raceCode}/warning`, { method: 'POST', body: { attemptId: raceAttempt } }),
]);
check('concurrent answer, listen and warning all succeed',
  raceAnswer.status === 200 && raceAudio.status === 200 && raceWarning.status === 200,
  `${raceAnswer.status} ${raceAudio.status} ${raceWarning.status}`);
check('the answer was shown', raceAnswer.payload.feedback?.original === 'A volcano is a mountain.');
const raceResume = await call(`/api/assignments/${raceCode}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
});
check('and survived the concurrent writes', raceResume.payload.answers?.[0] === 'wrong',
  JSON.stringify(raceResume.payload.answers));
check('as did the listen and the warning',
  raceResume.payload.listens?.[0] === 1 && raceResume.payload.warnings === 1,
  `listens=${JSON.stringify(raceResume.payload.listens)} warnings=${raceResume.payload.warnings}`);
const raceRetype = await call(`/api/assignments/${raceCode}/answer`, {
  method: 'POST', body: { attemptId: raceAttempt, index: 0, text: 'A volcano is a mountain.' },
});
check('so the shown sentence still cannot be answered again',
  raceRetype.payload.feedback?.typed === 'wrong', JSON.stringify(raceRetype.payload.feedback));

const [losingAnswer, winningAnswer] = await raceAttemptWrite(raceCode,
  () => call(`/api/assignments/${raceCode}/answer`, {
    method: 'POST', body: { attemptId: raceAttempt, index: 1, text: 'It can erupt.' },
  }),
  () => call(`/api/assignments/${raceCode}/answer`, {
    method: 'POST', body: { attemptId: raceAttempt, index: 1, text: 'wrong too' },
  }));
check('competing answers both return the first committed answer and its mark',
  losingAnswer.status === 200 && winningAnswer.status === 200
    && losingAnswer.payload.feedback?.typed === 'wrong too'
    && JSON.stringify(losingAnswer.payload.feedback) === JSON.stringify(winningAnswer.payload.feedback));

await call(`/api/assignments/${raceCode}/audio/2?attemptId=${raceAttempt}`);
const cancelledBefore = env.ASSIGN_BUCKET._cancelledBodies;
const [losingReplay, winningReplay] = await raceAttemptWrite(raceCode,
  () => call(`/api/assignments/${raceCode}/audio/2?attemptId=${raceAttempt}`),
  () => call(`/api/assignments/${raceCode}/audio/2?attemptId=${raceAttempt}`));
check('only one concurrent request can use the final replay',
  losingReplay.status === 403 && winningReplay.status === 200
    && winningReplay.headers.get('X-Listens-Left') === '0');
check('a failed conditional listen write releases its unread audio stream',
  env.ASSIGN_BUCKET._cancelledBodies === cancelledBefore + 1);

const [racingSubmit, lastAnswer] = await raceAttemptWrite(raceCode,
  () => call(`/api/assignments/${raceCode}/submit`, {
    method: 'POST',
    body: { attemptId: raceAttempt, answers: ['A volcano is a mountain.', 'It can erupt.', 'Lava comes out of it.'] },
  }),
  () => call(`/api/assignments/${raceCode}/answer`, {
    method: 'POST', body: { attemptId: raceAttempt, index: 2, text: '' },
  }));
check('a submit retries after an overlapping answer and keeps its marked blank',
  racingSubmit.status === 200 && lastAnswer.payload.feedback?.typed === ''
    && racingSubmit.payload.results?.sentences?.[2]?.typed === '');
check('the retried submit keeps all first answers and their actual score',
  racingSubmit.payload.scorePercent === 0
    && racingSubmit.payload.results?.sentences?.map((s) => s.typed).join('|') === 'wrong|wrong too|');
check('submission preserves concurrent listen and warning counts',
  racingSubmit.payload.listens?.[0] === 1 && racingSubmit.payload.listens?.[2] === 2
    && racingSubmit.payload.warnings === 1);

const submitFirstStart = await call(`/api/assignments/${raceCode}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN, fresh: true },
});
const submitFirstAttempt = submitFirstStart.payload.attemptId;
const [lateAnswer, firstSubmit] = await raceAttemptWrite(raceCode,
  () => call(`/api/assignments/${raceCode}/answer`, {
    method: 'POST', body: { attemptId: submitFirstAttempt, index: 0, text: 'A volcano is a mountain.' },
  }),
  () => call(`/api/assignments/${raceCode}/submit`, {
    method: 'POST', body: { attemptId: submitFirstAttempt, answers: ['wrong', '', ''] },
  }));
check('an answer losing a race with hand-in cannot reopen the submitted attempt',
  lateAnswer.status === 409 && lateAnswer.payload.feedback === undefined && firstSubmit.status === 200);
const submitFirstResults = await call(`/api/assignments/${raceCode}/results?attemptId=${submitFirstAttempt}`);
check('the submitted score and answers survive a late stale answer write',
  submitFirstResults.payload.scorePercent === 0
    && submitFirstResults.payload.results?.sentences?.[0]?.typed === 'wrong');

await call('/api/teacher/assignments/delete', {
  method: 'POST', body: { password: PASSWORD, code: raceCode },
});

// ------------------------------------------------------------- ipa flavor
// Reading aloud: text goes TO the student after sign-in, scores come FROM the
// browser's recognizer, and there is no audio or draft step at all.
const ipaCreated = await call('/api/teacher/assignments/create', {
  method: 'POST',
  body: {
    password: PASSWORD,
    app: 'ipa',
    title: 'A1 introductions',
    className: '1ESO',
    sentences: ['Hi, my name is Marc.', 'I am from Barcelona.', '  ', 'Nice to meet you.'],
    lang: 'en',
    accuracyIndex: 2,
    attemptsLimit: 1,
    // Asked for on purpose: the reading app has no per-sentence mode, so the
    // worker must store 'end' here whatever the request says.
    feedbackMode: 'sentence',
    source: { lessonId: 'en_a1_introductions' },
  },
});
const ipaCode = ipaCreated.payload.code;
check('ipa assignment created', ipaCreated.status === 200 && !!ipaCode, `code=${ipaCode}`);
check('ipa keeps the given sentences (blank lines dropped)',
  ipaCreated.payload.sentences?.length === 3, JSON.stringify(ipaCreated.payload.sentences));
check('ipa never stores a per-sentence mode',
  ipaCreated.payload.record?.feedbackMode === 'end', `feedbackMode=${ipaCreated.payload.record?.feedbackMode}`);
check('ipa assignment is born active', ipaCreated.payload.record?.status === 'active');

const ipaMeta = await call(`/api/assignments/${ipaCode}/meta`);
check('ipa meta visible without publishing', ipaMeta.status === 200);
check('ipa meta pins the accuracy level', ipaMeta.payload.meta?.accuracyIndex === 2);
// The reading app needs the lesson id to fetch that lesson's per-word data
// (Darija is scored against its transcriptions, not its Arabic script).
check('ipa meta names the source lesson',
  ipaMeta.payload.meta?.source?.lessonId === 'en_a1_introductions');

const ipaStart = await call(`/api/assignments/${ipaCode}/start`, {
  method: 'POST', body: { username: 'testkid', password: 'kidpw' },
});
const ipaAttemptId = ipaStart.payload.attemptId;
check('ipa start hands over the sentences', ipaStart.status === 200 &&
  ipaStart.payload.sentences?.[0] === 'Hi, my name is Marc.', JSON.stringify(ipaStart.payload.sentences));

// Best-reading semantics: a worse later take must not lower the mark or
// replace the transcript that earned it.
await call(`/api/assignments/${ipaCode}/answer`, {
  method: 'POST', body: { attemptId: ipaAttemptId, index: 0, score: 80, text: 'hi my name is marc' },
});
await call(`/api/assignments/${ipaCode}/answer`, {
  method: 'POST', body: { attemptId: ipaAttemptId, index: 0, score: 40, text: 'hi marc' },
});
const ipaResume = await call(`/api/assignments/${ipaCode}/start`, {
  method: 'POST', body: { username: 'testkid', password: 'kidpw' },
});
check('ipa resume keeps the best score', ipaResume.payload.scores?.[0] === 80,
  JSON.stringify(ipaResume.payload.scores));
check('ipa resume keeps the transcript that earned it',
  ipaResume.payload.answers?.[0] === 'hi my name is marc');

// Submit re-sends everything; sentence 2 was never read and counts zero.
const ipaSubmit = await call(`/api/assignments/${ipaCode}/submit`, {
  method: 'POST',
  body: {
    attemptId: ipaAttemptId,
    scores: [60, 100, null],
    answers: ['hi marc again', 'i am from barcelona', ''],
  },
});
check('ipa submitted', ipaSubmit.status === 200);
check('ipa submit cannot lower a banked score', ipaSubmit.payload.scores?.[0] === 80);
check('ipa overall is the average, unread = 0',
  ipaSubmit.payload.scorePercent === Math.round((80 + 100 + 0) / 3),
  `score=${ipaSubmit.payload.scorePercent}%`);

const ipaDetail = await call('/api/teacher/attempts/get', {
  method: 'POST',
  body: { password: PASSWORD, code: ipaCode, studentKey: 'usr_testkid@override.local', attemptId: ipaAttemptId },
});
check('teacher sees per-sentence reading results',
  ipaDetail.payload.results?.perSentence?.[1]?.score === 100 &&
  ipaDetail.payload.results?.perSentence?.[1]?.transcript === 'i am from barcelona',
  JSON.stringify(ipaDetail.payload.results?.perSentence));

// -------------------------------------------------------- notebook workflow
const notebookText = 'When the sun rose over the quiet village, the children packed their bags for school, and their parents walked with them to the old stone bridge.';
const notebookSegments = notebookPlan(notebookText, 'en-US').flatMap((part) => part.segments);

// Delivery is independent of where students write. Exercise the complete
// upload/start/answer/submit flow so the recordings and grading stay aligned.
for (const mode of ['typing', 'notebook']) {
  for (const delivery of ['phrases', 'sentences']) {
    const segments = notebookPlan(notebookText, 'en-US', delivery).flatMap((part) => part.segments);
    const label = `${mode} / ${delivery}`;
    const allowSlowdown = delivery === 'phrases';
    const made = await call('/api/teacher/assignments/create', {
      method: 'POST', body: { password: PASSWORD, mode, delivery, segments,
        text: notebookText, feedbackMode: 'sentence', allowSlowdown },
    });
    check(`${label}: creation stores the selected delivery and exact plan`, made.status === 200
      && made.payload.record.delivery === delivery
      && JSON.stringify(made.payload.sentences) === JSON.stringify(segments));
    check(`${label}: teacher controls student slowdown`, made.payload.record.settings.allowSlowdown === allowSlowdown);
    const choiceCode = made.payload.code;
    for (let i = 0; i < segments.length; i++) {
      const upload = await call(`/api/teacher/assignments/${choiceCode}/audio/${i}`, {
        method: 'PUT', raw: new Uint8Array([1, 2, 3]),
        headers: { 'Content-Type': mode === 'notebook' ? 'audio/wav' : 'audio/mpeg', 'X-Teacher-Password': PASSWORD },
      });
      check(`${label}: clip ${i + 1} uploaded`, upload.status === 200);
    }
    await call(`/api/teacher/assignments/${choiceCode}/publish`, { method: 'POST', body: { password: PASSWORD } });
    const started = await call(`/api/assignments/${choiceCode}/start`, { method: 'POST', body: { studentToken: STUDENT_TOKEN } });
    const choiceId = started.payload.attemptId;
    check(`${label}: student metadata reports delivery without revealing the passage`, started.status === 200
      && started.payload.meta.delivery === delivery && started.payload.meta.sentenceCount === segments.length
      && !JSON.stringify(started.payload).includes('village'));
    check(`${label}: student receives the teacher's slowdown permission`, started.payload.meta.allowSlowdown === allowSlowdown);
    for (let i = 0; i < segments.length; i++) {
      const answer = await call(`/api/assignments/${choiceCode}/answer`, {
        method: 'POST', body: { attemptId: choiceId, index: i, text: mode === 'typing' ? segments[i] : '' },
      });
      check(`${label}: answer ${i + 1} uses the correct feedback`, answer.status === 200
        && (mode === 'typing' ? answer.payload.feedback?.accuracy === 1 : !answer.payload.feedback));
    }
    const handedIn = await call(`/api/assignments/${choiceCode}/submit`, {
      method: 'POST', body: { attemptId: choiceId, answers: mode === 'typing' ? segments : [] },
    });
    check(`${label}: completion preserves grading and notebook correction rules`, handedIn.status === 200
      && (mode === 'typing' ? handedIn.payload.results?.accuracy === 1
        : !handedIn.payload.results && !handedIn.payload.corrections));
    await call('/api/teacher/assignments/delete', { method: 'POST', body: { password: PASSWORD, code: choiceCode } });
  }
}
const invalidTypingPlan = await call('/api/teacher/assignments/create', {
  method: 'POST', body: { password: PASSWORD, mode: 'typing', delivery: 'phrases', text: notebookText, segments: ['Changed text.'] },
});
check('segmented typing rejects a plan that changes the passage', invalidTypingPlan.status === 400);

const notebookCreate = await call('/api/teacher/assignments/create', {
  method: 'POST', body: { password: PASSWORD, mode: 'notebook', text: notebookText,
    notebookSegments, feedbackMode: 'sentence' },
});
const nbCode = notebookCreate.payload.code;
check('notebook stores the smaller phrase segments supplied by the teacher', notebookCreate.status === 200
  && JSON.stringify(notebookCreate.payload.sentences) === JSON.stringify(notebookSegments));
const changedPlan = await call('/api/teacher/assignments/create', {
  method: 'POST', body: { password: PASSWORD, mode: 'notebook', text: notebookText,
    notebookSegments: ['The passage changed.'] },
});
check('notebook rejects a phrase plan that drops or changes text', changedPlan.status === 400);
const manyPhrases = Array(61).fill('A short phrase.');
const largerNotebook = await call('/api/teacher/assignments/create', {
  method: 'POST', body: { password: PASSWORD, mode: 'notebook', text: manyPhrases.join(' '),
    notebookSegments: manyPhrases },
});
check('smaller phrases can exceed the typed assignment limit of 60 items', largerNotebook.status === 200 && largerNotebook.payload.sentences?.length === 61);
await call('/api/teacher/assignments/delete', { method: 'POST', body: { password: PASSWORD, code: largerNotebook.payload.code } });
const tooManyPhrases = Array(241).fill('A short phrase.');
const tooLargeNotebook = await call('/api/teacher/assignments/create', {
  method: 'POST', body: { password: PASSWORD, mode: 'notebook', text: tooManyPhrases.join(' '),
    notebookSegments: tooManyPhrases },
});
check('notebook phrase count remains bounded at 240', tooLargeNotebook.status === 400 && tooLargeNotebook.payload.error.includes('240'));
check('notebook feedback always waits for teacher release', notebookCreate.payload.record?.feedbackMode === 'release');
const oversizedNotebook = await call('/api/teacher/assignments/create', {
  method: 'POST', body: { password: PASSWORD, mode: 'notebook', text: 'word '.repeat(610) },
});
check('oversized sentences are rejected before creating an unrecordable notebook draft', oversizedNotebook.status === 400 && oversizedNotebook.payload.error.includes('3000'));
for (let i = 0; i < notebookCreate.payload.sentences.length; i++) {
  const uploaded = await call(`/api/teacher/assignments/${nbCode}/audio/${i}`, {
    method: 'PUT', raw: new Uint8Array([82, 73, 70, 70]), headers: { 'Content-Type': 'audio/wav', 'X-Teacher-Password': PASSWORD },
  });
  check(`notebook natural recording segment ${i + 1} accepts WAV`, uploaded.status === 200);
}
await call(`/api/teacher/assignments/${nbCode}/publish`, { method: 'POST', body: { password: PASSWORD } });
const nbStart = await call(`/api/assignments/${nbCode}/start`, { method: 'POST', body: { studentToken: STUDENT_TOKEN } });
const nbId = nbStart.payload.attemptId;
check('notebook start withholds the correction passage', nbStart.payload.meta?.mode === 'notebook' && !JSON.stringify(nbStart.payload).includes('village'));
const nbAudio = await call(`/api/assignments/${nbCode}/audio/0?attemptId=${nbId}`);
check('notebook WAV segments retain the right playback type', nbAudio.status === 200 && nbAudio.headers.get('Content-Type') === 'audio/wav');
const nbPreload = await call(`/api/assignments/${nbCode}/audio-cache/0?attemptId=${nbId}`);
const nbUnlock = await call(`/api/assignments/${nbCode}/audio-play/0`, {
  method: 'POST', body: { attemptId: nbId, version: nbPreload.headers.get('X-Audio-Version') },
});
const nbLocal = await decryptAudio(nbPreload.payload, nbUnlock.payload.key, nbPreload.headers.get('X-Audio-Type'));
check('cached notebook segments preserve WAV bytes and playback type', nbLocal.type === 'audio/wav'
  && Buffer.from(await nbLocal.arrayBuffer()).equals(new Uint8Array([82, 73, 70, 70])));
const nbAnswer = await call(`/api/assignments/${nbCode}/answer`, { method: 'POST', body: { attemptId: nbId, index: 0, text: '' } });
check('notebook progress never returns sentence feedback', nbAnswer.status === 200 && !nbAnswer.payload.feedback);
const nbSubmit = await call(`/api/assignments/${nbCode}/submit`, { method: 'POST', body: { attemptId: nbId, answers: [] } });
check('notebook completion needs no external confirmation', nbSubmit.status === 200);
check('notebook hand-in returns no feedback or automatic grade', nbSubmit.status === 200 && !nbSubmit.payload.corrections && !nbSubmit.payload.results && !('scorePercent' in nbSubmit.payload));
const nbWaiting = await call(`/api/assignments/${nbCode}/results?attemptId=${nbId}`);
check('submitted notebook still withholds corrections before release', nbWaiting.status === 200 && !nbWaiting.payload.corrections && !nbWaiting.payload.correctionsReleased);
check('student cannot release notebook corrections', (await call('/api/teacher/assignments/release-corrections', { method: 'POST', body: { code: nbCode } })).status === 401);
await call('/api/teacher/assignments/release-corrections', { method: 'POST', body: { code: nbCode, password: PASSWORD } });
const nbReleased = await call(`/api/assignments/${nbCode}/results?attemptId=${nbId}`);
check('teacher release reveals the original passage for handwritten corrections', nbReleased.payload.correctionsReleased && nbReleased.payload.corrections === notebookText);
const nbMeta = await call(`/api/assignments/${nbCode}/meta`);
check('public notebook metadata never includes the released text', !JSON.stringify(nbMeta.payload).includes('village'));
const nbDetail = await call('/api/teacher/attempts/get', { method: 'POST', body: { password: PASSWORD, code: nbCode, studentKey: 'usr_testkid@override.local', attemptId: nbId } });
check('teacher sees notebook completion without a false zero score', nbDetail.payload.results === null && nbDetail.payload.attempt.scorePercent === null && !!nbDetail.payload.attempt.submittedAt);
// An accidental hand-in: the teacher reopens it and the student carries on in
// the same attempt, without spending another one.
const reopenBody = { code: nbCode, studentKey: 'usr_testkid@override.local', attemptId: nbId };
check('student cannot reopen their own notebook hand-in', (await call('/api/teacher/attempts/reopen', { method: 'POST', body: reopenBody })).status === 401);
const nbReopen = await call('/api/teacher/attempts/reopen', { method: 'POST', body: { ...reopenBody, password: PASSWORD } });
check('teacher can reopen a handed-in notebook attempt', nbReopen.status === 200 && nbReopen.payload.attempt.submitted === false);
const nbReopened = await call(`/api/assignments/${nbCode}/start`, { method: 'POST', body: { studentToken: STUDENT_TOKEN } });
check('a reopened notebook resumes the same attempt, unfinished', nbReopened.status === 200 && nbReopened.payload.attemptId === nbId
  && !nbReopened.payload.submitted && !nbReopened.payload.outcome);
check('a reopened notebook can be handed in again', (await call(`/api/assignments/${nbCode}/submit`, { method: 'POST', body: { attemptId: nbId, answers: [] } })).status === 200);

// ------------------------------------------- teacher edits and per-student controls
const KID = 'usr_testkid@override.local';
async function publishTyped(editCode, count) {
  for (let i = 0; i < count; i += 1) {
    await call(`/api/teacher/assignments/${editCode}/audio/${i}`, {
      method: 'PUT', headers: { 'Content-Type': 'audio/mpeg', 'X-Teacher-Password': PASSWORD }, raw: new Uint8Array([0xff, 0xfb, i]),
    });
  }
  return call(`/api/teacher/assignments/${editCode}/publish`, { method: 'POST', body: { password: PASSWORD } });
}
const begin = (editCode, extra = {}) => call(`/api/assignments/${editCode}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN, ...extra },
});
const teacher = (route, body) => call(`/api/teacher/${route}`, { method: 'POST', body: { password: PASSWORD, ...body } });

const editCreate = await teacher('assignments/create', {
  text: 'One sentence here. Two sentences here.', title: 'Edit me', attemptsLimit: 1, practiceAfter: true,
});
const editCode = editCreate.payload.code;
check('practice after hand-in is stored when chosen', editCreate.payload.record?.practiceAfter === true);
await publishTyped(editCode, 2);

const firstRun = await begin(editCode);
const run1 = firstRun.payload.attemptId;
check('a first start reports the attempts left after it', firstRun.payload.attemptsLeft === 0 && firstRun.payload.canStartNew === false);
const earlyPractice = await call(`/api/assignments/${editCode}/practice`, {
  method: 'POST', body: { attemptId: run1, index: 1, text: 'Two sentences here.' },
});
check('practice is refused before handing in', earlyPractice.status === 409);
await call(`/api/assignments/${editCode}/submit`, { method: 'POST', body: { attemptId: run1, answers: ['One sentence here.', 'wrong'] } });

const practice = await call(`/api/assignments/${editCode}/practice`, {
  method: 'POST', body: { attemptId: run1, index: 1, text: 'Two sentences here.' },
});
check('practice after hand-in is marked', practice.status === 200 && practice.payload.feedback?.accuracy === 1);
const afterPractice = await begin(editCode);
check('practice changes nothing stored', afterPractice.payload.outcome?.results?.sentences?.[1]?.typed === 'wrong'
  && afterPractice.payload.practice === true);

const gradingLocked = await teacher('assignments/update-settings', { code: editCode, grading: { ignoreCase: false } });
check('marking cannot change once someone has handed in', gradingLocked.status === 400);
check('students cannot change settings',
  (await call('/api/teacher/assignments/update-settings', { method: 'POST', body: { code: editCode, attemptsLimit: 0 } })).status === 401);
const edited = await teacher('assignments/update-settings', {
  code: editCode, title: 'Edited', maxListens: 2, dueAt: null, allowSlowdown: true, feedbackMode: 'sentence',
});
check('teacher can change settings later', edited.status === 200 && edited.payload.record.title === 'Edited'
  && edited.payload.record.maxListens === 2 && edited.payload.record.settings.allowSlowdown === true
  && edited.payload.record.feedbackMode === 'sentence' && edited.payload.record.attemptsLimit === 1);

const extra = await teacher('attempts/extra', { code: editCode, studentKey: KID });
check('teacher can give one student another attempt', extra.status === 200 && extra.payload.extraAttempts === 1);
check('the student sees it', (await begin(editCode)).payload.canStartNew === true);
const secondRun = await begin(editCode, { fresh: true });
const run2 = secondRun.payload.attemptId;
check('and can start it', secondRun.status === 200 && run2 && run2 !== run1 && !secondRun.payload.submitted);
await call(`/api/assignments/${editCode}/submit`, { method: 'POST', body: { attemptId: run2, answers: ['x', 'y'] } });
check('after which the limit applies again', (await begin(editCode, { fresh: true })).status === 403);

const removed = await teacher('attempts/delete', { code: editCode, studentKey: KID, attemptId: run2 });
check('teacher can delete an attempt', removed.status === 200);
const afterDelete = await teacher('assignments/get', { code: editCode });
check('a deleted attempt is gone and frees its place', afterDelete.payload.attempts.length === 1
  && (await begin(editCode)).payload.canStartNew === true);

const typedReopen = await teacher('attempts/reopen', { code: editCode, studentKey: KID, attemptId: run1 });
check('typed attempts can be reopened too', typedReopen.status === 200 && typedReopen.payload.attempt.submitted === false
  && typedReopen.payload.attempt.results === null);
const resumedTyped = await begin(editCode);
check('a reopened typed attempt resumes with its answers', resumedTyped.payload.attemptId === run1
  && !resumedTyped.payload.submitted && resumedTyped.payload.answers[1] === 'wrong');

const heard = await teacher('assignments/audio', { code: editCode, index: 1 });
check('teacher can listen to a recording', heard.status === 200 && heard.headers.get('Content-Type') === 'audio/mpeg');

const rewritten = await teacher('assignments/update-content', {
  code: editCode, text: 'Brand new text. With two. And three.',
});
check('teacher can replace the text, clearing student work', rewritten.status === 200
  && rewritten.payload.sentences.length === 3 && rewritten.payload.cleared === 1 && rewritten.payload.record.status === 'draft');
check('settings survive a text edit', rewritten.payload.record.title === 'Edited' && rewritten.payload.record.maxListens === 2);
check('students cannot open it while it is re-recorded', (await begin(editCode)).status === 404);
check('it cannot be published before every new sentence has audio',
  (await call(`/api/teacher/assignments/${editCode}/publish`, { method: 'POST', body: { password: PASSWORD } })).status === 400);
await publishTyped(editCode, 3);
const afterRewrite = await begin(editCode);
check('students start the new text afresh', afterRewrite.status === 200 && !afterRewrite.payload.submitted
  && afterRewrite.payload.attemptId !== run1 && afterRewrite.payload.meta.sentenceCount === 3);
const gradingNow = await teacher('assignments/update-settings', { code: editCode, grading: { ignoreCase: false } });
check('marking can change again once nobody has handed in', gradingNow.status === 200
  && gradingNow.payload.record.grading.ignoreCase === false);
await teacher('assignments/delete', { code: editCode });
await call('/api/teacher/assignments/status', { method: 'POST', body: { password: PASSWORD, code: nbCode, status: 'archived' } });
const nbResume = await call(`/api/assignments/${nbCode}/start`, { method: 'POST', body: { studentToken: STUDENT_TOKEN } });
check('signed-in student can reopen corrections after assignment is archived', nbResume.status === 200 && nbResume.payload.submitted && nbResume.payload.outcome?.corrections === notebookText);
const originalEmail = profile.email;
profile.email = 'otherkid@override.local';
const nbOther = await call(`/api/assignments/${nbCode}/start`, { method: 'POST', body: { studentToken: STUDENT_TOKEN } });
check('another student cannot reopen the submitted notebook', nbOther.status === 403 && !JSON.stringify(nbOther.payload).includes('village'));
profile.email = originalEmail;
// A release is not enough: an unfinished attempt cannot fetch the passage.
const nbStored = env.ASSIGN_BUCKET._objects.get(`assign/${nbCode}/attempts/usr_testkid@override.local/${nbId}.json`);
const nbUnfinished = JSON.parse(new TextDecoder().decode(nbStored.bytes));
nbUnfinished.submitted = false;
await env.ASSIGN_BUCKET.put(`assign/${nbCode}/attempts/usr_testkid@override.local/${nbId}.json`, JSON.stringify(nbUnfinished));
const nbNotSubmitted = await call(`/api/assignments/${nbCode}/results?attemptId=${nbId}`);
check('released corrections still require a submitted attempt', nbNotSubmitted.status === 409 && !JSON.stringify(nbNotSubmitted.payload).includes('village'));
await call('/api/teacher/assignments/delete', { method: 'POST', body: { password: PASSWORD, code: nbCode } });

// ---------------------------------------------------------------- dashboard
const list = await call('/api/teacher/assignments/list', {
  method: 'POST', body: { password: PASSWORD },
});
// Found by code, not position: the dashboard lists newest first, and other
// sections of this file create assignments of their own.
const listed = list.payload.assignments?.find((a) => a.code === code);
check('assignment appears in the dashboard', !!listed);
check('dashboard shows the class', listed?.className === '2ESO');
check('dictation dashboard does not show ipa assignments',
  !list.payload.assignments?.some((a) => a.code === ipaCode));

const ipaList = await call('/api/teacher/assignments/list', {
  method: 'POST', body: { password: PASSWORD, app: 'ipa' },
});
check('ipa dashboard lists only ipa assignments',
  ipaList.payload.assignments?.length === 1 && ipaList.payload.assignments[0].code === ipaCode);

const detail = await call('/api/teacher/assignments/get', {
  method: 'POST', body: { password: PASSWORD, code },
});
const row = detail.payload.attempts?.[0];
check('teacher sees the attempt', !!row, JSON.stringify(row));
check('attempt row carries the score', row?.scorePercent === submit.payload.scorePercent);
// Two metered plays of sentence 0: the third was refused and the post-submit
// review play is deliberately free.
check('attempt row counts plays', row?.plays === 2, `plays=${row?.plays}`);
check('attempt row counts warnings', row?.warnings === 1);

const one = await call('/api/teacher/attempts/get', {
  method: 'POST',
  body: { password: PASSWORD, code, studentKey: row.studentKey, attemptId: row.id },
});
check('teacher can open one attempt', one.status === 200 && !!one.payload.results);

const closed = await call('/api/teacher/assignments/status', {
  method: 'POST', body: { password: PASSWORD, code, status: 'archived' },
});
check('assignment can be archived', closed.status === 200);
const afterArchive = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN, fresh: true },
});
check('archived assignment refuses new starts', afterArchive.status === 403);
const archivedReturn = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
});
check('but still shows a returning student their result', archivedReturn.status === 200
  && archivedReturn.payload.submitted && archivedReturn.payload.canStartNew === false);

// Background downloads must never use listens or release plaintext/key data.
const cacheAssignment = await call('/api/teacher/assignments/create', {
  method: 'POST', body: {
    password: PASSWORD, title: 'Cached playback', text: 'First recording. Second recording. Third recording.',
    attemptsLimit: 0, maxListens: 1, feedbackMode: 'end', lang: 'en-US', rate: 1,
  },
});
const cacheCode = cacheAssignment.payload.code;
const recording = (index) => new Uint8Array([0xff, 0xfb, index, 25, 99]);
for (let index = 0; index < 3; index += 1) {
  await call(`/api/teacher/assignments/${cacheCode}/audio/${index}`, {
    method: 'PUT', headers: { 'Content-Type': 'audio/mpeg', 'X-Teacher-Password': PASSWORD }, raw: recording(index),
  });
}
await call(`/api/teacher/assignments/${cacheCode}/publish`, { method: 'POST', body: { password: PASSWORD } });
const cacheStart = await call(`/api/assignments/${cacheCode}/start`, { method: 'POST', body: { studentToken: STUDENT_TOKEN } });
const cacheId = cacheStart.payload.attemptId;
check('new worker advertises encrypted preloading', cacheStart.payload.meta.audioPreload === 'aes-gcm-v1');
check('attempt audio secret never reaches the student', !JSON.stringify(cacheStart.payload).includes('audioSecret'));
const preloadPath = (index, id = cacheId) => `/api/assignments/${cacheCode}/audio-cache/${index}?attemptId=${id}`;
const authorize = (index, version, id = cacheId) => call(`/api/assignments/${cacheCode}/audio-play/${index}`, {
  method: 'POST', body: { attemptId: id, version },
});
const cacheState = () => call(`/api/assignments/${cacheCode}/start`, { method: 'POST', body: { studentToken: STUDENT_TOKEN } });
// Simulate an attempt created before preloading existed.
const cacheAttemptKey = `assign/${cacheCode}/attempts/usr_${profile.email}/${cacheId}.json`;
const oldAttempt = await (await env.ASSIGN_BUCKET.get(cacheAttemptKey)).json();
delete oldAttempt.audioSecret;
await env.ASSIGN_BUCKET.put(cacheAttemptKey, JSON.stringify(oldAttempt), { customMetadata: { sub: '0' } });
const [download0, download1, download2] = await Promise.all([0, 1, 2].map((index) => call(preloadPath(index))));
check('older attempts support concurrent encrypted preloads', [download0, download1, download2].every((res) => res.status === 200));
check('preloaded bytes are encrypted and not browser-cached',
  download0.payload.byteLength === recording(0).byteLength + 28
    && download0.headers.get('Cache-Control') === 'no-store'
    && download0.headers.get('Content-Type') === 'application/octet-stream');
check('all preloads leave actual listen counts empty', Object.keys((await cacheState()).payload.listens).length === 0);
check('preloads need a real attempt', (await call(preloadPath(0, 'at_bogus'))).status === 401);
check('cached plays need a real attempt', (await authorize(0, download0.headers.get('X-Audio-Version'), 'at_bogus')).status === 401);
check('preloads reject invalid segment numbers', (await call(preloadPath(3))).status === 404);
check('an unversioned unlock is refused without using a play', (await authorize(0, '')).status === 409
  && Object.keys((await cacheState()).payload.listens).length === 0);
const unlock0 = await authorize(0, download0.headers.get('X-Audio-Version'));
const local0 = await decryptAudio(download0.payload, unlock0.payload.key, download0.headers.get('X-Audio-Type'));
check('a cached play unlocks exactly the original recording',
  unlock0.status === 200 && Buffer.from(await local0.arrayBuffer()).equals(recording(0)) && local0.type === 'audio/mpeg');
check('cached play returns authoritative counts without caching its key',
  unlock0.payload.listens === 1 && unlock0.payload.listensLeft === 1 && unlock0.headers.get('Cache-Control') === 'no-store');
let isolatedKey = false;
try { await decryptAudio(download1.payload, unlock0.payload.key, 'audio/mpeg'); } catch { isolatedKey = true; }
check('one segment key cannot unlock another segment', isolatedKey);
await authorize(0, download0.headers.get('X-Audio-Version'));
const exhaustedUnlock = await authorize(0, download0.headers.get('X-Audio-Version'));
check('cached playback enforces the same replay limit', exhaustedUnlock.status === 403 && !exhaustedUnlock.payload.key);

await authorize(1, download1.headers.get('X-Audio-Version'));
const [cachedRace, directRace] = await raceAttemptWrite(cacheCode,
  () => authorize(1, download1.headers.get('X-Audio-Version')),
  () => call(`/api/assignments/${cacheCode}/audio/1?attemptId=${cacheId}`));
check('cached and streamed plays cannot both use the final replay', cachedRace.status === 403 && directRace.status === 200);

const replacement = new Uint8Array([0xff, 0xfb, 88, 77, 66]);
await call(`/api/teacher/assignments/${cacheCode}/audio/2`, {
  method: 'PUT', headers: { 'Content-Type': 'audio/mpeg', 'X-Teacher-Password': PASSWORD }, raw: replacement,
});
const stale = await authorize(2, download2.headers.get('X-Audio-Version'));
check('a replaced recording rejects the old cache without consuming a play', stale.status === 409 && !(await cacheState()).payload.listens[2]);
const freshDownload = await call(preloadPath(2));
const freshUnlock = await authorize(2, freshDownload.headers.get('X-Audio-Version'));
const freshLocal = await decryptAudio(freshDownload.payload, freshUnlock.payload.key, 'audio/mpeg');
check('the replacement recording can be cached and played', Buffer.from(await freshLocal.arrayBuffer()).equals(replacement));
const cachedTeacher = await call('/api/teacher/assignments/get', { method: 'POST', body: { password: PASSWORD, code: cacheCode } });
check('teacher counts actual plays, never background downloads', cachedTeacher.payload.attempts[0].plays === 5);
await call(`/api/assignments/${cacheCode}/submit`, { method: 'POST', body: { attemptId: cacheId, answers: [] } });
const reviewUnlock = await authorize(0, download0.headers.get('X-Audio-Version'));
check('cached review is free after submission', reviewUnlock.status === 200 && reviewUnlock.payload.listens === 2 && reviewUnlock.payload.listensLeft === null);
const newCacheAttempt = await call(`/api/assignments/${cacheCode}/start`, { method: 'POST', body: { studentToken: STUDENT_TOKEN, fresh: true } });
const otherDownload = await call(preloadPath(0, newCacheAttempt.payload.attemptId));
let attemptIsolated = false;
try { await decryptAudio(otherDownload.payload, unlock0.payload.key, 'audio/mpeg'); } catch { attemptIsolated = true; }
check('one attempt key cannot unlock another attempt cache', attemptIsolated);
await call('/api/teacher/assignments/delete', { method: 'POST', body: { password: PASSWORD, code: cacheCode } });

const del = await call('/api/teacher/assignments/delete', {
  method: 'POST', body: { password: PASSWORD, code },
});
check('assignment deleted', del.status === 200);
await call('/api/teacher/assignments/delete', {
  method: 'POST', body: { password: PASSWORD, code: ipaCode },
});
await call('/api/teacher/assignments/delete', {
  method: 'POST', body: { password: PASSWORD, code: psCode },
});
await call('/api/teacher/assignments/delete', {
  method: 'POST', body: { password: PASSWORD, code: gapCode },
});
check('nothing left in storage', env.ASSIGN_BUCKET._objects.size === 0,
  `${env.ASSIGN_BUCKET._objects.size} objects remain`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
