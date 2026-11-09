import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  NARRATOR, catalogPath, counted, cueLines, defaultDescription, describeRecording, dictationScript, finderLabel,
  finderMatches, finderName, finderStart, finishedLines, formFromRecording,
  lineId, matchesDictation, planKey, progressText, studioLanguage, studioSettings,
} from './listeningStudio.js';

const plan = [
  { sentence: 'Moving abroad helped him.', segments: ['Moving abroad', 'helped him.'] },
  { sentence: 'Was it hard?', segments: ['Was it hard?'] },
];

test('only languages Qwen3 speaks, in the app’s dialects', () => {
  assert.equal(studioLanguage('fr-FR'), 'French');
  assert.equal(studioLanguage('pt-PT'), 'Portuguese');
  for (const code of ['ca-ES', 'ar-MA', 'ro-RO', 'uk-UA', '', undefined]) assert.equal(studioLanguage(code), '');
  assert.match(defaultDescription('es-ES'), /Spain/);
  assert.match(defaultDescription('en-US'), /American/);
  assert.throws(() => dictationScript({ plan, lang: 'ca-ES', title: 't', description: 'd' }));
  assert.throws(() => dictationScript({ plan, lang: 'en-US', title: 't', description: '  ' }));
});

test('notebook dictations get each punctuation cue once, as a line in the same voice', () => {
  assert.deepEqual(cueLines(plan, 'en-US', 'typing'), []);
  assert.deepEqual(cueLines([...plan, { sentence: 'Yes.' }], 'en-US', 'notebook'), ['Period.', 'Question mark.']);
  assert.deepEqual(cueLines(plan, 'fr-FR', 'notebook'), ['Point.', 'Point d’interrogation.']);
});

test('one narrator line per sentence, then the cues', () => {
  const { script, text } = dictationScript({ plan, lang: 'en-US', title: 'Week 3\nquiz', description: 'A calm  voice.',
    direction: 'slow (very): clear', cues: ['Period.'] });
  assert.equal(script.language, 'English');
  assert.equal(script.title, 'Week 3 quiz');
  assert.deepEqual(script.voices, { [NARRATOR]: { description: 'A calm voice.', effect: '' } });
  assert.deepEqual(script.parts[0].items.map((item) => item.text), ['Moving abroad helped him.', 'Was it hard?', 'Period.']);
  assert.ok(script.parts[0].items.every((item) => item.direction === 'slow very clear' && item.speakers[0] === NARRATOR));
  assert.match(text, /^TITLE: Week 3 quiz\nLANGUAGE: English\nAMBIENCE: none\nVOICE Narrator: A calm voice\.\n\nNarrator \(slow very clear\): Moving abroad helped him\./u);
});

