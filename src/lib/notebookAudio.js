import { ttsBase } from './api';
import { notebookPlan, segmentTimes } from './notebook';

// PCM keeps the complete voice recording's phrasing, without synthesizing
// isolated fragments. Mono 16-bit WAV is supported by the assignment player.
function wavClip(buffer, start, end) {
  const first = Math.floor(start * buffer.sampleRate);
  const last = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  const samples = buffer.getChannelData(0).subarray(first, last);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const tag = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVE'); tag(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function prepareNotebookSentence(sentence, { lang, rate, context }) {
  const query = new URLSearchParams({ text: sentence, lang, rate, timings: '1' });
  const response = await fetch(`${ttsBase()}/api/tts?${query}`);
  if (!response.ok) throw new Error(`Could not record notebook audio (${response.status}). Please try again.`);
  const data = await response.json();
  const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
  const buffer = await context.decodeAudioData(bytes.buffer);
  // Decide the segments after the complete natural sentence has been recorded.
  const [{ segments }] = notebookPlan(sentence);
  return segmentTimes(segments, data.boundaries, buffer.duration)
    .map(([start, end]) => wavClip(buffer, start, end));
}

export async function prepareNotebook(text, settings, onProgress) {
  const context = new AudioContext({ sampleRate: 24000 });
  const clips = [];
  try {
    const plan = notebookPlan(text);
    for (let i = 0; i < plan.length; i++) {
      clips.push(...await prepareNotebookSentence(plan[i].sentence, { ...settings, context }));
      onProgress?.(i + 1, plan.length);
    }
    return clips;
  } finally {
    await context.close();
  }
}
