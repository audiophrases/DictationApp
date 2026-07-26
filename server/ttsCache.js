// Cache for synthesized speech, in front of the Microsoft Read Aloud endpoint.
//
// Why this exists: a class works through the SAME passage at the same time, so
// without a cache one sentence costs one upstream synthesis PER STUDENT. The
// browser's own HTTP cache can't help there (it's per-device), and it can't
// help a student who reloads or comes back the next day either.
//
// Three layers, cheapest first:
//   memory  — an LRU bounded by bytes; serves the common case with no I/O.
//   disk    — survives a restart, so the local portable pack replays a lesson
//             instantly on day two with no network at all.
//   in-flight coalescing — 25 students asking for the same new sentence at the
//             same moment produce ONE upstream call, not 25.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ~16 KB per short sentence, so this holds a few thousand of them.
const MEMORY_BUDGET_BYTES = 24 * 1024 * 1024;
const DISK_FILE_LIMIT = 4000;
const PRUNE_EVERY_WRITES = 200;

// Defaults to the OS temp dir because that is writable WITHOUT admin rights on
// every target: %TEMP% inside the student's own profile on Windows (the
// portable pack must never need elevation) and a normal writable path on the
// host. Override with TTS_CACHE_DIR to keep audio somewhere permanent.
const CACHE_DIR = process.env.TTS_CACHE_DIR || path.join(os.tmpdir(), 'dictationapp-tts');

// A read-only or otherwise unusable cache dir must not break synthesis — the
// disk layer just switches itself off and memory + coalescing carry on.
let diskEnabled = true;
try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch {
  diskEnabled = false;
}

// Insertion order IS the LRU order: a hit re-inserts at the end, and eviction
// takes from the front.
const memory = new Map();
let memoryBytes = 0;

function memoryGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  memory.delete(key);
  memory.set(key, hit);
  return hit;
}

function memoryPut(key, audio) {
  const existing = memory.get(key);
  if (existing) {
    memoryBytes -= existing.length;
    memory.delete(key);
  }
  memory.set(key, audio);
  memoryBytes += audio.length;

  while (memoryBytes > MEMORY_BUDGET_BYTES) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memoryBytes -= memory.get(oldest.value).length;
    memory.delete(oldest.value);
  }
}

/** Cache identity is exactly what changes the audio: voice, rate, text. */
export function cacheKey(voice, rate, text) {
  return crypto.createHash('sha256').update(`${voice}|${rate}|${text}`).digest('hex');
}

async function diskGet(key) {
  if (!diskEnabled) return null;
  try {
    return await fsp.readFile(path.join(CACHE_DIR, `${key}.mp3`));
  } catch {
    return null;
  }
}

let writesSincePrune = 0;

async function diskPut(key, audio) {
  if (!diskEnabled) return;
  const target = path.join(CACHE_DIR, `${key}.mp3`);
  // Write-then-rename so a crash mid-write can never leave a truncated mp3
  // that a later run would happily serve as a "cache hit".
  const temp = `${target}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(temp, audio);
    await fsp.rename(temp, target);
  } catch {
    try {
      await fsp.unlink(temp);
    } catch {
      // Nothing to clean up.
    }
    return;
  }

  if (++writesSincePrune >= PRUNE_EVERY_WRITES) {
    writesSincePrune = 0;
    prune().catch(() => {
      // Pruning is housekeeping; failing it must not affect the response.
    });
  }
}

async function prune() {
  if (!diskEnabled) return;
  const names = (await fsp.readdir(CACHE_DIR)).filter((n) => n.endsWith('.mp3'));
  if (names.length <= DISK_FILE_LIMIT) return;

  const stated = await Promise.all(
    names.map(async (name) => {
      const file = path.join(CACHE_DIR, name);
      try {
        return { file, mtime: (await fsp.stat(file)).mtimeMs };
      } catch {
        return null;
      }
    })
  );
  const sorted = stated.filter(Boolean).sort((a, b) => a.mtime - b.mtime);
  for (const { file } of sorted.slice(0, sorted.length - DISK_FILE_LIMIT)) {
    try {
      await fsp.unlink(file);
    } catch {
      // Already gone, or held open — either way, skip it.
    }
  }
}

const inFlight = new Map();

/**
 * Returns `{ audio, source }` for `key`, calling `synthesize()` only when no
 * layer has it and no identical request is already running. `source` is
 * 'memory' | 'disk' | 'coalesced' | 'synth' — reported back as an X-Cache
 * header, which is also how the smoke test proves the cache works.
 */
export async function getOrSynthesize(key, synthesize) {
  const cached = memoryGet(key);
  if (cached) return { audio: cached, source: 'memory' };

  const pending = inFlight.get(key);
  if (pending) {
    const [audio] = await pending;
    return { audio, source: 'coalesced' };
  }

  const work = (async () => {
    const onDisk = await diskGet(key);
    if (onDisk) {
      memoryPut(key, onDisk);
      return [onDisk, 'disk'];
    }
    const fresh = await synthesize();
    memoryPut(key, fresh);
    await diskPut(key, fresh);
    return [fresh, 'synth'];
  })();

  inFlight.set(key, work);
  try {
    const [audio, source] = await work;
    return { audio, source };
  } finally {
    inFlight.delete(key);
  }
}

/** Exposed for /health and for tests. */
export function cacheStats() {
  return { entries: memory.size, bytes: memoryBytes, diskEnabled, dir: diskEnabled ? CACHE_DIR : null };
}
