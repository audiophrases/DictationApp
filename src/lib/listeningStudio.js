// Dictation sentences voiced by PinPlay's Listening Studio (Qwen3 voices,
// made on the teacher's own PC). The page talks to the studio through the
// local server's bridge (server/listeningStudio.js), so this only works in a
// local copy: start_studio.bat, start_local.bat or `npm run dev`.
//
// One studio recording per dictation: one "Narrator" voice, one line per
// sentence, plus one line per punctuation cue in notebook mode, so the cue is
// in the same voice. The studio caches every line by voice and text, so
// changing the voice or retrying a sentence only remakes what changed.
import { sentenceEndCue } from './notebookShared.js';

export const NARRATOR = 'Narrator';
const BASE = '/api/listening-studio/';

// The languages Qwen3 speaks, by the app's language code.
const LANGUAGES = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian' };
export const STUDIO_LANGUAGE_NAMES = Object.values(LANGUAGES);
export function studioLanguage(lang) {
  return LANGUAGES[String(lang || '').split('-')[0]] || '';
}

// The app's dialects, said in the voice description (the description
// decides the accent).
const ACCENTS = {
  'en-US': 'a General American accent',
  'es-ES': 'a Castilian Spanish accent from Spain',
  'fr-FR': 'a standard French accent from France',
  'de-DE': 'a standard German accent from Germany',
  'it-IT': 'a standard Italian accent from Italy',
  'pt-PT': 'a European Portuguese accent from Portugal',
  'ru-RU': 'a standard Russian accent',
};
export function defaultDescription(lang) {
  return `An adult woman in her thirties with a clear, warm, mid-range voice and ${ACCENTS[lang] || 'a standard accent'}, reading slowly and clearly.`;
}
export const DEFAULT_DIRECTION = 'reading a dictation aloud: slow, clear and steady, with a short pause at each comma';

const oneLine = (text) => String(text || '').replace(/\s+/gu, ' ').trim();
// A direction sits inside "Name (direction): text": no brackets or colons.
const cleanDirection = (text) => oneLine(text).replace(/[():]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 200);

// Distinct punctuation cues the sentences need, spoken as their own lines.
// `ends`: whether students hear the sentence-end punctuation (punctuationPolicy.js);
// the old mode name is still accepted.
export function cueLines(plan, lang, ends) {
  if (ends !== true && ends !== 'notebook') return [];
  return [...new Set(plan.map((part) => sentenceEndCue(part.sentence, lang)).filter(Boolean))].map((label) => `${label}.`);
}

// The parsed script (listening-script.js's shape) and its text, which is
// what the studio's own page shows if the teacher opens it there.
export function dictationScript({ plan, lang, title, description, direction = '', cues = [] }) {
  const language = studioLanguage(lang);
  if (!language) throw new Error('Listening Studio voices do not speak this language.');
  const voice = oneLine(description);
  if (!voice) throw new Error('Describe the voice first.');
  const how = cleanDirection(direction);
  const name = oneLine(title).slice(0, 120) || 'Dictation';
  const lines = [...plan.map((part) => oneLine(part.sentence)), ...cues];
  const script = {
    title: name, language, ambience: 'none',
    voices: { [NARRATOR]: { description: voice, effect: '' } },
    parts: [{ label: '', items: lines.map((text) => ({ type: 'line', speakers: [NARRATOR], direction: how, effect: '', text, overlap: false })) }],
    notes: [],
  };
  const text = [`TITLE: ${name}`, `LANGUAGE: ${language}`, 'AMBIENCE: none', `VOICE ${NARRATOR}: ${voice}`, '',
    ...lines.map((line) => `${NARRATOR}${how ? ` (${how})` : ''}: ${line}`)].join('\n');
  return { script, text };
}

