// Assignments API for Dictation Time (and, later, Speech to IPA).
//
// Why a Worker rather than the Node server the app already has: this is the
// only piece students touch that must answer instantly. The Render server
// sleeps after ~15 minutes idle, and a class opening an assignment link at
// 8:55am cannot spend the first minute of the lesson watching a spinner.
// Workers have no cold start and R2 keeps the data, so login, audio and
// results are all immediate.
//
// The security model, in one paragraph: the teacher holds one password
// (SHA-256 hash in CREATE_PASSWORD_HASH, same scheme as pinplay so it can be
// literally the same password). Students authenticate against the shared
// Google Sheet roster that pinplay already uses, so they have nothing new to
// remember. After a successful start, the attemptId is the capability — the
// password is not re-checked on every keystroke, and anyone holding an
// attemptId can write to that attempt. That is a deliberate classroom-grade
// tradeoff, identical to pinplay's, and the reason nothing here is worth
// stealing: the worst an attacker can do with a leaked attemptId is spoil one
// student's dictation.
//
// The one thing this file guards seriously is the passage text. A student must
// not be able to read the sentences before typing them, so `sentences` is
// never included in any student-facing response until the attempt is
// submitted; students receive audio by index instead.
import { gradeDictation, DEFAULT_GRADING_OPTIONS } from '../src/lib/grading.js';
import { splitIntoSentences } from '../src/lib/sentences.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Teacher-Password',
  // The audio response reports the student's remaining replays in a header, so
  // the count on screen never needs a second round trip to stay honest.
  'Access-Control-Expose-Headers': 'X-Listens-Left',
};

// No I/O/0/1: these codes get read aloud and copied off a whiteboard.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_SENTENCES = 60;
const MAX_PASSAGE_CHARS = 20000;
const MAX_ANSWER_CHARS = 2000;

// ---------------------------------------------------------------- responses

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

// ------------------------------------------------------------------ helpers

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

function clamp(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function sanitizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function sanitizeAttemptId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
}

function sanitizeText(value, max) {
  return String(value ?? '').slice(0, max);
}

function sanitizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

// Email-derived, so renaming a student in the roster never orphans their past
// work — the same reasoning as pinplay's makeStudentKeyFromEmail. Doubles as a
// path segment: the character class deliberately excludes '/'.
function studentKeyFromEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const base = e.replace(/[^a-z0-9._@-]+/g, '');
  return base ? `usr_${base}`.slice(0, 96) : '';
}

function parseIndex(value, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= max) return -1;
  return n;
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

// --------------------------------------------------------------- teacher auth

async function verifyTeacher(env, password, request) {
  const hash = String(env.CREATE_PASSWORD_HASH || '').trim().toLowerCase();
  if (!hash) return false;

  const raw = String(password || '').trim().normalize('NFC');
  const ok = (await sha256Hex(raw)) === hash;

  // Only FAILED attempts cost rate-limit budget. Publishing an assignment
  // uploads one authenticated request per sentence, and those must not burn
  // through the same pool a brute-forcer would. Each failure costs 5 of the
  // 50/min/IP slots, so guessing tops out at 10 tries a minute.
  if (!ok && env.AUTH_RL) {
    const ip = request?.headers.get('CF-Connecting-IP') || 'unknown';
    try {
      await Promise.all([0, 1, 2, 3, 4].map(() => env.AUTH_RL.limit({ key: `auth:${ip}` })));
    } catch {
      // Fail open: the rate limiter being unavailable must not lock the
      // teacher out of their own dashboard.
    }
  }
  return ok;
}

function teacherPasswordFrom(request, body) {
  return request.headers.get('X-Teacher-Password') || body?.password || '';
}

// --------------------------------------------------------------- student auth

/**
 * Verifies a student against the shared Google Sheet roster — the same bridge
 * and the same secret pinplay uses, so one roster serves every app and
 * students keep the login they already know.
 *
 * Returns { email, studentKey, ok }.
 */
