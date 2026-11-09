// Match characters: the voice can tokenize contractions differently.
const normalized = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

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

// direction -1 sends the left phrase's last word to the next phrase;
// +1 brings the right phrase's first word into the previous phrase.
export function moveSplitWord(recording, splitIndex, direction) {
  const { segments, boundaries, buffer } = recording;
  if (!Number.isInteger(splitIndex) || splitIndex < 1 || splitIndex >= segments.length
    || ![-1, 1].includes(direction)) throw new Error('Invalid word move.');
  const left = segments[splitIndex - 1].trim().split(/\s+/u);
  const right = segments[splitIndex].trim().split(/\s+/u);
  if ((direction === -1 ? left : right).length < 2) throw new Error('Keep at least one word in each phrase.');
  if (direction === -1) right.unshift(left.pop());
  else left.push(right.shift());
  const next = segments.slice();
  next[splitIndex - 1] = left.join(' ');
  next[splitIndex] = right.join(' ');
  let suggested, warning = recording.warning;
  try { suggested = sentenceCuts(next, boundaries, buffer.duration); }
  catch (error) {
    suggested = estimatedCuts(next, buffer.duration);
    warning = error.message;
  }
  // Preserve manual timing adjustments at unrelated boundaries where possible.
  let cuts = recording.cuts.slice();
  cuts[splitIndex] = suggested[splitIndex];
  try { validateCuts(cuts, next.length, buffer.duration); }
  catch {
    cuts = suggested;
    warning = 'Nearby timing adjustments overlapped the new word split. Check the updated splits by ear.';
  }
  return { ...recording, segments: next, cuts, warning, checked: !warning };
}
