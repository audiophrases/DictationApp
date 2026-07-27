// The app's API surface, in one place. Both the standalone production server
// (server/serve.js) and the Vite dev/preview server mount this, so the two can
// no longer drift apart — previously each registered the same three endpoints
// by hand and /health already differed between them.
import { handleTTSRequest } from './tts.js';
import { handleDictationRequest } from './dictation.js';
import { cacheStats } from './ttsCache.js';

// The frontend is served from GitHub Pages while these endpoints stay on
// Render, so every call is cross-origin. `*` is the honest answer here: both
// endpoints are unauthenticated GETs that read no cookies and no auth header,
// so an origin allowlist would restrict nothing an attacker couldn't get by
// calling the URL directly. It also keeps the portable pack working, which
// runs on 127.0.0.1 and can't be enumerated in advance.
function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Handles /health, /api/tts and /api/dictation. Returns true if the request was
 * one of those (and is now answered), false to let the caller fall through to
 * its own handling — static files in production, Vite's own middleware in dev.
 */
export async function handleAppRequest(req, res, { service = 'dictationapp' } = {}) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (pathname !== '/health' && pathname !== '/api/tts' && pathname !== '/api/dictation') {
    return false;
  }

  applyCors(res);

  // Simple GETs don't preflight, but answering OPTIONS costs nothing and keeps
  // the endpoints usable if a caller ever adds a header that does.
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service, ttsCache: cacheStats() }));
    return true;
  }

  if (pathname === '/api/tts') {
    await handleTTSRequest(req, res);
    return true;
  }

  await handleDictationRequest(req, res);
  return true;
}