async function verifyStudent(env, username, password) {
  const name = String(username || '').trim();
  if (!name || !password) return { email: '', studentKey: '', ok: false };

  // Test account, so the flow can be exercised without a real roster entry.
  const overrideUser = String(env.STUDENT_LOGIN_OVERRIDE_USER || '').trim();
  const overridePass = String(env.STUDENT_LOGIN_OVERRIDE_PASS || '').trim();
  if (overrideUser && overridePass && name === overrideUser && password === overridePass) {
    const email = `${name.toLowerCase()}@override.local`;
    return { email, studentKey: studentKeyFromEmail(email), ok: true };
  }

  const url = String(env.STUDENT_ROSTER_LOOKUP_URL || '').trim();
  if (!url) return { email: '', studentKey: '', ok: false };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({
        usernames: [name],
        secret: String(env.STUDENT_ROSTER_LOOKUP_SECRET || ''),
        password,
      }),
    });
    const text = await res.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    if (!res.ok || !parsed?.ok) return { email: '', studentKey: '', ok: false };

    const result = (Array.isArray(parsed.results) ? parsed.results : [])[0] || {};
    const email = String(result.email || '').trim().toLowerCase();
    if (!email || result.passwordOk !== true) return { email: '', studentKey: '', ok: false };
    return { email, studentKey: studentKeyFromEmail(email), ok: true };
  } catch {
    return { email: '', studentKey: '', ok: false };
  }
}

// ------------------------------------------------------------------- storage
//
// R2 key layout. Two rules shape it, both about staying inside the Workers
// free plan's 50-subrequests-per-request budget:
//
//   records/<code>.json                     assignment; teacher is the only writer
//   assign/<code>/audio/<i>.mp3             one clip per sentence
//   assign/<code>/attempts/<studentKey>/<attemptId>.json
//
// 1. Attempts are filed under the student's key, so "how many attempts has
//    this student used?" is a single list() of keys rather than reading every
//    attempt in the class.
// 2. Everything a listing needs to display lives in R2 custom metadata, so one
//    list({include:['customMetadata']}) renders a whole dashboard page. No
//    denormalised counters anywhere, which means no shared mutable object and
//    therefore no lost-update races: every object here has exactly one writer.

const recordKey = (code) => `records/${code}.json`;
const audioKey = (code, index) => `assign/${code}/audio/${index}.mp3`;
const attemptPrefix = (code, studentKey) => `assign/${code}/attempts/${studentKey}/`;
const attemptKey = (code, studentKey, id) => `${attemptPrefix(code, studentKey)}${id}.json`;

async function getJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return await obj.json();
  } catch {
    return null;
  }
}

async function listAll(bucket, options) {
  const objects = [];
  let cursor;
  // Bounded so a runaway prefix can never blow the subrequest budget.
  for (let page = 0; page < 12; page += 1) {
    const result = await bucket.list({ ...options, cursor });
    objects.push(...result.objects);
    if (!result.truncated) break;
    cursor = result.cursor;
  }
  return objects;
}

function assignmentMetadata(record) {
  return {
    app: record.app,
    status: record.status,
    title: record.title,
    cls: record.className,
    due: String(record.dueAt || ''),
    created: String(record.createdAt),
    n: String(record.sentenceCount),
  };
}

async function saveAssignment(env, record) {
  record.updatedAt = Date.now();
  await env.ASSIGN_BUCKET.put(recordKey(record.code), JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: assignmentMetadata(record),
  });
}

function attemptMetadata(attempt) {
  return {
    name: attempt.studentName,
    score: String(attempt.scorePercent ?? ''),
    sub: attempt.submitted ? '1' : '0',
    warn: String(attempt.warnings || 0),
    plays: String(Object.values(attempt.listens || {}).reduce((a, b) => a + b, 0)),
    upd: String(attempt.updatedAt),
  };
}

async function saveAttempt(env, attempt) {
  attempt.updatedAt = Date.now();
  await env.ASSIGN_BUCKET.put(
    attemptKey(attempt.code, attempt.studentKey, attempt.id),
    JSON.stringify(attempt),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: attemptMetadata(attempt),
    }
  );
}

