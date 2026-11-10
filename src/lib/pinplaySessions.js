// Reuse PinPlay's live recording-session service and its volunteer recorder.
// Teacher credentials are explicitly supplied for PinPlay, never copied from
// Dictation's login or persisted in browser storage.
import { splitIntoSentences } from './sentences.js';
import { annotateSentence, endsParagraph, hasSpokenPunctuation, paragraphEnds, stripSpokenPunctuation } from './spokenPunctuation.js';

export const PINPLAY_API = 'https://api.pinplay.win';
const RECORD_PAGE = 'https://audiophrases.github.io/pinplay/record/';
const compact = (text) => String(text || '').trim().replace(/\s+/gu, ' ');

export function actorLink(id, speaker = '') {
  const query = new URLSearchParams({ s: id });
  if (speaker) query.set('c', speaker);
  return `${RECORD_PAGE}?${query}`;
}

export async function sessionRequest(route, password, fields = {}, signal) {
  if (!['create', 'list', 'get', 'save'].includes(route)) throw new Error('Unknown recording-session action.');
  if (!password) throw new Error('Enter your PinPlay teacher password.');
  const response = await fetch(`${PINPLAY_API}/api/rec/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fields, password }), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'PinPlay could not complete this request.');
  return data;
}

// What each actor reads: the sentence with the punctuation to say aloud in
// [brackets] (spokenPunctuation.js), a new paragraph where the passage has a
// line break. The brackets are the whole instruction: no direction.
export function sessionScript(plan, { lang = 'en-US', passage = '' } = {}) {
  const paragraphs = paragraphEnds(passage, plan.map((part) => part.sentence));
  return plan.map((part, i) => annotateSentence(part.sentence, lang, { paragraph: paragraphs[i] }));
}

export function sessionFields(plan, speakers, title, options = {}) {
  const script = plan.length ? sessionScript(plan, options) : [];
  if (!plan.length || plan.length > 300 || script.some((line) => line.length > 600)) {
    throw new Error('Recording sessions support up to 300 sentences, each at most 600 characters with its punctuation notes. Shorten the passage first.');
  }
  return { title: title || 'Dictation recording', allowEdits: false, lines: script.map((text, i) => ({
    text, speaker: compact(speakers[i]) || 'Narrator', direction: '',
  })) };
}

// A line's sentence, without the punctuation notes (sessions made before the
// notes existed have none).
const lineSentence = (line) => stripSpokenPunctuation(line.text);
export const sessionSaysPunctuation = (session) => (session?.lines || []).some((line) => hasSpokenPunctuation(line.text));

export function validateSession(session, plan, requireTakes = false) {
  if (!Array.isArray(session?.lines) || session.lines.length !== plan.length
    || session.lines.some((line, i) => lineSentence(line) !== compact(plan[i].sentence))) {
    throw new Error('This session does not match the dictation sentence by sentence. Use the original passage or create a matching session.');
  }
  // No approval needed: the teacher hears every take in the splitting studio.
  // Only a redo the teacher asked for holds a sentence back.
  if (requireTakes && session.lines.some((line) => !line.take?.key || line.status === 'redo')) {
    throw new Error('Every sentence needs a take, with no redo pending, before the splitting studio opens.');
  }
}

/**
 * Where a session stands on its way to the splitting studio, as sentence
 * numbers: recorded (approved or not), and still waiting for an actor —
 * never recorded, or a redo was requested.
 */
export function sessionProgress(session) {
  const lines = session?.lines || [];
  const numbers = (test) => lines.flatMap((line, i) => (test(line) ? [i + 1] : []));
  const recorded = numbers((line) => line.take?.key && line.status !== 'redo');
  const redo = numbers((line) => line.take?.key && line.status === 'redo');
  const missing = numbers((line) => !line.take?.key);
  return { total: lines.length, recorded, redo, missing, ready: lines.length > 0 && !redo.length && !missing.length };
}

// The takes a splitting studio was made from: when they change, so must it.
export const sessionTakesKey = (session) => JSON.stringify((session?.lines || [])
  .map((line) => [line.id, line.take?.key || '', line.status, line.trim || null]));

export function sessionPassage(session) {
  if (!Array.isArray(session?.lines) || !session.lines.length || session.lines.some((line) =>
    splitIntoSentences(lineSentence(line)).length !== 1)) {
    throw new Error('Use a session with one complete sentence per line for dictation.');
  }
  const sentences = session.lines.map(lineSentence);
  // Notes say where paragraphs end: keep each paragraph on one line, as long
  // as the passage still splits into exactly these sentences.
  if (sessionSaysPunctuation(session)) {
    const lines = [];
    let current = [];
    session.lines.forEach((line, i) => {
      current.push(sentences[i]);
      if (endsParagraph(line.text)) { lines.push(current.join(' ')); current = []; }
    });
    if (current.length) lines.push(current.join(' '));
    const passage = lines.join('\n');
    const again = splitIntoSentences(passage);
    if (again.length === sentences.length && again.every((s, i) => compact(s) === sentences[i])) return passage;
  }
  return sentences.join('\n');
}

export function takeUrl(sessionId, key) {
  if (!/^[a-z0-9]{8,16}$/u.test(sessionId) || typeof key !== 'string'
    || !key.startsWith(`voice-actors/${sessionId}/`) || !/^[a-zA-Z0-9/_.-]+$/u.test(key)
    || key.includes('..')) throw new Error('Invalid PinPlay take.');
  return `${PINPLAY_API}/api/media/${key}`;
}

// Ported from PinPlay voice-trim.js (vaAutoTrim): 20 ms RMS windows,
// noise-floor threshold, 120 ms lead and 200 ms tail. The source take is intact.
export function autoTrim(buffer) {
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const rms = [];
  for (let i = 0; i < data.length; i += win) {
    let sum = 0;
    const end = Math.min(data.length, i + win);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    rms.push(Math.sqrt(sum / (end - i)));
  }
  const total = Math.round(buffer.duration * 1000);
  if (!rms.length) return { s: 0, e: total };
  const sorted = rms.slice().sort((a, b) => a - b);
  const threshold = Math.max(sorted[Math.floor(sorted.length * 0.1)] * 3, sorted.at(-1) * 0.1, 0.003);
  const first = rms.findIndex((v) => v > threshold);
  let last = -1;
  for (let i = rms.length - 1; i >= 0; i--) if (rms[i] > threshold) { last = i; break; }
  return first < 0 ? { s: 0, e: total } : { s: Math.max(0, first * 20 - 120), e: Math.min(total, (last + 1) * 20 + 200) };
}

export function trimTake(buffer, trim, context) {
  const range = trim || autoTrim(buffer);
  if (!Number.isFinite(range.s) || !Number.isFinite(range.e) || range.s < 0 || range.e <= range.s
    || range.e > buffer.duration * 1000 + 1) throw new Error('Trim must start before the end and stay within the take.');
  const start = Math.round(range.s / 1000 * buffer.sampleRate);
  const end = Math.min(buffer.length, Math.round(range.e / 1000 * buffer.sampleRate));
  if (end - start < buffer.sampleRate * 0.2) throw new Error('Keep at least 0.2 seconds of the take.');
  const result = context.createBuffer(1, end - start, buffer.sampleRate);
  const samples = result.getChannelData(0);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) samples[i] += source[start + i] / buffer.numberOfChannels;
  }
  if (!samples.some((sample) => Math.abs(sample) > 0.001)) throw new Error('No audible speech in this take. Ask the actor to record again.');
  return result;
}

export async function loadTake(sessionId, line, context, signal) {
  const response = await fetch(takeUrl(sessionId, line.take?.key), { signal });
  if (!response.ok) throw new Error('Could not download this take. Refresh the session and try again.');
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024) throw new Error('Empty or oversized recording.');
  return context.decodeAudioData(bytes);
}
