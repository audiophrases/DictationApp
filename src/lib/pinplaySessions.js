// Reuse PinPlay's live recording-session service and its volunteer recorder.
// Teacher credentials are explicitly supplied for PinPlay, never copied from
// Dictation's login or persisted in browser storage.
import { splitIntoSentences } from './sentences.js';

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

export function sessionFields(plan, speakers, title) {
  if (!plan.length || plan.length > 300 || plan.some((p) => compact(p.sentence).length > 600)) {
    throw new Error('Recording sessions support up to 300 sentences, each at most 600 characters. Shorten the passage first.');
  }
  return { title: title || 'Dictation recording', allowEdits: false, lines: plan.map((part, i) => ({
    text: compact(part.sentence), speaker: compact(speakers[i]) || 'Narrator',
    direction: 'Read the complete sentence naturally. Do not say punctuation names.',
  })) };
}

export function validateSession(session, plan, requireApproved = false) {
  if (!Array.isArray(session?.lines) || session.lines.length !== plan.length
    || session.lines.some((line, i) => compact(line.text) !== compact(plan[i].sentence))) {
    throw new Error('This session does not match the dictation sentence by sentence. Use the original passage or create a matching session.');
  }
  if (requireApproved && session.lines.some((line) => line.status !== 'ok' || !line.take?.key)) {
    throw new Error('Listen to and approve every sentence before opening the splitting studio.');
  }
}

export function sessionPassage(session) {
  if (!Array.isArray(session?.lines) || !session.lines.length || session.lines.some((line) =>
    splitIntoSentences(line.text).length !== 1)) {
    throw new Error('Use a session with one complete sentence per line for dictation.');
  }
  return session.lines.map((line) => compact(line.text)).join('\n');
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
