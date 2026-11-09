// Match characters: the voice can tokenize contractions differently.
const normalized = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const wordsOf = (text) => text.trim().split(/\s+/u).filter(Boolean);

export function sentenceCuts(segments, boundaries, duration) {
  if (!Number.isFinite(duration) || duration <= 0 || !segments.length) throw new Error('Invalid sentence audio.');
  if (segments.length === 1) return [0, duration];
  if (!Array.isArray(boundaries) || !boundaries.length) throw new Error('No word timings.');
  let previous = -1;
  const words = boundaries.filter((word) => normalized(word.text || ''));
  for (const word of words) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previous
      || word.start < 0 || word.end <= word.start || word.end > duration + 0.1) throw new Error('Invalid word timings.');
    previous = word.start;
  }
  if (words.map((w) => normalized(w.text)).join('') !== segments.map(normalized).join('')) {
    throw new Error('Word timings do not match the text. Adjust the estimated splits by ear.');
  }
  const ends = [];
  let length = 0;
  words.forEach((w) => { length += normalized(w.text).length; ends.push(length); });
  let target = 0;
  const cuts = [0];
  for (const segment of segments.slice(0, -1)) {
    target += normalized(segment).length;
    const index = ends.indexOf(target);
    if (index < 0 || !words[index + 1]) throw new Error('A split falls inside a spoken word. Adjust the estimated splits by ear.');
    // Shared boundaries preserve all samples, including quiet consonants.
    cuts.push((words[index].end + words[index + 1].start) / 2);
  }
  cuts.push(duration);
  validateCuts(cuts, segments.length, duration);
  return cuts;
}

export function validateCuts(cuts, count, duration) {
  if (!Array.isArray(cuts) || cuts.length !== count + 1 || cuts[0] !== 0 || cuts.at(-1) !== duration
    || cuts.some((cut, i) => !Number.isFinite(cut) || (i > 0 && cut <= cuts[i - 1]))) {
    throw new Error('Split points must stay in order within the sentence.');
  }
}

export function estimatedCuts(segments, duration) {
  const weights = segments.map((s) => Math.max(1, normalized(s).length));
  const total = weights.reduce((a, b) => a + b, 0);
  let used = 0;
  return [0, ...weights.slice(0, -1).map((weight) => { used += weight; return duration * used / total; }), duration];
}

// ---------------------------------------------------------------- pauses
// Audio without word timings (human takes, Listening Studio voices) is cut
// at the quietest moment near a character-weighted estimate: speakers pause
// between phrases, so this usually lands in the gap a listener would choose.
const FRAME = 0.02; // RMS window, seconds
const HOP = 0.01;
// Never cut closer than this to a neighbouring cut.
const MIN_PHRASE = 0.05;

function rmsAt(samples, sampleRate, time) {
  const half = Math.round(FRAME * sampleRate / 2);
  const centre = Math.round(time * sampleRate);
  const from = Math.max(0, centre - half);
  const to = Math.min(samples.length, centre + half);
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}

// [start, end] in seconds of the audible speech, ignoring leading and
// trailing silence (same thresholds as PinPlay's take trim).
export function speechBounds(samples, sampleRate) {
  const duration = samples.length / sampleRate;
  const levels = [];
  for (let t = FRAME / 2; t < duration; t += HOP) levels.push(rmsAt(samples, sampleRate, t));
  if (!levels.length) return [0, duration];
  const sorted = levels.slice().sort((a, b) => a - b);
  const threshold = Math.max(sorted[Math.floor(sorted.length * 0.1)] * 3, sorted.at(-1) * 0.1, 0.003);
  const first = levels.findIndex((v) => v > threshold);
  if (first < 0) return [0, duration];
  let last = levels.length - 1;
  while (levels[last] <= threshold) last--;
  return [Math.max(0, first * HOP), Math.min(duration, last * HOP + FRAME)];
}

// The middle of the quietest stretch within `reach` seconds of `time`,
// staying inside (min, max). Returns `time` (clamped) when there is no room.
export function quietestNear(samples, sampleRate, time, min, max, reach = 0.35) {
  const lo = Math.max(min, time - reach);
  const hi = Math.min(max, time + reach);
  if (!(hi > lo)) return Math.min(Math.max(time, min), max);
  const times = [];
  for (let t = lo; t <= hi; t += HOP) times.push(t);
  const levels = times.map((t) => rmsAt(samples, sampleRate, t));
  let best = 0;
  levels.forEach((level, i) => { if (level < levels[best]) best = i; });
  // Centre on the whole quiet run, not its first frame: a long pause is cut
  // in its middle so both phrases keep a little air.
  const quiet = levels[best] * 1.6 + 0.002;
  let from = best, to = best;
  while (from > 0 && levels[from - 1] <= quiet) from--;
  while (to < levels.length - 1 && levels[to + 1] <= quiet) to++;
  return (times[from] + times[to]) / 2;
}

export function pauseCuts(segments, samples, sampleRate) {
  const duration = samples.length / sampleRate;
  if (!segments.length || !(duration > 0)) throw new Error('Invalid sentence audio.');
  if (segments.length === 1) return [0, duration];
  const [start, end] = speechBounds(samples, sampleRate);
  const guess = estimatedCuts(segments, end - start).map((cut) => start + cut);
  guess[0] = 0;
  guess[guess.length - 1] = duration;
  const cuts = [0];
  for (let i = 1; i < segments.length; i++) {
    const span = Math.min(guess[i] - guess[i - 1], guess[i + 1] - guess[i]);
    cuts.push(quietestNear(samples, sampleRate, guess[i], cuts[i - 1] + MIN_PHRASE, guess[i + 1] - MIN_PHRASE,
      Math.min(0.6, span * 0.45)));
  }
  cuts.push(duration);
  try { validateCuts(cuts, segments.length, duration); return cuts; }
  catch { return estimatedCuts(segments, duration); }
}