async function nextCode(env) {
  for (let tries = 0; tries < 40; tries += 1) {
    let code = '';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    // head() rather than get(): a collision check needs existence, not bytes.
    if (!(await env.ASSIGN_BUCKET.head(recordKey(code)))) return code;
  }
  throw new Error('Could not allocate an assignment code');
}

// ------------------------------------------------------------ teacher routes

async function createAssignment(env, body) {
  const passage = sanitizeText(body.text, MAX_PASSAGE_CHARS);
  // Split here, not in the browser: this list is what the audio is recorded
  // against and what the answers are graded against, so exactly one component
  // gets to decide where the sentences end.
  const sentences = splitIntoSentences(passage);
  if (sentences.length === 0) return fail('The passage is empty.');
  if (sentences.length > MAX_SENTENCES) {
    return fail(`That passage is ${sentences.length} sentences; the limit is ${MAX_SENTENCES}.`);
  }

  const now = Date.now();
  const dueAt = Number(body.dueAt || 0) > 0 ? Math.round(Number(body.dueAt)) : null;
  const record = {
    code: await nextCode(env),
    app: body.app === 'ipa' ? 'ipa' : 'dictation',
    status: 'draft',
    title: sanitizeName(body.title) || 'Dictation',
    className: sanitizeName(body.className),
    createdAt: now,
    updatedAt: now,
    dueAt,
    attemptsLimit: clamp(body.attemptsLimit ?? 1, 0, 10),
    maxListens: clamp(body.maxListens ?? 0, 0, 9),
    feedbackMode: body.feedbackMode === 'none' ? 'none' : 'end',
    settings: {
      lang: String(body.lang || 'en-US').slice(0, 12),
      rate: Math.min(1.5, Math.max(0.5, Number(body.rate) || 1)),
    },
    grading: {
      ignoreCase: !!body.grading?.ignoreCase,
      ignorePunctuation: !!body.grading?.ignorePunctuation,
      ignoreAccents: !!body.grading?.ignoreAccents,
    },
    source: body.source && typeof body.source === 'object' ? body.source : null,
    sentences,
    sentenceCount: sentences.length,
  };

  await saveAssignment(env, record);
  return json({ code: record.code, sentences, record: publicRecord(record) });
}

// The assignment minus its sentences. Everything that goes to a browser passes
// through here or through studentMeta, so there is one place to check when
// asking "can this response leak the passage?".
function publicRecord(record) {
  const { sentences: _sentences, ...rest } = record;
  return rest;
}

async function publishAssignment(env, code) {
  const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
  if (!record) return fail('Assignment not found.', 404);

  // Every sentence must have a clip before students can start: a missing one
  // would strand them on a sentence they can neither hear nor skip.
  const uploaded = await listAll(env.ASSIGN_BUCKET, { prefix: `assign/${code}/audio/` });
  const have = new Set(uploaded.map((o) => Number(o.key.split('/').pop().replace('.mp3', ''))));
  const missing = [];
  for (let i = 0; i < record.sentenceCount; i += 1) if (!have.has(i)) missing.push(i);
  if (missing.length) {
    return fail(`Audio is still missing for sentence${missing.length > 1 ? 's' : ''} ${missing.map((i) => i + 1).join(', ')}.`);
  }

  record.status = 'active';
  await saveAssignment(env, record);
  return json({ ok: true, code, record: publicRecord(record) });
}

async function listAssignments(env, body) {
  const app = body.app === 'ipa' ? 'ipa' : 'dictation';
  const objects = await listAll(env.ASSIGN_BUCKET, {
    prefix: 'records/',
    include: ['customMetadata'],
    limit: 100,
  });

  const assignments = objects
    .map((obj) => {
      const meta = obj.customMetadata || {};
      return {
        code: obj.key.slice('records/'.length).replace('.json', ''),
        app: meta.app || 'dictation',
        status: meta.status || 'draft',
        title: meta.title || '',
        className: meta.cls || '',
        dueAt: Number(meta.due) || null,
        createdAt: Number(meta.created) || 0,
        sentenceCount: Number(meta.n) || 0,
      };
    })
    .filter((a) => a.app === app)
    .sort((a, b) => b.createdAt - a.createdAt);

  return json({ assignments });
}

