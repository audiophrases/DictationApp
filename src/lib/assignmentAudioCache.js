// Page-local encrypted bytes: no files or persistent storage on shared devices.
// Two downloads at a time leave bandwidth for playback and answer saves.
export class AssignmentAudioCache {
  constructor({ urlFor, fetchImpl = fetch, maxBytes = 64 * 1024 * 1024, concurrency = 2, timeoutMs = 20000 }) {
    this.urlFor = urlFor;
    this.fetchImpl = fetchImpl;
    this.maxBytes = maxBytes;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.clips = new Map();
    this.attempted = new Set();
    this.active = new Map();
    this.queue = [];
    this.bytes = 0;
    this.closed = false;
    this.waiters = [];
  }

  prefetch(count, currentIndex) {
    if (this.closed) return Promise.resolve();
    this.count = count;
    this.currentIndex = currentIndex;
    // Upcoming clips first, then earlier clips for notebook navigation/repeats.
    // Moving ahead reprioritizes queued work without restarting downloads.
    const order = Array.from({ length: count }, (_, offset) => (currentIndex + 1 + offset) % count);
    this.queue = order.filter((index) => !this.attempted.has(index));
    this.drain();
    if (!this.active.size && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  get(index) {
    const clip = this.clips.get(index);
    if (clip) {
      this.clips.delete(index);
      this.clips.set(index, clip);
    }
    return clip;
  }

  delete(index) {
    const clip = this.clips.get(index);
    if (clip) this.bytes -= clip.bytes.byteLength;
    this.clips.delete(index);
  }

  distance(index) {
    return index >= this.currentIndex ? index - this.currentIndex : this.count + this.currentIndex - index;
  }

  drain() {
    while (!this.closed && this.queue.length && this.active.size < this.concurrency) {
      const index = this.queue.shift();
      this.attempted.add(index);
      const controller = new AbortController();
      this.active.set(index, controller);
      this.download(index, controller).finally(() => {
        this.active.delete(index);
        this.drain();
      });
    }
    if (!this.active.size && !this.queue.length) {
      for (const resolve of this.waiters.splice(0)) resolve();
    }
  }

  async download(index, controller) {
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.urlFor(index), { signal: controller.signal, cache: 'no-store', priority: 'low' });
      if (!response.ok) {
        await response.body?.cancel();
        return;
      }
      const version = response.headers.get('X-Audio-Version');
      const type = response.headers.get('X-Audio-Type');
      if (!version || !type) {
        await response.body?.cancel();
        return;
      }
      const bytes = await response.arrayBuffer();
      if (this.closed || controller.signal.aborted || bytes.byteLength <= 28 || bytes.byteLength > this.maxBytes) return;
      // A large notebook must not fill the budget with far-away clips and
      // evict the very next segment. Keep current/upcoming audio nearest first.
      while (this.bytes + bytes.byteLength > this.maxBytes) {
        const farthest = [...this.clips.keys()].reduce((worst, key) => this.distance(key) > this.distance(worst) ? key : worst);
        if (this.distance(index) >= this.distance(farthest)) return;
        this.delete(farthest);
      }
      this.clips.set(index, { bytes, version, type });
      this.bytes += bytes.byteLength;
    } catch {
      // A miss or failed preload uses the original streaming playback route.
    } finally {
      clearTimeout(timer);
    }
  }

  dispose() {
    this.closed = true;
    this.queue = [];
    for (const controller of this.active.values()) controller.abort();
    this.clips.clear();
    this.bytes = 0;
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}
