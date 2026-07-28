// Lesson dictations, taken from the same Google Sheet that drives Speech to
// IPA — one lesson is one dictation.
//
// The sheet is the single source of truth for both apps: editing a sentence
// there changes it in Speech to IPA and here, with nothing to rebuild or
// deploy. Its tabs are published to the web as CSV, which is why the browser
// can read them directly (they come back with Access-Control-Allow-Origin: *).
//
// Row schema, one tab per language (see speechtoipa/SCRIPTER_INSTRUCTIONS.md):
//
//   lesson_title, lesson_id, sentence_id, token_id, <lang>, ca, en, fr, es, it, ma
//
// A row with an empty token_id is a sentence; the rows under it are its words,
// which matter to Speech to IPA's pronunciation scoring and are ignored here.
// lesson_title is only filled on a lesson's first row.

const SHEET =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQl1GNJGHAilkpQn3KiB0HnrUGEXSQp_dwo6A548izQXL-iAtAIHB2g3_o6VYAOv6UFuUOcISzJQO61/pub?single=true&output=csv&gid=';

// This app's language codes mapped onto the sheet's tab and column. The
// languages missing here simply have no lessons, and the picker stays hidden.
const TABS = {
  'en-US': { gid: '1053057720', column: 'en' },
  'ca-ES': { gid: '1216373156', column: 'ca' },
  'fr-FR': { gid: '484976070', column: 'fr' },
  'it-IT': { gid: '1338439854', column: 'it' },
  // The Arabic-script column, not ma_latn: that transcription exists for
  // speech scoring, whereas a dictation is typed in the script being taught.
  'ar-MA': { gid: '710375040', column: 'ma' },
};

export function hasLessons(lang) {
  return Object.hasOwn(TABS, lang);
}

// Each tab is ~200 KB, so it is fetched only when someone actually opens the
// lesson picker, and kept for the rest of the visit.
const cache = new Map();

/** CSV with quoted fields, which lesson text needs — commas are everywhere. */
function parseCsv(text) {
  const rows = [];
  let cell = '';
  let row = [];
  let inQuotes = false;

  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { if (row.length) { rows.push(row); row = []; } };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      // A doubled quote inside a quoted field is one literal quote.
      if (inQuotes && next === '"') { cell += '"'; i += 1; } else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      endCell();
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      endCell();
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) { endCell(); endRow(); }
  return rows;
}

/**
 * Every lesson for a language, in sheet order:
 * `[{ id, title, sentences: [...] }]`.
 */
export async function fetchLessons(lang) {
  if (cache.has(lang)) return cache.get(lang);

  const tab = TABS[lang];
  if (!tab) return [];

  const res = await fetch(SHEET + tab.gid);
  if (!res.ok) throw new Error(`Could not load the lessons (${res.status}).`);

  const rows = parseCsv(await res.text());
  if (!rows.length) throw new Error('The lesson sheet came back empty.');

  const headers = rows[0].map((h) => h.trim());
  const at = (cells, name) => (cells[headers.indexOf(name)] || '').trim();

  const lessons = [];
  const byId = new Map();
  for (const cells of rows.slice(1)) {
    const id = at(cells, 'lesson_id');
    const sentence = at(cells, tab.column);
    // Skip word rows, and any sentence with no text in this language yet.
    if (!id || at(cells, 'token_id') || !sentence) continue;

    if (!byId.has(id)) {
      const lesson = { id, title: at(cells, 'lesson_title') || id, sentences: [] };
      byId.set(id, lesson);
      lessons.push(lesson);
    }
    byId.get(id).sentences.push(sentence);
  }

  const usable = lessons.filter((l) => l.sentences.length > 0);
  cache.set(lang, usable);
  return usable;
}

/**
 * A lesson as this app's passage: one sentence per line.
 *
 * splitIntoSentences treats a line break as the end of a sentence, so joining
 * this way makes the dictation follow the lesson exactly — one line in, one
 * sentence to type. It also means a lesson behaves like any other passage
 * everywhere downstream, including when set as an assignment.
 */
export function lessonToPassage(lesson) {
  return lesson.sentences.join('\n');
}
