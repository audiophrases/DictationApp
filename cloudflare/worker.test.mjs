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
  return {
    _objects: objects,
    async put(key, value, opts = {}) {
      objects.set(key, { bytes: toBytes(value), customMetadata: opts.customMetadata || {} });
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        key,
        body: o.bytes,
        customMetadata: o.customMetadata,
        async json() { return JSON.parse(new TextDecoder().decode(o.bytes)); },
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
const env = {
  ASSIGN_BUCKET: makeBucket(),
  CREATE_PASSWORD_HASH: createHash('sha256').update(PASSWORD.normalize('NFC')).digest('hex'),
  STUDENT_LOGIN_OVERRIDE_USER: 'testkid',
  STUDENT_LOGIN_OVERRIDE_PASS: 'kidpw',
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
  },
});
const code = created.payload.code;
check('assignment created', created.status === 200 && !!code, `code=${code}`);
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
check('meta reports the sentence count', meta.payload.meta.sentenceCount === 3);

const badLogin = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { username: 'testkid', password: 'wrong' },
});
check('wrong student password rejected', badLogin.status === 401);

const start = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { username: 'testkid', password: 'kidpw' },
});
const attemptId = start.payload.attemptId;
check('student started an attempt', start.status === 200 && !!attemptId);
check('start response hides the sentences', !JSON.stringify(start.payload).includes('volcano'));

// maxListens = 1 → first play + 1 replay = 2 allowed.
const play1 = await call(`/api/assignments/${code}/audio/0?attemptId=${attemptId}`);
check('first play allowed', play1.status === 200, `left=${play1.headers.get('X-Listens-Left')}`);
const play2 = await call(`/api/assignments/${code}/audio/0?attemptId=${attemptId}`);
check('one replay allowed', play2.status === 200, `left=${play2.headers.get('X-Listens-Left')}`);
const play3 = await call(`/api/assignments/${code}/audio/0?attemptId=${attemptId}`);
check('second replay refused', play3.status === 403, play3.payload.error);

const noAttempt = await call(`/api/assignments/${code}/audio/0?attemptId=at_bogus`);
check('audio needs a real attemptId', noAttempt.status === 401);

await call(`/api/assignments/${code}/answer`, {
  method: 'POST', body: { attemptId, index: 0, text: 'A volcano is a mountain.' },
});
await call(`/api/assignments/${code}/warning`, { method: 'POST', body: { attemptId } });

// Resume: same student, unfinished attempt.
const resume = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { username: 'testkid', password: 'kidpw' },
});
check('unfinished attempt resumes', resume.payload.resumed === true && resume.payload.attemptId === attemptId);
check('resume knows where to continue', resume.payload.nextIndex === 1, `nextIndex=${resume.payload.nextIndex}`);
check('resume returns the answers so far', resume.payload.answers[0] === 'A volcano is a mountain.');

const submit = await call(`/api/assignments/${code}/submit`, {
  method: 'POST',
  body: {
    attemptId,
    answers: ['A volcano is a mountain.', 'It can erupt.', 'lava comes out of it'],
  },
});
check('submitted', submit.status === 200);
check('score computed server-side', submit.payload.scorePercent > 60 && submit.payload.scorePercent < 100,
  `score=${submit.payload.scorePercent}%`);
check('results reveal the text after submitting', JSON.stringify(submit.payload.results).includes('Lava'));

const replayAfter = await call(`/api/assignments/${code}/audio/0?attemptId=${attemptId}`);
check('replays are free once submitted', replayAfter.status === 200);

const secondAttempt = await call(`/api/assignments/${code}/start`, {
  method: 'POST', body: { username: 'testkid', password: 'kidpw' },
});
check('attempts limit enforced', secondAttempt.status === 403, secondAttempt.payload.error);

// ---------------------------------------------------------------- dashboard
const list = await call('/api/teacher/assignments/list', {
  method: 'POST', body: { password: PASSWORD },
});
check('assignment appears in the dashboard', list.payload.assignments?.[0]?.code === code);
check('dashboard shows the class', list.payload.assignments?.[0]?.className === '2ESO');

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
  method: 'POST', body: { username: 'testkid', password: 'kidpw' },
});
check('archived assignment refuses new starts', afterArchive.status === 403);

const del = await call('/api/teacher/assignments/delete', {
  method: 'POST', body: { password: PASSWORD, code },
});
check('assignment deleted', del.status === 200);
check('nothing left in storage', env.ASSIGN_BUCKET._objects.size === 0,
  `${env.ASSIGN_BUCKET._objects.size} objects remain`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
