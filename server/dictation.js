import { splitIntoSentences, countWords } from '../src/lib/sentences.js';

// Every source is a MediaWiki site, so one code path (the /w/api.php random +
// extracts query) serves them all. For each app language we try a simpler,
// curated encyclopedia FIRST — Simple English Wikipedia or Vikidia (a
// children's encyclopedia) — because their articles are general-knowledge
// topics in plain language, far better dictation material than random
// Wikipedia stubs (which skew to obscure villages/species: proper-noun lists).
// Wikipedia is the always-available fallback, and the only source for languages
// with no kids' wiki (Portuguese, Ukrainian, Romanian, Moroccan Darija).
const vikidia = (lang) => ({ host: `${lang}.vikidia.org`, label: 'Vikidia', edition: lang });
const wikipedia = (edition) => ({ host: `${edition}.wikipedia.org`, label: 'Wikipedia', edition });
const simpleWiki = { host: 'simple.wikipedia.org', label: 'Simple English Wikipedia', edition: 'simple' };

export const SOURCES = {
  'en-US': [simpleWiki, wikipedia('en')],
  'ca-ES': [vikidia('ca'), wikipedia('ca')],
  'fr-FR': [vikidia('fr'), wikipedia('fr')],
  'es-ES': [vikidia('es'), wikipedia('es')],
  'de-DE': [vikidia('de'), wikipedia('de')],
  'it-IT': [vikidia('it'), wikipedia('it')],
  'ru-RU': [vikidia('ru'), wikipedia('ru')],
  // 'ary' is the Moroccan Arabic (Darija) edition — a small but real wiki,
  // distinct from the much larger Modern Standard Arabic 'ar' one.
  'ar-MA': [wikipedia('ary')],
  'pt-PT': [wikipedia('pt')],
  'uk-UA': [wikipedia('uk')],
  'ro-RO': [wikipedia('ro')],
};

// Languages where the "capitalized mid-sentence word = proper noun" heuristic
// misfires: German capitalizes every noun, and Arabic script has no letter case.
// For these we fall back to number-density only when scoring passage quality.
const NO_CAPS_CHECK = new Set(['de-DE', 'ar-MA']);

const LENGTHS = {
  short: { maxSentences: 3, maxWords: 40, minWordsPerSentence: 3, maxWordsPerSentence: 16, minSentences: 2 },
  medium: { maxSentences: 5, maxWords: 65, minWordsPerSentence: 3, maxWordsPerSentence: 25, minSentences: 3 },
  long: { maxSentences: 11, maxWords: 140, minWordsPerSentence: 0, maxWordsPerSentence: Infinity, minSentences: 4 },
};

// A passage is rejected if this fraction of its tokens are proper-noun-ish or
// bare numbers — i.e. it reads like a stub of names/stats rather than practice
// prose. Tuned so a village stub ("X is a village in Y Province, Z. Population
// is 159 (2021).") is dropped while normal encyclopedic prose passes.
const MAX_JUNK_RATIO = 0.4;
// Numbers alone are a strong, script-independent stub signal (statistics dumps),
// so they also get a dedicated, tighter cap — this catches number-dense stubs
// that don't trip the combined ratio, and works where case detection can't
// (Arabic).
const MAX_NUMBER_RATIO = 0.22;

// Titles that tend to produce list-like or non-prose passages, in the languages
// we fetch. Matched as substrings on the lowercased title — JS \b word
// boundaries are ASCII-only and misfire around accented terms like
// "desambiguació", so we deliberately avoid regex boundaries here.
const SKIP_TITLE_MARKERS = [
  'disambiguation', 'desambiguació', 'desambiguación', 'homonymie', 'disambigua',
  'list of ', 'llista de ', 'liste des ', 'liste de ', 'lista de ', 'lista di ', 'anexo:',
  '(значения)', 'список ', // Russian/Ukrainian: disambiguation suffix, "list" prefix
  '(dezambiguizare)', 'listă de ', 'lista ', // Romanian
  'توضيح', // Arabic-script wikis (incl. Moroccan Darija): disambiguation
];

export function isUnsuitableTitle(title) {
  const t = (title || '').toLowerCase();
  return SKIP_TITLE_MARKERS.some((m) => t.includes(m));
}

const USER_AGENT = 'DictationApp/0.2 (educational dictation practice)';

export function cleanExtract(raw) {
  return (raw || '')
    .replace(/\[[^\]]*\]/g, '')     // footnote markers [1] and IPA/editorial [ˈɪŋɡlənd]
    .replace(/\s*\n+\s*/g, ' ')     // paragraph breaks -> spaces
    .replace(/\s{2,}/g, ' ')        // collapse runs of whitespace
    .replace(/\s+([.,;:!?])/g, '$1') // no space before punctuation
    .trim();
}

/**
 * Fraction of tokens that look like proper nouns (capitalized mid-sentence, when
 * `checkCaps`) or bare numbers/years. High values mark name/stat-dense stubs
 * that make poor dictation material. Pure and unit-tested.
 */
