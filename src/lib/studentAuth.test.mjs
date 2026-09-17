import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readStudentSession, saveStudentSession, clearStudentSession } from './studentAuth.js';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalGoogle = globalThis.google;
const entries = new Map();
let backend = 'https://assignment-a.test';
let writeDenied = false;
let disabledAutoSelect = 0;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key) { return key === 'dictation.workerBase' ? backend : entries.get(key) ?? null; },
  setItem(key, value) { if (writeDenied) throw new Error('Quota exceeded'); entries.set(key, value); },
  removeItem(key) { entries.delete(key); },
} });
globalThis.google = { accounts: { id: { disableAutoSelect() { disabledAutoSelect += 1; } } } };
after(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete globalThis.localStorage;
  if (originalGoogle === undefined) delete globalThis.google;
  else globalThis.google = originalGoogle;
});

const session = () => ({ studentToken: 'signed-session', expiresAt: Date.now() + 60000,
  student: { email: 'student@school.cat', displayName: 'Student', className: '4B' } });

test('sessions are isolated by assignment server and switching back restores the right one', () => {
  saveStudentSession(session());
  backend = 'https://assignment-b.test';
  assert.equal(readStudentSession(), null);
  saveStudentSession({ ...session(), studentToken: 'second-server' });
  backend = 'https://assignment-a.test';
  assert.equal(readStudentSession().studentToken, 'signed-session');
});

test('expiry is checked on every read, including a session already read in this tab', () => {
  saveStudentSession(session());
  assert.ok(readStudentSession());
  const key = [...entries.keys()].find((item) => item.includes(encodeURIComponent(backend)));
  entries.set(key, JSON.stringify({ ...session(), expiresAt: Date.now() - 1 }));
  assert.equal(readStudentSession(), null);
});

test('removal in another tab is respected', () => {
  saveStudentSession(session());
  assert.ok(readStudentSession());
  entries.clear();
  assert.equal(readStudentSession(), null);
});

test('sign-in still works when storage is full but readable, and sign-out clears it', () => {
  writeDenied = true;
  saveStudentSession(session());
  assert.equal(readStudentSession().student.email, 'student@school.cat');
  clearStudentSession();
  assert.equal(readStudentSession(), null);
  assert.equal(disabledAutoSelect, 1);
  writeDenied = false;
});

test('malformed or expired login responses cannot become sessions', () => {
  assert.throws(() => saveStudentSession({ studentToken: 'bad', expiresAt: Date.now() + 60000 }));
  assert.throws(() => saveStudentSession({ ...session(), expiresAt: Date.now() - 1 }));
  assert.equal(readStudentSession(), null);
});