async function assignmentDetail(env, code) {
  const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
  if (!record) return fail('Assignment not found.', 404);

  // One list call carries every attempt's summary, because each attempt object
  // keeps its own headline numbers in custom metadata.
  const objects = await listAll(env.ASSIGN_BUCKET, {
    prefix: `assign/${code}/attempts/`,
    include: ['customMetadata'],
    limit: 100,
  });

  const attempts = objects
    .map((obj) => {
      const meta = obj.customMetadata || {};
      const parts = obj.key.split('/');
      return {
        id: parts.pop().replace('.json', ''),
        studentKey: parts.pop(),
        studentName: meta.name || '',
        scorePercent: meta.score === '' ? null : Number(meta.score),
        submitted: meta.sub === '1',
        warnings: Number(meta.warn) || 0,
        // Total times audio was played, not replays: the first playing of each
        // sentence is in here too, so a clean run of a 3-sentence dictation
        // reads 3, not 0.
        plays: Number(meta.plays) || 0,
        updatedAt: Number(meta.upd) || 0,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName) || a.updatedAt - b.updatedAt);

  return json({ record: publicRecord(record), sentences: record.sentences, attempts });
}

async function attemptDetail(env, code, studentKey, attemptId) {
  const attempt = await getJson(env.ASSIGN_BUCKET, attemptKey(code, studentKey, attemptId));
  if (!attempt) return fail('Attempt not found.', 404);
  const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
  if (!record) return fail('Assignment not found.', 404);

  // Regrade on read rather than trusting what was stored: an attempt abandoned
  // mid-way has no stored results at all, and the teacher still needs to see
  // how far it got.
  const results = attempt.results || gradeResults(record, attempt);
  return json({ attempt, results, sentences: record.sentences });
}

async function deleteAssignment(env, code) {
  const objects = await listAll(env.ASSIGN_BUCKET, { prefix: `assign/${code}/` });
  const keys = objects.map((o) => o.key);
  // R2 deletes up to 1000 keys per call; chunk so a long assignment with many
  // attempts can't silently leave objects behind.
  for (let i = 0; i < keys.length; i += 1000) {
    await env.ASSIGN_BUCKET.delete(keys.slice(i, i + 1000));
  }
  await env.ASSIGN_BUCKET.delete(recordKey(code));
  return json({ ok: true });
}

// ------------------------------------------------------------ student routes

function answersArray(attempt, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(attempt.answers?.[i] ?? '');
  return out;
}

function gradeResults(record, attempt) {
  return gradeDictation(
    record.sentences,
    answersArray(attempt, record.sentenceCount),
    { ...DEFAULT_GRADING_OPTIONS, ...record.grading }
  );
}

// The first sentence with no answer yet. The flow is strictly sequential, so
// this is where a resumed attempt picks up.
function nextIndex(attempt, count) {
  for (let i = 0; i < count; i += 1) {
    if (attempt.answers?.[i] === undefined) return i;
  }
  return count;
}

function studentMeta(record) {
  return {
    code: record.code,
    app: record.app,
    status: record.status,
    title: record.title,
    className: record.className,
    sentenceCount: record.sentenceCount,
    maxListens: record.maxListens,
    attemptsLimit: record.attemptsLimit,
    feedbackMode: record.feedbackMode,
    dueAt: record.dueAt,
    lang: record.settings.lang,
  };
}

async function startAttempt(env, code, body) {
  const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
  if (!record || record.status === 'draft') return fail('Assignment not found.', 404);
  if (record.status !== 'active') return fail('This assignment is closed.', 403);
  if (record.dueAt && Date.now() > record.dueAt) return fail('This assignment is past its due date.', 403);

  const { studentKey, ok } = await verifyStudent(env, body.username, body.password);
  if (!ok) return fail('That username and password did not match. Please check and try again.', 401);

  const existing = await listAll(env.ASSIGN_BUCKET, {
    prefix: attemptPrefix(code, studentKey),
    include: ['customMetadata'],
    limit: 100,
  });

  // An unfinished attempt always wins over starting a new one: a student whose
  // Chromebook died mid-dictation should carry on, not spend an attempt.
  const open = existing.find((o) => (o.customMetadata || {}).sub !== '1');
  if (open) {
    const attempt = await getJson(env.ASSIGN_BUCKET, open.key);
    if (attempt) {
      return json({
        attemptId: attempt.id,
        resumed: true,
        nextIndex: nextIndex(attempt, record.sentenceCount),
        answers: answersArray(attempt, record.sentenceCount),
        listens: attempt.listens || {},
        warnings: attempt.warnings || 0,
        meta: studentMeta(record),
      });
    }
  }

  if (record.attemptsLimit > 0 && existing.length >= record.attemptsLimit) {
    return fail(
      `You have used all ${record.attemptsLimit} attempt${record.attemptsLimit > 1 ? 's' : ''} for this assignment.`,
      403
    );
  }

  const now = Date.now();
  const attempt = {
    id: randomId('at_'),
    code,
    studentKey,
    studentName: sanitizeName(body.username),
    startedAt: now,
    updatedAt: now,
    submitted: false,
    submittedAt: null,
    answers: {},
    listens: {},
    warnings: 0,
    results: null,
    scorePercent: null,
  };
  await saveAttempt(env, attempt);

  return json({
    attemptId: attempt.id,
    resumed: false,
    nextIndex: 0,
    answers: answersArray(attempt, record.sentenceCount),
    listens: {},
    warnings: 0,
    meta: studentMeta(record),
  });
}

/**
 * Loads the attempt an attemptId refers to. The id alone is the capability, so
 * this also scans for it — which is why attempts are filed under the student
 * key: the scan is one list() over the assignment, keys only.
 */
async function loadAttemptById(env, code, attemptId) {
  const objects = await listAll(env.ASSIGN_BUCKET, { prefix: `assign/${code}/attempts/` });
  const hit = objects.find((o) => o.key.endsWith(`/${attemptId}.json`));
  if (!hit) return null;
  return getJson(env.ASSIGN_BUCKET, hit.key);
}

async function serveAudio(env, code, indexRaw, attemptId) {
  const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
  if (!record) return fail('Assignment not found.', 404);

  const index = parseIndex(indexRaw, record.sentenceCount);
  if (index < 0) return fail('No such sentence.', 404);

  const attempt = await loadAttemptById(env, code, attemptId);
  if (!attempt) return fail('Your session has expired. Please sign in again.', 401);

  // Replays are metered here rather than in the browser, because this request
  // *is* the replay — there is nothing for a student to skip past. Allowance is
  // maxListens + 1: the first playing of a sentence is not a replay.
  const submitted = !!attempt.submitted;
  const used = Number(attempt.listens?.[index] || 0);
  if (!submitted && record.maxListens > 0 && used >= record.maxListens + 1) {
    return fail('No replays left for this sentence.', 403);
  }

  const object = await env.ASSIGN_BUCKET.get(audioKey(code, index));
  if (!object) return fail('That sentence has no audio yet.', 404);

  // Reviewing answers after submitting is free; only the dictation itself is
  // metered, and by then the score is already fixed.
  let left = '';
  if (!submitted) {
    attempt.listens = { ...attempt.listens, [index]: used + 1 };
    await saveAttempt(env, attempt);
    left = record.maxListens > 0 ? String(Math.max(0, record.maxListens + 1 - (used + 1))) : '';
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      // Never cached: a cached clip would be a free replay, and the count on
      // the server would quietly stop matching what the student heard.
      'Cache-Control': 'no-store',
      'X-Listens-Left': left,
      ...CORS_HEADERS,
    },
  });
}