// The studio's page re-reads the text with PinPlay's own parser: it must give
// back the same script the studio is asked to voice.
// PinPlay next to this repo, or wherever PINPLAY_DIR points.
const pinplay = process.env.PINPLAY_DIR || fileURLToPath(new URL('../../../pinplay', import.meta.url));
const parserPath = path.join(pinplay, 'listening-script.js');
test('the script text parses back to the same script in PinPlay', { skip: !fs.existsSync(parserPath) && 'PinPlay not found (set PINPLAY_DIR)' }, () => {
  const { parseListeningScript, listeningScriptNeedsSetup, LISTENING_SCRIPT_LANGUAGES } = createRequire(import.meta.url)(parserPath);
  for (const direction of ['', 'reading a dictation aloud: slow, clear']) {
    const tricky = [...plan, { sentence: 'Mia: [pause] VOICE # --- not a header.' }, { sentence: '"Wait," he said (quietly).' }];
    const { script, text } = dictationScript({ plan: tricky, lang: 'fr-FR', title: 'Dictée', description: 'Une voix calme.', direction, cues: ['Point.'] });
    const parsed = parseListeningScript(text);
    assert.deepEqual(parsed.notes, []);
    assert.equal(listeningScriptNeedsSetup(parsed), false);
    assert.equal(parsed.language, script.language);
    assert.deepEqual(parsed.voices, script.voices);
    assert.deepEqual(parsed.parts.map((p) => p.items.map(({ speakers, direction: d, text: t }) => ({ speakers, d, t }))),
      script.parts.map((p) => p.items.map(({ speakers, direction: d, text: t }) => ({ speakers, d, t }))));
  }
  for (const code of ['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'ru-RU']) {
    assert.ok(LISTENING_SCRIPT_LANGUAGES.includes(studioLanguage(code)), code);
  }
});

test('settings: a library voice is always fixed; retries and samples survive edits', () => {
  const base = { lineTakes: { [lineId(1)]: 2 }, sampleTakes: { [NARRATOR]: 1 }, extra: true };
  assert.deepEqual(studioSettings(base, { mode: 'acted', libraryVoice: 'abcdef123456', check: false }), {
    extra: true, mode: 'fixed', modes: {}, descriptions: {}, ownVoices: { [NARRATOR]: 'abcdef123456' },
    sampleTakes: { [NARRATOR]: 1 }, lineTakes: { '0:1:Narrator': 2 }, batch: true, spacing: 'natural', ambience: 'none', check: false,
  });
  const acted = studioSettings({}, { mode: 'acted', libraryVoice: '', check: true });
  assert.equal(acted.mode, 'acted');
  assert.deepEqual(acted.ownVoices, {});
  const { script } = dictationScript({ plan, lang: 'en-US', title: 't', description: 'A clear voice.', direction: 'slowly' });
  assert.deepEqual(formFromRecording({ script, settings: acted }, 'en-US'),
    { source: 'design', description: 'A clear voice.', libraryVoice: '', mode: 'acted', direction: 'slowly', check: true });
  assert.equal(formFromRecording({ script, settings: studioSettings({}, { libraryVoice: 'abcdef123456' }) }, 'en-US').source, 'library');
  assert.equal(formFromRecording(null, 'de-DE').description, defaultDescription('de-DE'));
});

const resultLine = (item, text, extra = {}) => ({ id: lineId(item), part: 0, item, speaker: NARRATOR, text, take: 0,
  file: `C:\\studio\\recordings\\abc\\lines\\${item}abc.wav`, level: 'ok', heard: text, diffs: [], ...extra });

test('finished lines come back in order, and only if they still read this dictation', () => {
  const expected = ['Moving abroad helped him.', 'Was it hard?'];
  const data = { result: { lines: [resultLine(1, 'Was it hard?', { take: 1, level: 'minor' }), resultLine(0, 'Moving abroad helped him.')] } };
  assert.deepEqual(finishedLines(data, expected).map((l) => [l.text, l.file, l.take, l.level]),
    [['Moving abroad helped him.', '0abc.wav', 0, 'ok'], ['Was it hard?', '1abc.wav', 1, 'minor']]);
  assert.throws(() => finishedLines({ result: { lines: [resultLine(0, 'Changed in the studio.'), resultLine(1, 'Was it hard?')] } }, expected));
  assert.throws(() => finishedLines({ result: { lines: [resultLine(0, 'Moving abroad helped him.')] } }, expected));
  assert.equal(matchesDictation({ lines: [resultLine(0, 'Moving  abroad helped him.'), resultLine(1, 'Was it hard?')] }, expected), true);
  assert.equal(matchesDictation({ lines: [resultLine(0, 'Moving abroad helped him.')] }, expected), false);
});

test('where a recording stands', () => {
  const id = 'abc123def456';
  const voices = { [NARRATOR]: { sample: true, sampleKey: 'k1', own: null } };
  const at = (stage, extra = {}) => ({ recording: { stage }, voices, voiceReport: {}, result: null, stale: false, ...extra });
  const job = { id, stage: 'lines', done: 3, total: 10, stages: { lines: 100 }, at: 160 };
  assert.equal(describeRecording(id, at('approved'), { job, queue: [], now: 160 }).phase, 'working');
  assert.equal(describeRecording(id, at('approved'), { job, queue: [], now: 160 }).text, 'Making sentences 3/10 · about 2 min left');
  assert.match(describeRecording(id, at('voices'), { job: { id: 'other', stage: 'lines' }, queue: [[id, 'voices']] }).text, /another recording/);
  assert.equal(describeRecording(id, at('voices'), { queue: [] }).phase, 'voice');
  assert.equal(describeRecording(id, at('voices', { voices: { [NARRATOR]: { sample: false } } }), { queue: [] }).phase, 'idle');
  assert.equal(describeRecording(id, at('voices', { voiceReport: { [NARRATOR]: { warning: 'Sounds very young' } } }), {}).warning, 'Sounds very young');
  const done = { result: { lines: [resultLine(0, 'x')] } };
  assert.equal(describeRecording(id, at('approved', done), { queue: [] }).phase, 'ready');
  assert.equal(describeRecording(id, at('approved', { ...done, stale: true }), { queue: [] }).phase, 'stale');
  assert.equal(describeRecording(id, at('approved'), { queue: [] }).phase, 'idle');
  assert.equal(describeRecording(id, at('approved'), { queue: [], last: { id, ok: false, error: 'Out of memory' } }).text, 'Out of memory');
  assert.equal(describeRecording(id, at('approved'), { queue: [], last: { id, ok: false, stopped: true } }).phase, 'stopped');
  // Another recording's failure is not this one's.
  assert.equal(describeRecording(id, at('approved', done), { queue: [], last: { id: 'other', ok: false } }).phase, 'ready');
  assert.equal(progressText({ stage: 'checks', done: 1, total: 4 }), 'Checking the words 1/4');
  assert.equal(progressText({ stage: 'start' }), 'Starting the voice engine…');
});

test('the same dictation finds the same studio recording', () => {
  assert.equal(planKey(plan, 'en-US', 'typing'), planKey(plan.map((p) => ({ ...p, sentence: ` ${p.sentence} ` })), 'en-US', 'typing'));
  assert.notEqual(planKey(plan, 'en-US', 'typing'), planKey(plan, 'en-US', 'notebook'));
  assert.notEqual(planKey(plan, 'en-US', 'typing'), planKey(plan.slice(1), 'en-US', 'typing'));
});

// 🌍 Find a voice: the studio's catalog, filtered as its own finder does.
const reader = (key, extra) => ({ key, source: 'librittsr', speaker: key.slice(3), language: 'English', gender: 'female', accent: 'American',
  pitch: 'moderate', pace: 'moderate', manner: 'calm', hz: 200, text: 'Some words.', ...extra });
const catalog = { voices: [
  reader('lt-1', { hz: 230 }),
  reader('lt-2', { gender: 'male', hz: 110, pitch: 'slightly low' }),
  reader('lt-3', { manner: 'lively' }),
  reader('lt-4', { accent: 'English', pace: 'very fast' }),
  reader('lt-5', { accent: 'Unidentified', manner: 'mixed' }),
  { key: 'cml-9', source: 'cmltts', speaker: '9', language: 'French', gender: 'female', accent: '', pitch: 'high', pace: 'slow', manner: 'calm', hz: 220, text: 'Des mots.' },
  { key: 'saa-spanish1', source: 'accentarchive', speaker: 'spanish1', language: 'Spanish', gender: 'male', age: 41, birthplace: 'madrid, spain' },
  { key: 'saa-spanish2', source: 'accentarchive', speaker: 'spanish2', language: 'Spanish', gender: 'female', age: 23 },
  { key: "saa-sa'a1", source: 'accentarchive', speaker: "sa'a1", language: "Sa'A", gender: '', age: null },
] };

test('the finder opens on native readers of the dictation’s language, else on its accent', () => {
  assert.deepEqual(finderStart(catalog, 'en-US'), { tab: 'readers',
    f: { readerLanguage: 'English', accent: 'American', gender: '', pitch: '', manner: 'calm', pace: '', language: 'English', age: '' } });
  const fr = finderStart(catalog, 'fr-FR');
  assert.equal(fr.tab, 'readers');
  assert.equal(fr.f.readerLanguage, 'French');
  assert.equal(fr.f.accent, '');
  // No Spanish readers: Spanish speakers reading English.
  const es = finderStart(catalog, 'es-ES');
  assert.equal(es.tab, 'accents');
  assert.equal(es.f.language, 'Spanish');
  assert.deepEqual(finderMatches(catalog, es.tab, es.f).map((v) => v.key), ['saa-spanish2', 'saa-spanish1']);
});

test('finder filters: calm first, pitch and pace in three groups, age bands', () => {
  const f = finderStart(catalog, 'en-US').f;
  assert.deepEqual(finderMatches(catalog, 'readers', f).map((v) => v.key), ['lt-1', 'lt-2']);
  assert.deepEqual(finderMatches(catalog, 'readers', { ...f, accent: '', manner: 'mixed' }).map((v) => v.key), ['lt-4', 'lt-1', 'lt-2', 'lt-5']);
  assert.deepEqual(finderMatches(catalog, 'readers', { ...f, accent: '', manner: 'any' }).map((v) => v.key).sort(), ['lt-1', 'lt-2', 'lt-3', 'lt-4', 'lt-5']);
  assert.deepEqual(finderMatches(catalog, 'readers', { ...f, pitch: 'low' }).map((v) => v.key), ['lt-2']);
  assert.deepEqual(finderMatches(catalog, 'readers', { ...f, accent: '', pace: 'fast' }).map((v) => v.key), ['lt-4']);
  assert.deepEqual(finderMatches(catalog, 'accents', { language: 'Spanish', gender: '', age: 'middle' }).map((v) => v.key), ['saa-spanish1']);
  assert.deepEqual(counted(catalog.voices.filter((v) => v.source === 'librittsr'), 'accent'),
    [['American', 3], ['English', 1], ['Unidentified', 1]]);
});

test('finder labels and library names read naturally; odd keys stay in the path', () => {
  assert.deepEqual(finderLabel(catalog.voices[3]), { title: 'Woman · English (England) accent', detail: 'moderate voice · calm · very fast pace · reader 4' });
  assert.equal(finderLabel(catalog.voices[4]).title, 'Woman · English, accent not labelled');
  assert.equal(finderLabel(catalog.voices[5]).title, 'Woman · French');
  assert.equal(finderLabel(catalog.voices[6]).title, 'Man, 41 · first language Spanish');
  assert.equal(finderName(catalog.voices[1]), 'American man, slightly low, calm (reader 2)');
  assert.equal(finderName(catalog.voices[3]), 'English woman, moderate, calm (reader 4)');
  assert.equal(finderName(catalog.voices[6]), 'Spanish accent, man 41 (spanish1)');
  assert.equal(catalogPath("saa-sa'a1", 'add'), "catalog/saa-sa'a1/add");
});

// The real catalog, when PinPlay is here: every dictation language finds voices.
const catalogFile = path.join(pinplay, 'listening-studio', 'catalog', 'voices.json');
test('the studio’s catalog has voices for every dictation language', { skip: !fs.existsSync(catalogFile) && 'PinPlay not found (set PINPLAY_DIR)' }, () => {
  const real = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  for (const code of ['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'ru-RU']) {
    const { tab, f } = finderStart(real, code);
    assert.ok(finderMatches(real, tab, f).length >= 5, code);
  }
  assert.ok(real.voices.every((v) => /^[a-z]{1,8}-(?:[\w.-]|'){1,64}$/u.test(v.key)), 'catalog keys fit the bridge');
});
