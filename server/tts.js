import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { cacheKey, getOrSynthesize } from './ttsCache.js';

// Extracted from vite.config.js so the exact same handler can run under the
// Vite dev/preview server (local development) AND the standalone production
// server (server/serve.js) used by the local .bat launcher and by Render.
export const VOICES = {
  'en-US': 'en-US-JennyNeural',
  'ca-ES': 'ca-ES-JoanaNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'de-DE': 'de-DE-KatjaNeural',
  'it-IT': 'it-IT-ElsaNeural',
  'pt-PT': 'pt-PT-RaquelNeural',
  'ar-MA': 'ar-MA-MounaNeural',
  'ru-RU': 'ru-RU-SvetlanaNeural',
  'uk-UA': 'uk-UA-PolinaNeural',
  'ro-RO': 'ro-RO-AlinaNeural',
};

const DEFAULT_VOICE = VOICES['en-US'];

// A single sentence is all this ever needs to say. The endpoint is unauthenticated
// on a public deploy, so cap the input rather than forwarding anything upstream
// (and cacheing it) on request.
const MAX_TEXT_LENGTH = 3000;

async function synthesize(voice, rate, text) {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, rate !== 1 ? { rate } : undefined);

    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
}

export async function handleTTSRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const text = url.searchParams.get('text') || '';
    const lang = url.searchParams.get('lang') || 'en-US';
    // SSML prosody rate: 1 = normal speed, 0.7 = slow. Clamp to a sane range.
    const rateParam = parseFloat(url.searchParams.get('rate'));
    const rate = Number.isFinite(rateParam) ? Math.min(1.5, Math.max(0.5, rateParam)) : 1;

    if (!text) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing text parameter' }));
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      res.statusCode = 413;
      res.end(JSON.stringify({ error: `Text too long (max ${MAX_TEXT_LENGTH} characters)` }));
      return;
    }

    const voice = VOICES[lang] || DEFAULT_VOICE;

    // Repeats — a replay, the next student on the same passage, the same lesson
    // tomorrow — are served from the cache without touching the network.
    const { audio, source } = await getOrSynthesize(cacheKey(voice, rate, text), () =>
      synthesize(voice, rate, text)
    );

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audio.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Voice', voice);
    res.setHeader('X-Cache', source);
    res.end(audio);
  } catch (error) {
    console.error('TTS Error:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'TTS Synthesis failed', details: error.message }));
  }
}