async function saveAnswer(env, code, body) {
  const attempt = await loadAttemptById(env, code, sanitizeAttemptId(body.attemptId));
  if (!attempt) return fail('Your session has expired. Please sign in again.', 401);
  if (attempt.submitted) return fail('This attempt has already been submitted.', 409);

  const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
  if (!record) return fail('Assignment not found.', 404);

  const index = parseIndex(body.index, record.sentenceCount);
  if (index < 0) return fail('No such sentence.', 404);

  attempt.answers = { ...attempt.answers, [index]: sanitizeText(body.text, MAX_ANSWER_CHARS) };
  await saveAttempt(env, attempt);
  return json({ ok: true });
}

async function recordWarning(env, code, body) {
  const attempt = await loadAttemptById(env, code, sanitizeAttemptId(body.attemptId));
  if (!attempt) return fail('Your session has expired. Please sign in again.', 401);
  if (attempt.submitted) return json({ ok: true });

  attempt.warnings = Number(attempt.warnings || 0) + 1;
  await saveAttempt(env, attempt);
  return json({ ok: true, warnings: attempt.warnings });
}

async function submitAttempt(env, code, body) {
  const attempt = await loadAttemptById(env, code, sanitizeAttemptId(body.attemptId));
  if (!attempt) return fail('Your session has expired. Please sign in again.', 401);

  const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
  if (!record) return fail('Assignment not found.', 404);

  if (!attempt.submitted) {
    // The client sends every answer again here, not just the last one. The
    // per-sentence saves are crash insurance; this is the authoritative copy,
    // so a dropped mid-session request can never cost a student marks.
    if (Array.isArray(body.answers)) {
      const answers = {};
      body.answers.slice(0, record.sentenceCount).forEach((text, i) => {
        if (typeof text === 'string') answers[i] = sanitizeText(text, MAX_ANSWER_CHARS);
      });
      attempt.answers = { ...attempt.answers, ...answers };
    }

    // Graded on the server so the score is the same number for the student and
    // the teacher, and so the grading options a student can toggle in free
    // practice can't be used to re-mark their own homework.
    const results = gradeResults(record, attempt);
    attempt.results = results;
    attempt.scorePercent = Math.round(results.accuracy * 100);
    attempt.submitted = true;
    attempt.submittedAt = Date.now();
    await saveAttempt(env, attempt);
  }

  if (record.feedbackMode === 'none') {
    return json({ ok: true, feedbackMode: 'none' });
  }
  return json({
    ok: true,
    feedbackMode: 'end',
    results: attempt.results,
    scorePercent: attempt.scorePercent,
    listens: attempt.listens || {},
    warnings: attempt.warnings || 0,
  });
}