// The studio's settings (engine/project.py DEFAULTS), keeping anything the
// recording already has that this page doesn't manage.
export function studioSettings(base, { mode, libraryVoice, check }) {
  return {
    ...base,
    mode: libraryVoice ? 'fixed' : mode === 'acted' ? 'acted' : 'fixed',
    modes: {},
    descriptions: {},
    ownVoices: libraryVoice ? { [NARRATOR]: libraryVoice } : {},
    sampleTakes: base?.sampleTakes || {},
    lineTakes: base?.lineTakes || {},
    batch: true, spacing: 'natural', ambience: 'none', check: check !== false,
  };
}

// The voice form, read back from a recording made earlier.
export function formFromRecording(rec, lang) {
  const settings = rec?.settings || {};
  const items = rec?.script?.parts?.[0]?.items || [];
  const libraryVoice = settings.ownVoices?.[NARRATOR] || '';
  return {
    source: libraryVoice ? 'library' : 'design',
    description: rec?.script?.voices?.[NARRATOR]?.description || defaultDescription(lang),
    libraryVoice,
    mode: settings.mode === 'acted' ? 'acted' : 'fixed',
    direction: items[0]?.direction || DEFAULT_DIRECTION,
    check: settings.check !== false,
  };
}

export const lineId = (index) => `0:${index}:${NARRATOR}`;
const fileName = (path) => String(path || '').split(/[\\/]/u).pop();

// The finished lines in order, checked against what the dictation needs.
// Throws when the recording was changed into something else in the studio.
export function finishedLines(data, expected) {
  const lines = (data?.result?.lines || []).filter((line) => line.part === 0 && line.speaker === NARRATOR)
    .sort((a, b) => a.item - b.item);
  if (lines.length !== expected.length || lines.some((line, i) => oneLine(line.text) !== oneLine(expected[i]))) {
    throw new Error('This Listening Studio recording no longer matches the dictation. Start a new one.');
  }
  return lines.map((line) => ({ id: line.id, text: line.text, take: Number(line.take) || 0, file: fileName(line.file),
    level: line.level, heard: line.heard || '', diffs: line.diffs || [] }));
}

// The current lines (from the script) still say the dictation's sentences.
export function matchesDictation(data, expected) {
  const lines = (data?.lines || []).filter((line) => line.part === 0 && line.speaker === NARRATOR);
  return lines.length === expected.length && lines.every((line, i) => oneLine(line.text) === oneLine(expected[i]));
}

export function progressText(job, now = Date.now() / 1000) {
  const { done = 0, total = 0 } = job || {};
  if (job?.stage === 'lines') {
    const started = job.stages?.lines;
    const min = started && done ? Math.round((((job.at || now) - started) / done) * (total - done) / 60) : 0;
    return `Making sentences ${done}/${total}${min >= 1 ? ` · about ${min} min left` : ''}`;
  }
  if (job?.stage === 'voices') return 'Making the voice sample…';
  if (job?.stage === 'checks') return `Checking the words ${done}/${total}`;
  if (job?.stage === 'retry') return `Making ${total} sentence${total === 1 ? '' : 's'} again (words differed)`;
  if (job?.stage === 'mix') return 'Finishing…';
  return 'Starting the voice engine…';
}

