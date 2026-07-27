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

export function setAssignmentStatus(code, status) {
  return teacherPost('/api/teacher/assignments/status', { code, status });
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
      headers: { 'Content-Type': 'audio/mpeg', 'X-Teacher-Password': getTeacherPassword() },
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

export function startAttempt(code, username, password) {
  return workerApi(`/api/assignments/${code}/start`, {
    method: 'POST',
    body: { username, password },
    // A roster lookup goes out to Apps Script, which is not always brisk.
    timeoutMs: 25000,
  });
}

export function sentenceAudioUrl(code, index, attemptId) {
  return workerUrl(
    `/api/assignments/${code}/audio/${index}?attemptId=${encodeURIComponent(attemptId)}`
  );
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

export function rememberAttempt(code, attemptId, username) {
  try {
    localStorage.setItem(attemptStorageKey(code), JSON.stringify({ attemptId, username }));
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
