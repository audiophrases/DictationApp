// Every call the app makes to the assignments worker, in one place, so the
// endpoint shapes live next to each other and match cloudflare/worker.js.
import { ApiError, workerApi, workerBase, workerUrl } from './api';
import { getTeacherPassword } from './teacherAuth';

// ------------------------------------------------------------------- teacher

function teacherPost(path, body = {}) {
  return workerApi(path, { method: 'POST', body: { ...body, password: getTeacherPassword() } });
}

export function verifyTeacherPassword(password) {
  return workerApi('/api/teacher/verify', { method: 'POST', body: { password } });
}

export function createAssignment(fields) {
  return teacherPost('/api/teacher/assignments/create', fields);
}

export function publishAssignment(code) {
  return teacherPost(`/api/teacher/assignments/${code}/publish`);
}

export function listAssignments(app = 'dictation') {
  return teacherPost('/api/teacher/assignments/list', { app });
}

export function getAssignment(code) {
  return teacherPost('/api/teacher/assignments/get', { code });
}

export function getAttempt(code, studentKey, attemptId) {
  return teacherPost('/api/teacher/attempts/get', { code, studentKey, attemptId });
}

// Undoes a hand-in so the student carries on in the same attempt.
export function reopenAttempt(code, studentKey, attemptId) {
  return teacherPost('/api/teacher/attempts/reopen', { code, studentKey, attemptId });
}

// One more attempt for one student, on top of the assignment's limit.
export function grantExtraAttempt(code, studentKey) {
  return teacherPost('/api/teacher/attempts/extra', { code, studentKey });
}

export function deleteAttempt(code, studentKey, attemptId) {
  return teacherPost('/api/teacher/attempts/delete', { code, studentKey, attemptId });
}

// Only the fields passed are changed.
export function updateAssignmentSettings(code, fields) {
  return teacherPost('/api/teacher/assignments/update-settings', { code, ...fields });
}

// New text: deletes every attempt and recording, and returns the assignment to
// draft with its new sentences, ready to be recorded and published again.
export function updateAssignmentContent(code, fields) {
  return teacherPost('/api/teacher/assignments/update-content', { code, ...fields });
}

// One stored recording, for the teacher to listen to.
export async function fetchTeacherAudio(code, index) {
  let res;
  try {
    res = await fetch(workerUrl('/api/teacher/assignments/audio'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, index, password: getTeacherPassword() }),
    });
  } catch {
    throw new ApiError("Couldn't reach the assignment server.", { network: true });
  }
  if (!res.ok) throw new ApiError(`Couldn't load that recording (${res.status}).`, { status: res.status });
  return res.blob();
}

export function setAssignmentStatus(code, status) {
  return teacherPost('/api/teacher/assignments/status', { code, status });
}

export function releaseCorrections(code) {
  return teacherPost('/api/teacher/assignments/release-corrections', { code });
}

export function deleteAssignment(code) {
  return teacherPost('/api/teacher/assignments/delete', { code });
}

/**
 * Uploads one sentence's MP3. Raw bytes rather than JSON, so the password goes
 * in a header instead of a body — hence its own fetch rather than workerApi.
 */
export async function uploadSentenceAudio(code, index, blob) {
  if (!workerBase()) throw new ApiError('Assignments are not set up.', { config: true });
  let res;
  try {
    res = await fetch(workerUrl(`/api/teacher/assignments/${code}/audio/${index}`), {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'audio/mpeg', 'X-Teacher-Password': getTeacherPassword() },
      body: blob,
    });
  } catch {
    throw new ApiError("Couldn't reach the assignment server.", { network: true });
  }
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {
      // Non-JSON error body; the status is all we have.
    }
    throw new ApiError(message, { status: res.status });
  }
  return res.json();
}

// ------------------------------------------------------------------- student

export function getAssignmentMeta(code) {
  return workerApi(`/api/assignments/${code}/meta`);
}

// `fresh` asks for a new attempt instead of returning to the last one handed in.
export function startAttempt(code, studentToken, { fresh = false } = {}) {
  return workerApi(`/api/assignments/${code}/start`, {
    method: 'POST',
    body: { studentToken, ...(fresh ? { fresh: true } : {}) },
  });
}

// One practice answer after handing in, marked but stored nowhere.
export function markPractice(code, attemptId, index, text) {
  return workerApi(`/api/assignments/${code}/practice`, {
    method: 'POST',
    body: { attemptId, index, text },
  });
}

export function sentenceAudioUrl(code, index, attemptId) {
  return workerUrl(
    `/api/assignments/${code}/audio/${index}?attemptId=${encodeURIComponent(attemptId)}`
  );
}

export function cachedAudioUrl(code, index, attemptId) {
  return workerUrl(
    `/api/assignments/${code}/audio-cache/${index}?attemptId=${encodeURIComponent(attemptId)}`
  );
}

export function authorizeCachedAudio(code, index, attemptId, version) {
  return workerApi(`/api/assignments/${code}/audio-play/${index}`, {
    method: 'POST', body: { attemptId, version },
  });
}

export function saveAnswer(code, attemptId, index, text) {
  return workerApi(`/api/assignments/${code}/answer`, {
    method: 'POST',
    body: { attemptId, index, text },
  });
}

export function reportWarning(code, attemptId) {
  return workerApi(`/api/assignments/${code}/warning`, {
    method: 'POST',
    body: { attemptId },
  });
}

export function submitAttempt(code, attemptId, answers) {
  return workerApi(`/api/assignments/${code}/submit`, {
    method: 'POST',
    body: { attemptId, answers },
    timeoutMs: 25000,
  });
}

export function fetchAttemptResults(code, attemptId) {
  return workerApi(
    `/api/assignments/${code}/results?attemptId=${encodeURIComponent(attemptId)}`
  );
}

// -------------------------------------------------------- resume bookkeeping
//
// The attemptId is the student's capability for the attempt, so keeping it lets
// a Chromebook that died mid-dictation carry on. Scoped per assignment code and
// cleared on submit.

const attemptStorageKey = (code) => `dictation.attempt.${code}`;

export function rememberAttempt(code, attemptId, email) {
  try {
    localStorage.setItem(attemptStorageKey(code), JSON.stringify({ attemptId, email }));
  } catch {
    // Private mode or a full quota: resuming is a convenience, not a promise.
  }
}

export function recallAttempt(code) {
  try {
    const saved = JSON.parse(localStorage.getItem(attemptStorageKey(code)));
    return saved && saved.attemptId ? saved : null;
  } catch {
    return null;
  }
}

export function forgetAttempt(code) {
  try {
    localStorage.removeItem(attemptStorageKey(code));
  } catch {
    // Nothing to do; the entry is scoped to this assignment either way.
  }
}