export function contentJunkRatio(text, checkCaps = true) {
  const tokens = (text || '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  let junk = 0;
  let sentenceStart = true;
  for (const tok of tokens) {
    // Strip surrounding punctuation so "(2021)." -> "2021", "District," -> "District"
    const word = tok.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
    if (word) {
      if (/^\p{Nd}/u.test(word)) {
        junk++;
      } else if (checkCaps && !sentenceStart) {
        const f = word[0];
        if (f.toLocaleLowerCase() !== f.toLocaleUpperCase() && f === f.toLocaleUpperCase()) junk++;
      }
    }
    sentenceStart = /[.!?]$/.test(tok);
  }
  return junk / tokens.length;
}

/** Fraction of tokens that are bare numbers/years. Script-independent. Pure. */
export function numberRatio(text) {
  const tokens = (text || '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  let n = 0;
  for (const tok of tokens) {
    const word = tok.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
    if (word && /^\p{Nd}/u.test(word)) n++;
  }
  return n / tokens.length;
}

/**
 * Turn a raw article extract into a dictation passage sized for the requested
 * length. Pure and deterministic — unit-tested separately from the network layer.
 * Returns '' when the extract can't yield enough usable sentences, or when the
 * result is too dense with proper nouns/numbers to be good dictation material.
 */
export function buildPassage(extract, length = 'short', { checkCaps = true } = {}) {
  const cfg = LENGTHS[length] || LENGTHS.short;
  const sentences = splitIntoSentences(cleanExtract(extract));

  const suitable = sentences.filter((s) => {
    const w = countWords(s);
    return w >= cfg.minWordsPerSentence && w <= cfg.maxWordsPerSentence;
  });
  // For "short"/"medium" we filter out very long/short sentences, but if that
  // leaves too little we fall back to the raw sentence order rather than
  // returning nothing.
  const pool = suitable.length >= cfg.minSentences ? suitable : sentences;

  const picked = [];
  let words = 0;
  for (const s of pool) {
    if (picked.length >= cfg.maxSentences) break;
    const w = countWords(s);
    if (picked.length > 0 && words + w > cfg.maxWords) break;
    picked.push(s);
    words += w;
  }

  if (picked.length < cfg.minSentences) return '';
  const text = picked.join(' ');
  if (numberRatio(text) > MAX_NUMBER_RATIO) return '';
  if (contentJunkRatio(text, checkCaps) > MAX_JUNK_RATIO) return '';
  return text;
}

// All sources are MediaWiki sites and expose the same action API here.
const API_PATH = '/w/api.php';

async function fetchRandomArticle(host, signal) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'random',
    grnnamespace: '0',
    grnlimit: '1',
    prop: 'extracts|info|revisions',
    explaintext: '1',
    exintro: '1',
    inprop: 'url',
    rvprop: 'timestamp',
    redirects: '1',
  });
  const url = `https://${host}${API_PATH}?${params.toString()}`;
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT }, signal });
  if (!resp.ok) throw new Error(`${host} responded ${resp.status}`);
  const data = await resp.json();
  const pages = data?.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;
  return {
    title: page.title,
    url: page.fullurl || page.canonicalurl || null,
    date: page.revisions?.[0]?.timestamp || null,
    extract: page.extract || '',
  };
}

/**
 * Try each source in order (simpler encyclopedia first, Wikipedia as fallback),
 * fetching random articles and shaping them into a dictation passage. Retries a
 * few times per source to skip unusable (too short, list/disambiguation, or
 * name/number-dense) articles. Returns null if nothing suitable was found.
 */
export async function fetchDictation(sources, length, { checkCaps = true, attemptsPerSource = 5, timeoutMs = 6000, budgetMs = 12000 } = {}) {
  const deadline = Date.now() + budgetMs;
  let networkErrors = 0;
  let fetchedAny = false;
  for (const source of sources) {
    for (let i = 0; i < attemptsPerSource && Date.now() < deadline; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const article = await fetchRandomArticle(source.host, controller.signal);
        fetchedAny = true;
        if (article && article.title && !isUnsuitableTitle(article.title)) {
          const text = buildPassage(article.extract, length, { checkCaps });
          if (text) {
            return {
              text,
              title: article.title,
              url: article.url,
              date: article.date,
              source: source.label,
              edition: source.edition,
            };
          }
        }
      } catch {
        // A failed/aborted attempt (timeout, rate limit, network) — count it
        // and try another random article / the next source.
        networkErrors++;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  // If we never once reached a source, this is a connectivity/rate-limit
  // problem, not a lack of suitable content — signal that distinctly.
  if (!fetchedAny && networkErrors > 0) {
    const err = new Error('Could not reach the source. Please try again in a moment.');
    err.code = 'UPSTREAM_UNAVAILABLE';
    throw err;
  }
  return null;
}

export async function handleDictationRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const lang = url.searchParams.get('lang') || 'en-US';
    const requestedLength = url.searchParams.get('length');
    const length = Object.hasOwn(LENGTHS, requestedLength) ? requestedLength : 'short';
    const sources = SOURCES[lang];

    if (!sources) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: `Unsupported language: ${lang}` }));
      return;
    }

    const result = await fetchDictation(sources, length, { checkCaps: !NO_CAPS_CHECK.has(lang) });
    if (!result) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'Could not find a suitable passage. Please try again.' }));
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error('Dictation fetch error:', error);
    if (error.code === 'UPSTREAM_UNAVAILABLE') {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Failed to fetch passage', details: error.message }));
  }
}
