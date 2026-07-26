import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

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

    const voice = VOICES[lang] || DEFAULT_VOICE;

    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text, rate !== 1 ? { rate } : undefined);

      const chunks = [];
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Voice', voice);
      res.end(audioBuffer);
    } finally {
      tts.close();
    }
  } catch (error) {
    console.error('TTS Error:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'TTS Synthesis failed', details: error.message }));
  }
}
