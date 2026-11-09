import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';

// A stand-in for the Listening Studio: records what reaches it.
const seen = [];
const studio = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url.endsWith('.wav')) {
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Set-Cookie': 'x=1' });
      res.end(Buffer.from([82, 73, 70, 70, 0, 1, 2, 3]));
      return;
    }
    if (req.url === '/api/recordings/missing00') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Recording not found.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
});
await new Promise((resolve) => studio.listen(0, '127.0.0.1', resolve));
process.env.LISTENING_STUDIO_URL = `http://127.0.0.1:${studio.address().port}/`;
const { handleAppRequest } = await import('./routes.js');

const app = http.createServer((req, res) => {
  handleAppRequest(req, res).then((handled) => { if (!handled) { res.writeHead(418); res.end(); } });
});
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const port = app.address().port;
const host = `127.0.0.1:${port}`;
test.after(() => { app.close(); studio.close(); });

function call(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const json = { 'Content-Type': 'application/json' };
const sameSite = { Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin' };

test('the page on this computer reaches the studio, without its Origin', async () => {
  seen.length = 0;
  const res = await call('/api/listening-studio/recordings', { method: 'POST', headers: { ...json, ...sameSite }, body: '{"title":"x"}' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, url: '/api/recordings' });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].body, '{"title":"x"}');
  assert.equal(seen[0].headers.origin, undefined);
  assert.equal(seen[0].headers['sec-fetch-site'], undefined);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('every route a dictation needs passes; audio comes back as bytes', async () => {
  const id = 'abc123def456';
  for (const [method, path] of [['GET', 'status'], ['GET', 'library'], ['GET', 'library/4a334378fa22/audio'],
    ['POST', 'library/from-recording'], ['GET', `recordings/${id}`], ['PUT', `recordings/${id}`],
    ['POST', `recordings/${id}/make`], ['POST', 'stop']]) {
    const res = await call(`/api/listening-studio/${path}`, { method, headers: method === 'GET' ? {} : json, body: method === 'GET' ? undefined : '{}' });
    assert.equal(res.status, 200, `${method} ${path}`);
  }
  const wav = await call(`/api/listening-studio/recordings/${id}/audio/lines/0123abcd.wav`, { headers: sameSite });
  assert.equal(wav.status, 200);
  assert.equal(wav.headers['content-type'], 'audio/wav');
  assert.equal(wav.headers['set-cookie'], undefined);
  assert.deepEqual([...wav.body], [82, 73, 70, 70, 0, 1, 2, 3]);
  const missing = await call('/api/listening-studio/recordings/missing00');
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.body), { detail: 'Recording not found.' });
});

test('anything else in the studio stays out of reach', async () => {
  seen.length = 0;
  for (const [method, path] of [['DELETE', 'recordings/abc123def456'], ['POST', 'quit'], ['POST', 'library'],
    ['GET', 'phone'], ['POST', 'conversations'], ['GET', 'recordings'], ['GET', 'recordings/abc123def456/audio/out/x.mp3'],
    ['GET', 'recordings/../quit'], ['GET', 'recordings/ABC/audio/lines/x.wav'], ['GET', 'status/extra']]) {
    // Node's client sends a DELETE body unframed: the server would read it as the next request.
    const bodyless = method === 'GET' || method === 'DELETE';
    const res = await call(`/api/listening-studio/${path}`, { method, headers: bodyless ? {} : json, body: bodyless ? undefined : '{}' });
    // 403 when a rule refuses it first (a DELETE isn't JSON), else 404.
    assert.ok([403, 404].includes(res.status), `${method} ${path}: ${res.status}`);
  }
  assert.equal(seen.length, 0);
});

test('other sites, other hosts and form posts are refused', async () => {
  seen.length = 0;
  const evil = await call('/api/listening-studio/stop', { method: 'POST', headers: { ...json, Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(evil.status, 403);
  const crossSite = await call('/api/listening-studio/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  const form = await call('/api/listening-studio/stop', { method: 'POST', headers: { 'Content-Type': 'text/plain', ...sameSite }, body: '{}' });
  assert.equal(form.status, 403);
  // DNS rebinding: the right port, a hostile name.
  const rebound = await call('/api/listening-studio/status', { headers: { Host: `evil.example:${port}` } });
  assert.equal(rebound.status, 404);
  const big = await call('/api/listening-studio/recordings', { method: 'POST', headers: json, body: Buffer.alloc(1024 * 1024 + 10, 32) });
  assert.equal(big.status, 413);
  assert.equal(seen.length, 0);
  // The app's other routes keep their open CORS.
  assert.equal((await call('/health')).headers['access-control-allow-origin'], '*');
});

test('a studio that is not running says so', async () => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const deadPort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  // A fresh copy of the module, reading the dead address.
  process.env.LISTENING_STUDIO_URL = `http://127.0.0.1:${deadPort}/`;
  const { handleListeningStudioRequest } = await import(`./listeningStudio.js?dead=${deadPort}`);
  const server = http.createServer((req, res) => handleListeningStudioRequest(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const res = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/listening-studio/status', headers: { Host: '127.0.0.1' } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }).on('error', reject);
  });
  server.close();
  assert.equal(res.status, 502);
  assert.equal(res.body.offline, true);
  assert.match(res.body.error, /not running/);
});
