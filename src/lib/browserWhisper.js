// Word timings for a recording, found in the teacher's own browser: a small
// Whisper model (transformers.js, ONNX) transcribes the take with word-level
// timestamps, and wordAlignment.js matches the heard words to the sentence
// we already know. Nothing leaves the computer and no server is involved;
// the model is downloaded once (about 60 MB) and kept in the browser cache.
//
// The transcript is never shown or trusted: a misheard word only costs an
// interpolated timing. Where too little is recognised, the caller keeps its
// pause-based cuts.
import { alignedBoundaries } from './wordAlignment';

export const WHISPER_MODEL = 'onnx-community/whisper-base_timestamped';
const WHISPER_RATE = 16000;
// This model's word timestamps run late by a steady amount: measured against
// Edge TTS word boundaries (English, 14 words), starts were 0.14–0.42 s late,
// ends 0.15–0.43 s, both averaging 0.25 s; chunking made no difference. The
// words are shifted earlier by that much (after which they were within
// ±0.17 s), and the splitting studio then settles each cut on the quietest
// moment within ±0.12 s (refineCuts). To re-measure: feed Edge TTS speech
// with `timings=1` through the human-take path and compare the words pushed
// to `globalThis.__dictationHeard` with the TTS boundaries.
export const RECOGNISED_LATE = 0.25;

// Whisper's two-letter codes for the dictation languages.
export const whisperLanguage = (lang) => String(lang || 'en').split('-')[0].toLowerCase();

let loading = null;

/** The transcriber, loaded once; `onProgress` gets download percentages. */
export function loadTranscriber(onProgress) {
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      const seen = new Map();
      return pipeline('automatic-speech-recognition', WHISPER_MODEL, {
        progress_callback: (event) => {
          if (event.status === 'progress' && event.file) seen.set(event.file, [event.loaded || 0, event.total || 0]);
          if (!onProgress) return;
          let loaded = 0;
          let total = 0;
          for (const [l, t] of seen.values()) { loaded += l; total += t; }
          if (event.status === 'progress' && total) onProgress(Math.min(99, Math.round(loaded / total * 100)));
          if (event.status === 'ready') onProgress(100);
        },
      });
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

// Whisper listens at 16 kHz mono.
export async function toWhisperRate(buffer) {
  if (buffer.sampleRate === WHISPER_RATE && buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const length = Math.ceil(buffer.duration * WHISPER_RATE);
  const offline = new OfflineAudioContext(1, length, WHISPER_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

/** The words Whisper heard in `buffer`, each with start and end in seconds. */
export async function transcribeWords(buffer, lang, { transcriber } = {}) {
  // A test hook: the page may supply its own recogniser.
  if (typeof globalThis.__dictationTranscribe === 'function') return globalThis.__dictationTranscribe(buffer, lang);
  const asr = transcriber || await loadTranscriber();
  const samples = await toWhisperRate(buffer);
  // A take is one sentence, within Whisper's 30 s window; only a longer one
  // is chunked (chunking with a stride shifts the timestamps).
  const output = await asr(samples, {
    language: whisperLanguage(lang), task: 'transcribe', return_timestamps: 'word',
    ...(buffer.duration > 28 ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
  });
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  const words = chunks.map((chunk, i) => {
    const start = Number(chunk.timestamp?.[0]);
    const end = Number.isFinite(chunk.timestamp?.[1]) ? Number(chunk.timestamp[1])
      : Number.isFinite(chunks[i + 1]?.timestamp?.[0]) ? Number(chunks[i + 1].timestamp[0]) : buffer.duration;
    return { text: String(chunk.text || '').trim(), start: Math.max(0, start - RECOGNISED_LATE), end: Math.max(0.01, end - RECOGNISED_LATE) };
  }).filter((word) => word.text && Number.isFinite(word.start));
  // For measuring the recogniser against known timings (tests, debugging).
  if (Array.isArray(globalThis.__dictationHeard)) globalThis.__dictationHeard.push({ lang, words });
  return words;
}

/**
 * Word boundaries for each take, or null where the sentence was not
 * recognised well enough. `onProgress(text)` reports the download and each
 * sentence. Never throws for one bad take: the caller falls back per sentence.
 */
export async function alignTakes(takes, lang, { onProgress, signal } = {}) {
  const say = (text) => onProgress?.(text);
  let transcriber;
  if (typeof globalThis.__dictationTranscribe !== 'function') {
    transcriber = await loadTranscriber((percent) => say(`Downloading the speech model… ${percent}%`));
  }
  const found = [];
  for (let i = 0; i < takes.length; i++) {
    if (signal?.aborted) return found;
    say(`Finding the words in sentence ${i + 1} of ${takes.length}…`);
    const { sentence, buffer } = takes[i];
    try {
      const heard = await transcribeWords(buffer, lang, { transcriber });
      found.push(alignedBoundaries(sentence, heard, buffer.duration));
    } catch {
      found.push(null);
    }
  }
  return found;
}