// Where a recording stands, from GET recordings/<id> and GET status.
export function describeRecording(id, data, status) {
  const rec = data?.recording || {};
  const job = status?.job?.id === id ? status.job : null;
  const queued = (status?.queue || []).some(([rid]) => rid === id);
  const other = status?.job && status.job.id !== id;
  const last = status?.last?.id === id ? status.last : null;
  const voice = data?.voices?.[NARRATOR] || {};
  const report = data?.voiceReport?.[NARRATOR] || {};
  const base = { job, voice, warning: report.warning || '', pitch: report.pitch || null, stage: rec.stage };
  if (job) return { ...base, phase: 'working', busy: true, text: progressText(job, status.now) };
  if (queued) return { ...base, phase: 'waiting', busy: true,
    text: other ? 'Waiting for Listening Studio to finish another recording…' : 'Starting…' };
  if (last && last.stopped) return { ...base, phase: 'stopped', text: 'Stopped. Everything already made is kept.' };
  if (last && !last.ok) return { ...base, phase: 'failed', text: last.error || 'Listening Studio could not finish.' };
  if (rec.stage === 'voices') {
    return voice.sample || voice.own
      ? { ...base, phase: 'voice', text: 'Listen to the voice sample. Use it, or change the voice and make another.' }
      : { ...base, phase: 'idle', text: 'The voice sample is not made yet.' };
  }
  if (rec.stage === 'approved') {
    if (data?.result?.lines?.length && !data.stale) return { ...base, phase: 'ready', text: 'Every sentence is ready.' };
    if (data?.result?.lines?.length) return { ...base, phase: 'stale', text: 'Changed since the sentences were made.' };
    return { ...base, phase: 'idle', text: 'The sentences are not made yet.' };
  }
  return { ...base, phase: 'idle', text: 'Not made yet.' };
}

// ---------------------------------------------------------------- 🌍 find a voice
// Real voices from open recordings (the studio's catalog/voices.json, the
// same list as its own "Find a voice"). Adding one copies its sample into
// the studio's voice library, with its credit, where any dictation can use it.
export const READER_SOURCES = ['librittsr', 'cmltts', 'mls'];
const PITCH_GROUP = { 'very low': 'low', low: 'low', 'slightly low': 'low', moderate: 'moderate', 'slightly high': 'high', high: 'high', 'very high': 'high' };
const PACE_GROUP = { 'very slow': 'slow', slow: 'slow', 'slightly slow': 'slow', moderate: 'moderate', 'slightly fast': 'fast', fast: 'fast', 'very fast': 'fast' };
const ACCENT_NAMES = { English: 'English (England)', 'New zealand': 'New Zealand', Unidentified: 'Not labelled' };
export const accentName = (accent) => ACCENT_NAMES[accent] || accent;
const isReader = (v) => READER_SOURCES.includes(v.source);

// Where the finder opens for this dictation: native readers when the catalog
// has them in its language (English, French), else speakers whose first
// language it is (they read an English paragraph).
export function finderStart(catalog, lang) {
  const language = studioLanguage(lang) || 'English';
  const readers = (catalog?.voices || []).filter((v) => isReader(v) && v.language === language);
  const accent = language === 'English' && readers.some((v) => v.accent === 'American') ? 'American' : '';
  return {
    tab: readers.length ? 'readers' : 'accents',
    f: { readerLanguage: readers.length ? language : 'English', accent, gender: '', pitch: '', manner: 'calm', pace: '',
      language, age: '' },
  };
}

