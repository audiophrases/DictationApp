// Drives the worker against an in-memory R2 stub, end to end: `npm run test:worker`.
//
// The checks worth keeping an eye on are the ones about the passage text. A
// student must not be able to read the sentences before typing them, and that
// property is easy to break by accident — adding a field to a response, or
// returning the whole record where a summary was meant. Those assertions fail
// loudly if that ever happens.
import worker from './worker.js';
import { createHash } from 'node:crypto';

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
      objects.set(key, { bytes: toBytes(value), customMetadata: opts.customMetadata || {}, etag });
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
        body,
        customMetadata: o.customMetadata,
        async json() { return new Response(body).json(); },
      };
    },
    async head(key) {
      return objects.has(key) ? { key } : null;
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
check('attempts limit enforced', secondAttempt.status === 403, secondAttempt.payload.error);

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
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
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
  method: 'POST', body: { studentToken: STUDENT_TOKEN },
});
check('archived assignment refuses new starts', afterArchive.status === 403);

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
