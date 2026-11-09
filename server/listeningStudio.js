// A narrow bridge from the teacher's local Dictation page to PinPlay's
// Listening Studio (C:\Users\Admin\pinplay\listening-studio, Qwen3 voices on
// this PC, http://127.0.0.1:8790).
//
// Why a bridge instead of calling the studio from the page: the studio only
// lets its own page and PinPlay's pages in, and PinPlay may use just four of
// its routes. Server-to-server calls carry no Origin, so the studio treats
// them as its own page; that is exactly why this bridge has to be strict:
//
//   - loopback only: the caller's address and the Host header must both be
//     this computer (Render, a LAN neighbour and DNS rebinding get a 404);
//   - same-origin only: a page on another site can't drive it;
//   - writes must be JSON, so a cross-site form can't post here either;
//   - an allow-list of the routes a dictation needs. Deleting recordings,
//     the library's uploads, the phone import and Quit stay in the studio.
import http from 'node:http';

const UPSTREAM = new URL(process.env.LISTENING_STUDIO_URL || 'http://127.0.0.1:8790/');
export const PREFIX = '/api/listening-studio/';
const ID = '[a-z0-9]{8,32}';
const ROUTES = [
  ['GET', /^status$/],
  ['GET', /^library$/],
  ['GET', new RegExp(`^library/${ID}/audio$`)],
  ['POST', /^library\/from-recording$/],
  ['POST', /^recordings$/],
  ['GET', new RegExp(`^recordings/${ID}$`)],
  ['PUT', new RegExp(`^recordings/${ID}$`)],
  ['POST', new RegExp(`^recordings/${ID}/make$`)],
  ['GET', new RegExp(`^recordings/${ID}/audio/(lines|voices)/[\\w.-]{1,80}\\.wav$`)],
  ['POST', /^stop$/],
];
const MAX_BODY = 1024 * 1024;
const LOOPBACK_ADDRESS = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/;
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// '' when the request may pass, else why not.
export function refusal(req) {
  const host = String(req.headers.host || '');
  if (!LOOPBACK_ADDRESS.test(req.socket?.remoteAddress || '') || !LOOPBACK_HOST.test(host)) return 'local';
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return 'origin';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'origin';
  if (req.method !== 'GET' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return 'type';
  return '';
}

export function allowedRoute(method, route) {
  return ROUTES.some(([m, pattern]) => m === method && pattern.test(route));
}

// The whole body, or null when it is over MAX_BODY. Always read to the end,
// refused requests included: answering before the body is read makes Node
// drop the keep-alive connection, and the browser's next request on it fails.
function readBody(req) {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.readableEnded) { resolve(Buffer.alloc(0)); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
      else if (size > MAX_BODY * 4) req.destroy(); // not worth draining
    });
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks)));
    req.on('close', () => resolve(null));
    req.on('error', () => resolve(null));
  });
}

export async function handleListeningStudioRequest(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const why = refusal(req);
  const route = pathname.slice(PREFIX.length);
  const body = await readBody(req);
  // Off this computer the bridge doesn't exist at all.
  if (why === 'local') return send(res, 404, { error: 'Not found' });
  if (why) return send(res, 403, { error: 'Only the Dictation page on this computer can use Listening Studio.' });
  if (!allowedRoute(req.method, route)) return send(res, 404, { error: 'Not found' });
  if (!body) return send(res, 413, { error: 'Request too large.' });
  await new Promise((resolve) => {
    const upstream = http.request(new URL(`api/${route}`, UPSTREAM), {
      method: req.method,
      // No Origin, cookies or anything else from the browser.
      headers: req.method === 'GET' ? {} : { 'Content-Type': 'application/json', 'Content-Length': body.length },
      timeout: 30000,
    }, (answer) => {
      const headers = { 'Cache-Control': 'no-store' };
      for (const name of ['content-type', 'content-length']) if (answer.headers[name]) headers[name] = answer.headers[name];
      res.writeHead(answer.statusCode || 502, headers);
      answer.pipe(res);
      answer.on('end', resolve);
      answer.on('error', resolve);
    });
    upstream.on('timeout', () => upstream.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    upstream.on('error', (error) => {
      if (!res.headersSent) {
        send(res, 502, error.code === 'ETIMEDOUT'
          ? { error: 'Listening Studio did not answer in time. Try again.', offline: false }
          : { error: 'Listening Studio is not running on this computer.', offline: true });
      } else res.destroy();
      resolve();
    });
    upstream.end(req.method === 'GET' ? undefined : body);
  });
}