async function attemptResults(env, code, attemptId) {
  const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
  if (!record) return fail('Assignment not found.', 404);
  if (record.feedbackMode === 'none') return fail('Feedback is not shown for this assignment.', 403);

  const attempt = await loadAttemptById(env, code, attemptId);
  if (!attempt) return fail('Your session has expired. Please sign in again.', 401);
  if (!attempt.submitted) return fail('This attempt has not been submitted yet.', 409);

  return json({
    results: attempt.results,
    scorePercent: attempt.scorePercent,
    listens: attempt.listens || {},
    warnings: attempt.warnings || 0,
  });
}

// -------------------------------------------------------------------- router

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (path === '/health' || path === '/') return json({ ok: true, service: 'dictation-assignments' });

  const segments = path.split('/').filter(Boolean); // e.g. api,assignments,ABC123,meta

  // ---- teacher ----
  if (segments[0] === 'api' && segments[1] === 'teacher') {
    // Audio upload sends raw MP3 bytes, so its password travels in a header;
    // everything else is JSON and carries it in the body.
    const body = method === 'PUT' ? {} : await readJsonBody(request);
    if (!(await verifyTeacher(env, teacherPasswordFrom(request, body), request))) {
      return fail('Wrong password.', 401);
    }

    if (path === '/api/teacher/verify') return json({ ok: true });
    if (path === '/api/teacher/assignments/create') return createAssignment(env, body);
    if (path === '/api/teacher/assignments/list') return listAssignments(env, body);

    if (path === '/api/teacher/assignments/get') {
      const code = sanitizeCode(body.code);
      return code ? assignmentDetail(env, code) : fail('Missing assignment code.');
    }

    if (path === '/api/teacher/attempts/get') {
      const code = sanitizeCode(body.code);
      const studentKey = String(body.studentKey || '').replace(/[^a-z0-9._@-]/gi, '').slice(0, 96);
      const attemptId = sanitizeAttemptId(body.attemptId);
      if (!code || !studentKey || !attemptId) return fail('Missing attempt details.');
      return attemptDetail(env, code, studentKey, attemptId);
    }

    if (path === '/api/teacher/assignments/status') {
      const code = sanitizeCode(body.code);
      const record = code ? await getJson(env.ASSIGN_BUCKET, recordKey(code)) : null;
      if (!record) return fail('Assignment not found.', 404);
      const wanted = String(body.status || '');
      if (!['active', 'archived'].includes(wanted)) return fail('Unknown status.');
      if (record.status === 'draft') return fail('Finish uploading the audio first.');
      record.status = wanted;
      await saveAssignment(env, record);
      return json({ ok: true, record: publicRecord(record) });
    }

    if (path === '/api/teacher/assignments/delete') {
      const code = sanitizeCode(body.code);
      return code ? deleteAssignment(env, code) : fail('Missing assignment code.');
    }

    // PUT /api/teacher/assignments/:code/audio/:index
    if (method === 'PUT' && segments[3] && segments[4] === 'audio') {
      const code = sanitizeCode(segments[3]);
      const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
      if (!record) return fail('Assignment not found.', 404);

      const index = parseIndex(segments[5], record.sentenceCount);
      if (index < 0) return fail('No such sentence.', 404);
      if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'audio/mpeg') {
        return fail('Audio must be sent as audio/mpeg.', 415);
      }

      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0) return fail('Empty audio upload.');
      if (bytes.byteLength > MAX_AUDIO_BYTES) return fail('That clip is too large.', 413);

      await env.ASSIGN_BUCKET.put(audioKey(code, index), bytes, {
        httpMetadata: { contentType: 'audio/mpeg' },
      });
      return json({ ok: true, index });
    }

    // POST /api/teacher/assignments/:code/publish
    if (segments[3] && segments[4] === 'publish') {
      const code = sanitizeCode(segments[3]);
      return code ? publishAssignment(env, code) : fail('Missing assignment code.');
    }

    return fail('Unknown endpoint.', 404);
  }

  // ---- student ----
  if (segments[0] === 'api' && segments[1] === 'assignments' && segments[2]) {
    const code = sanitizeCode(segments[2]);
    if (!code) return fail('Bad assignment code.', 404);
    const action = segments[3];

    if (method === 'GET' && action === 'meta') {
      const record = await getJson(env.ASSIGN_BUCKET, recordKey(code));
      // A draft is indistinguishable from a typo, on purpose: an unpublished
      // code should not confirm it exists.
      if (!record || record.status === 'draft') return fail('No assignment with that code.', 404);
      return json({ meta: studentMeta(record) });
    }

    if (method === 'POST' && action === 'start') {
      return startAttempt(env, code, await readJsonBody(request));
    }

    if (method === 'GET' && action === 'audio') {
      return serveAudio(env, code, segments[4], sanitizeAttemptId(url.searchParams.get('attemptId')));
    }

    if (method === 'GET' && action === 'results') {
      return attemptResults(env, code, sanitizeAttemptId(url.searchParams.get('attemptId')));
    }

    if (method === 'POST' && action === 'answer') return saveAnswer(env, code, await readJsonBody(request));
    if (method === 'POST' && action === 'warning') return recordWarning(env, code, await readJsonBody(request));
    if (method === 'POST' && action === 'submit') return submitAttempt(env, code, await readJsonBody(request));

    return fail('Unknown endpoint.', 404);
  }

  return fail('Unknown endpoint.', 404);
}

export default {
  async fetch(request, env) {
    try {
      if (!env.ASSIGN_BUCKET) return fail('Storage is not configured.', 500);
      return await route(request, env);
    } catch (error) {
      console.error('Worker error:', error?.stack || error);
      return fail('Something went wrong. Please try again.', 500);
    }
  },
};
