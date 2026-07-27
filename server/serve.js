// Standalone production server: serves the built app (dist/) plus the same
// /api/tts and /api/dictation handlers Vite uses in dev. This is what runs
// both for the local production launcher (start_local.bat) and on Render —
// one server, two homes, so the neural voices work identically in both.
//
// Since the student-facing app moved to GitHub Pages, the Render copy is
// mainly a voice service. It still serves the whole app (that's what the
// portable pack needs), but a deploy can set ROOT_REDIRECT_URL to send stale
// bookmarks on to the Pages address — see the redirect below.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAppRequest } from './routes.js';

const PORT = Number(process.env.PORT) || 4173;
// All interfaces by default, because that is the only default that cannot break
// a deploy: a host's health check reaches the container over its routable
// address, and a loopback-bound server is invisible to it.
//
// Loopback is what the LOCAL launchers want — binding every interface makes
// Windows Defender pop the "allow this app on your networks?" dialog, which
// needs an administrator, and the portable pack must never require one. So they
// set HOST=127.0.0.1 themselves (see the pack launcher and start_local.bat).
// Deliberately this way round: a launcher that forgets it prompts for a
// firewall rule, which is visible and recoverable, whereas a host that doesn't
// pass HOST fails its health check with nothing obviously wrong.
const HOST = process.env.HOST || '0.0.0.0';
// Optional. When set, a browser asking this server for the page itself is sent
// to the app's real home instead. Only bare navigations to "/" are redirected:
// /health, /api/* and the hashed assets must keep answering normally, because
// the Pages copy of the app calls straight back into this server for audio.
// Unset by default, so a plain deploy (and the portable pack) still serves the
// app from here.
const ROOT_REDIRECT_URL = process.env.ROOT_REDIRECT_URL || '';
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(SERVER_DIR, '..');
// Normally the sibling dist/ of this repo. The Windows portable pack overrides it
// because there the server is a single bundled file, free to sit anywhere.
const DIST_DIR = process.env.DIST_DIR
  ? path.resolve(process.env.DIST_DIR)
  : path.join(APP_ROOT, 'dist');

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // Without the right type the browser won't treat this as an app manifest, and
  // "Install app" never appears.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Everything Vite emits under /assets is content-hashed, so a given URL can
// never change and is safe to cache forever. These three are NOT hashed and must
// always be revalidated:
//   index.html   a redeploy repoints it at new hashed assets
//   sw.js        a year-long cache would pin students to an old service worker,
//                which would then keep serving the old app out of its own cache
//   manifest     name/icon changes should actually reach installed apps
const ALWAYS_REVALIDATE = new Set(['/index.html', '/sw.js', '/manifest.webmanifest']);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function serveStatic(pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: 'Bad request' });
    return;
  }
  if (decoded === '/') decoded = '/index.html';

  const filePath = path.normalize(path.join(DIST_DIR, decoded));
  const insideRoot = filePath.startsWith(DIST_DIR + path.sep) || filePath === path.join(DIST_DIR, 'index.html');
  if (!insideRoot) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
    'Cache-Control': ALWAYS_REVALIDATE.has(decoded)
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(res);
}

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error(`No build found at ${DIST_DIR}. Run "npm run build" first.`);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (await handleAppRequest(req, res)) return;

    if (ROOT_REDIRECT_URL && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(302, { Location: ROOT_REDIRECT_URL, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    console.error('Unhandled server error:', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
  }
});

// A student double-clicking the launcher twice is the common case here, so say
// what happened in words they can act on rather than dumping a stack trace.
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — Dictation Time may already be running.`);
    console.error('Close the other Dictation Time window, then start it again.');
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? `port ${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`DictationApp running at ${shown}`);
});
