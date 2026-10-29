// The voice pads every recording with over a second of silence after the last
// word. Kept after the punctuation cue, that was dead air before the student
// could go on; keep only a short tail so the word doesn't stop abruptly.
const SILENCE = 0.01;
const TAIL_SECONDS = 0.15;
// Give the audio output time to wake before a short first word is spoken.
// Keep every source sample, including quiet consonants; never fade or trim it.
const LEAD_IN_SECONDS = 0.4;
export function trimTrailingSilence(samples, sampleRate) {
  let last = samples.length - 1;
  while (last >= 0 && Math.abs(samples[last]) < SILENCE) last--;
  return samples.subarray(0, Math.min(samples.length, last + 1 + Math.round(TAIL_SECONDS * sampleRate)));
}

// Append the cue's samples to the segment's samples, with an audible pause.
// The WAV is one clip, so Space repeats the phrase and cue together and the
// assignment server counts them as one play. Text answers never include cues.
export function wavClip(buffer, start, end, cue = null) {
  const first = Math.floor(start * buffer.sampleRate);
  const last = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  const samples = buffer.getChannelData(0).subarray(first, last);
  if (cue && cue.sampleRate !== buffer.sampleRate) throw new Error('Punctuation audio uses a different sample rate.');
  const leadIn = Math.round(LEAD_IN_SECONDS * buffer.sampleRate);
  const gap = cue ? Math.round(0.35 * buffer.sampleRate) : 0;
  const cueSamples = cue && trimTrailingSilence(cue.getChannelData(0), cue.sampleRate);
  const length = leadIn + samples.length + gap + (cueSamples?.length || 0);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const tag = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVE'); tag(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, length * 2, true);
  const write = (values, offset) => values.forEach((sample, i) => view.setInt16(44 + (offset + i) * 2,
    Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
  write(samples, leadIn);
  if (cueSamples) write(cueSamples, leadIn + samples.length + gap);
  return new Blob([bytes], { type: 'audio/wav' });
}