// One new boundary between `lo` and `hi` (neighbouring cuts), from how much
// text falls on each side, then moved to the nearest pause.
function cutBetween(buffer, lo, hi, leftText, rightText) {
  const samples = buffer.getChannelData(0);
  const [start, end] = speechBounds(samples, buffer.sampleRate);
  // Spread over the speech inside this span, not its leading/trailing silence.
  const [from, to] = Math.min(hi, end) > Math.max(lo, start) ? [Math.max(lo, start), Math.min(hi, end)] : [lo, hi];
  const left = Math.max(1, normalized(leftText).length);
  const right = Math.max(1, normalized(rightText).length);
  const guess = from + (to - from) * left / (left + right);
  const room = Math.min(guess - lo, hi - guess);
  return quietestNear(samples, buffer.sampleRate, guess, lo + MIN_PHRASE, hi - MIN_PHRASE, Math.min(0.6, Math.max(0, room * 0.6)));
}

// Exact cut from word timings where the voice gave them; otherwise an
// estimate at a pause, flagged for a listening check.
function newCut(recording, segments, splitIndex, lo, hi) {
  const { boundaries, buffer } = recording;
  if (Array.isArray(boundaries) && boundaries.length) {
    try {
      const cut = sentenceCuts(segments, boundaries, buffer.duration)[splitIndex];
      if (cut > lo && cut < hi) return { cut, exact: true };
    } catch { /* fall through to an estimate */ }
  }
  return { cut: cutBetween(buffer, lo, hi, segments[splitIndex - 1], segments[splitIndex]), exact: false };
}

const ESTIMATED = 'A split was placed at a pause, without word timings. Listen to both phrases and adjust it by ear.';

// direction -1 sends the left phrase's last word to the next phrase;
// +1 brings the right phrase's first word into the previous phrase.
export function moveSplitWord(recording, splitIndex, direction) {
  const { segments, cuts } = recording;
  if (!Number.isInteger(splitIndex) || splitIndex < 1 || splitIndex >= segments.length
    || ![-1, 1].includes(direction)) throw new Error('Invalid word move.');
  const left = wordsOf(segments[splitIndex - 1]);
  const right = wordsOf(segments[splitIndex]);
  if ((direction === -1 ? left : right).length < 2) throw new Error('Keep at least one word in each phrase.');
  if (direction === -1) right.unshift(left.pop());
  else left.push(right.shift());
  const next = segments.slice();
  next[splitIndex - 1] = left.join(' ');
  next[splitIndex] = right.join(' ');
  // Preserve manual timing adjustments at unrelated boundaries.
  const { cut, exact } = newCut(recording, next, splitIndex, cuts[splitIndex - 1], cuts[splitIndex + 1]);
  const nextCuts = cuts.slice();
  nextCuts[splitIndex] = cut;
  validateCuts(nextCuts, next.length, recording.buffer.duration);
  const warning = exact ? recording.warning : recording.warning || ESTIMATED;
  return { ...recording, segments: next, cuts: nextCuts, warning, checked: !warning };
}

// Removes the split before phrase `splitIndex`: it and the phrase before it
// become one. The audio is unchanged, so earlier listening checks still hold.
export function mergeSplit(recording, splitIndex) {
  const { segments, cuts } = recording;
  if (!Number.isInteger(splitIndex) || splitIndex < 1 || splitIndex >= segments.length) throw new Error('Invalid merge.');
  const next = segments.slice();
  next.splice(splitIndex - 1, 2, `${segments[splitIndex - 1].trim()} ${segments[splitIndex].trim()}`);
  const nextCuts = cuts.slice();
  nextCuts.splice(splitIndex, 1);
  return { ...recording, segments: next, cuts: nextCuts };
}

// One phrase for the whole sentence.
export function mergeAll(recording) {
  return { ...recording, segments: [recording.segments.map((s) => s.trim()).join(' ')], cuts: [0, recording.buffer.duration] };
}

// Splits phrase `segmentIndex` after its first `wordCount` words.
export function splitSegment(recording, segmentIndex, wordCount) {
  const { segments, cuts } = recording;
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= segments.length) throw new Error('Invalid split.');
  const words = wordsOf(segments[segmentIndex]);
  if (!Number.isInteger(wordCount) || wordCount < 1 || wordCount >= words.length) throw new Error('Choose a gap between two words.');
  const next = segments.slice();
  next.splice(segmentIndex, 1, words.slice(0, wordCount).join(' '), words.slice(wordCount).join(' '));
  const lo = cuts[segmentIndex];
  const hi = cuts[segmentIndex + 1];
  if (hi - lo < MIN_PHRASE * 2) throw new Error('This phrase is too short to split.');
  const { cut, exact } = newCut(recording, next, segmentIndex + 1, lo, hi);
  const nextCuts = cuts.slice();
  nextCuts.splice(segmentIndex + 1, 0, cut);
  validateCuts(nextCuts, next.length, recording.buffer.duration);
  const warning = exact ? recording.warning : recording.warning || ESTIMATED;
  return { ...recording, segments: next, cuts: nextCuts, warning, checked: !warning };
}
