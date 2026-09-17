import { workerApi, workerBase } from './api.js';

// Same session shape as PinPlay. Each app origin stores its own copy, and each
// assignment server gets a separate entry so local/staging logins cannot mix.
const memory = new Map();
const storageKey = () => `dictation.student.v1:${encodeURIComponent(workerBase())}`;

function validSession(value) {
  return value && typeof value.studentToken === 'string' && value.studentToken.length > 0
    && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now()
    && typeof value.student?.email === 'string' && value.student.email.includes('@');
}

export function readStudentSession() {
  const key = storageKey();
  let session;
  try {
    session = memory.get(key) || JSON.parse(localStorage.getItem(key));
  } catch {
    session = memory.get(key);
  }
  if (validSession(session)) return session;
  memory.delete(key);
  try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  return null;
}

export function saveStudentSession(data) {
  const session = {
    studentToken: data.studentToken,
    expiresAt: Number(data.expiresAt),
    student: data.student,
  };
  if (!validSession(session)) throw new Error('School sign-in returned an invalid session. Please try again.');
  const key = storageKey();
  try {
    localStorage.setItem(key, JSON.stringify(session));
    memory.delete(key);
  } catch {
    // A full quota can reject writes while still allowing reads.
    memory.set(key, session);
  }
  return session;
}

export function clearStudentSession() {
  const key = storageKey();
  memory.delete(key);
  try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  try { globalThis.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* Session is already cleared. */ }
}

export const getStudentConfig = () => workerApi('/api/student/config');

export async function signInWithGoogle(googleIdToken) {
  const data = await workerApi('/api/student/login', {
    method: 'POST', body: { googleIdToken },
  });
  return saveStudentSession(data);
}

let scriptPromise;
export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.id) return Promise.resolve(globalThis.google.accounts.id);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Google sign-in could not load. Check your connection and try again.'));
    };
    const timer = setTimeout(fail, 12000);
    script.onerror = fail;
    script.onload = () => {
      if (!globalThis.google?.accounts?.id) return fail();
      clearTimeout(timer);
      resolve(globalThis.google.accounts.id);
    };
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}