// [value, count] pairs, the most common first.
export function counted(voices, field) {
  const counts = {};
  voices.forEach((v) => { if (v[field]) counts[v[field]] = (counts[v[field]] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function finderVoices(catalog, tab) {
  return (catalog?.voices || []).filter((v) => (tab === 'readers' ? isReader(v) : v.source === 'accentarchive'));
}

export function finderMatches(catalog, tab, f) {
  const sel = (value, wanted) => !wanted || value === wanted;
  if (tab === 'readers') {
    const rank = { calm: 0, mixed: 1, lively: 2 };
    return finderVoices(catalog, tab).filter((v) => v.language === f.readerLanguage && sel(v.accent, f.accent)
        && sel(v.gender, f.gender) && sel(PITCH_GROUP[v.pitch], f.pitch) && sel(PACE_GROUP[v.pace], f.pace)
        && (f.manner === 'any' || v.manner === 'calm' || (f.manner === 'mixed' && v.manner === 'mixed')))
      .sort((a, b) => (rank[a.manner] ?? 3) - (rank[b.manner] ?? 3) || String(a.gender).localeCompare(String(b.gender)) || a.hz - b.hz);
  }
  const ageOk = (age) => !f.age || (age && (f.age === 'young' ? age < 30 : f.age === 'middle' ? age >= 30 && age < 50 : age >= 50));
  return finderVoices(catalog, tab).filter((v) => sel(v.language, f.language) && sel(v.gender, f.gender) && ageOk(v.age))
    .sort((a, b) => (a.gender ? 0 : 1) - (b.gender ? 0 : 1) || (a.age || 99) - (b.age || 99));
}

export function finderLabel(v) {
  const who = { female: 'Woman', male: 'Man' }[v.gender] || 'Speaker';
  if (isReader(v)) {
    const accent = !v.accent ? v.language : v.accent === 'Unidentified' ? `${v.language}, accent not labelled` : `${accentName(v.accent)} accent`;
    return { title: `${who} · ${accent}`, detail: `${v.pitch} voice · ${v.manner} · ${v.pace} pace · reader ${v.speaker}` };
  }
  return { title: `${who}${v.age ? `, ${v.age}` : ''} · first language ${v.language}`,
    detail: `${v.birthplace ? `born in ${v.birthplace} · ` : ''}${v.speaker}` };
}

// Its name in the voice library (as the studio's own finder names it).
export function finderName(v) {
  const who = { female: 'woman', male: 'man' }[v.gender] || 'speaker';
  const people = !v.accent || v.accent === 'Unidentified' ? v.language : v.accent === 'New zealand' ? 'New Zealand' : v.accent;
  return (isReader(v)
    ? `${people} ${who}, ${v.pitch}, ${v.manner} (reader ${v.speaker})`
    : `${v.language} accent, ${who}${v.age ? ` ${v.age}` : ''} (${v.speaker})`).slice(0, 80);
}

export const catalogPath = (key, action) => `catalog/${encodeURIComponent(key)}/${action}`;

// "Same dictation" = same language, mode and sentences: the page finds its
// studio recording again after Back, a reload or another visit.
export function planKey(plan, lang, mode) {
  let hash = 0x811c9dc5;
  for (const ch of [lang, mode, ...plan.map((part) => oneLine(part.sentence))].join('\n')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

const MEMORY = 'dictation.listeningStudio.v1';
function readMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY) || '{}') || {}; } catch { return {}; }
}
export function rememberedRecording(key) {
  const id = readMemory()[key]?.id;
  return /^[a-z0-9]{8,32}$/u.test(id || '') ? id : '';
}
export function rememberRecording(key, id) {
  try {
    const memory = readMemory();
    if (id) memory[key] = { id, at: Date.now() };
    else delete memory[key];
    // Only the 40 most recent dictations.
    const kept = Object.entries(memory).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 40);
    localStorage.setItem(MEMORY, JSON.stringify(Object.fromEntries(kept)));
  } catch { /* private window: the recording is just not found again */ }
}

// The bridge exists only where the page and the local server share an
// origin; a GitHub Pages build talks to Render, which has no studio.
export function bridgeAvailable() {
  return !import.meta.env?.VITE_PAGES_BUILD;
}

export class StudioError extends Error {
  constructor(message, { status = 0, offline = false, missing = false } = {}) {
    super(message);
    this.name = 'StudioError';
    this.status = status;
    this.offline = offline;
    this.missing = missing;
  }
}

export async function studioApi(path, { method = 'GET', body, signal, binary = false } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method, signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new StudioError('This copy of Dictation is not reachable. Start it again with start_studio.bat.', { offline: true });
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 404 && !data.detail) {
      throw new StudioError('Listening Studio voices need the local teacher copy: open Dictation with start_studio.bat.', { status: 404, missing: true });
    }
    throw new StudioError(data.detail || data.error || `Listening Studio answered ${response.status}.`,
      { status: response.status, offline: !!data.offline });
  }
  return binary ? response.arrayBuffer() : response.json();
}
