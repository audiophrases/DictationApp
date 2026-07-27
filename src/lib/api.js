// Where the app's two back ends live, and how a running copy works out which
// address to use.
//
// The app now runs from three homes, and they differ in exactly one way — does
// the thing serving the page also serve /api/tts?
//
//   GitHub Pages    A static host. It has no APIs of its own, so audio and
//                   passage fetching go to the Render server by absolute URL.
//   Render          Serves the app and the APIs from one process: same origin.
//   Local           The portable pack, start_local.bat, and `vite dev` all run
//                   the same server on 127.0.0.1: same origin again, and
//                   deliberately so — free practice must keep working offline.
//
// Assignments are different: they always go to the Cloudflare Worker, from
// every home. It's the only always-on piece, which is what keeps a student
// opening an assignment link from waiting on a sleeping free-tier server.

// Set once, after the first `wrangler deploy` in cloudflare/. Overridable at
// build time with VITE_WORKER_BASE (the GitHub Actions workflow passes it
// through) and at runtime with localStorage['dictation.workerBase'], which is
// how you point a local build at `wrangler dev` without rebuilding.
const DEFAULT_WORKER_BASE = '';

// The Render service, used only by a build published to a static host, which
// has no voices of its own. Overridable at build time with VITE_TTS_BASE.
// Check this matches the URL Render actually assigned the service.
const DEFAULT_RENDER_BASE = 'https://dictationapp.onrender.com';

function stripSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function override(key) {
  try {
    return stripSlash(localStorage.getItem(key));
  } catch {
    return '';
  }
}

/** Absolute base for the Cloudflare Worker, or '' if this copy has none set. */
export function workerBase() {
  return (
    override('dictation.workerBase') ||
    stripSlash(import.meta.env.VITE_WORKER_BASE) ||
    stripSlash(DEFAULT_WORKER_BASE)
  );
}

export function workerUrl(path) {
  return `${workerBase()}${path}`;
}

export function assignmentsAvailable() {
  return !!workerBase();
}

/**
 * Base for /api/tts, /api/dictation and /health — '' (same origin) unless this
 * build is destined for a static host that has none of them.
 *
 * Decided at build time, not by sniffing the hostname at runtime: only the
 * build knows whether it is being published to a static host. The GitHub Pages
 * workflow sets VITE_PAGES_BUILD; the Render build, the portable pack and
 * `vite dev` all leave it unset and talk to the server under the page, which
 * is what keeps free practice working offline in the pack.
 */
export function ttsBase() {
  const forced = override('dictation.ttsBase');
  if (forced) return forced;
  if (!import.meta.env.VITE_PAGES_BUILD) return '';
  return stripSlash(import.meta.env.VITE_TTS_BASE) || DEFAULT_RENDER_BASE;
}

export class ApiError extends Error {
  constructor(message, { status = 0, network = false, config = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // Separated because they need different words on screen: a network error
    // is "try again", a config error is "this copy of the app can't do that".
    this.network = network;
    this.config = config;
  }
}

/**
 * JSON call to the worker. Always fails fast rather than hanging: a student
 * mid-dictation needs to be told something is wrong while there is still time
 * to retry, not after the lesson has ended.
 */
export async function workerApi(path, { method = 'GET', body, headers = {}, timeoutMs = 15000 } = {}) {
  if (!workerBase()) {
    throw new ApiError('Assignments are not set up on this copy of the app.', { config: true });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(workerUrl(path), {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError("Can't reach the assignment server. Check your connection and try again.", {
      network: true,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new ApiError(data.error || `Request failed (${res.status})`, { status: res.status });
  }
  return data;
}
