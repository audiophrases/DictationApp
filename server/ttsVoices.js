// Voice table and selection for /api/tts, kept free of network/SDK imports so
// it can be unit-tested directly.
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

export const DEFAULT_VOICE = VOICES['en-US'];

// Optional English voices a caller may request by exact name. Anything not on
// this list is ignored, so the endpoint can never be pointed at arbitrary voices.
export const SELECTABLE_VOICES = [
  'en-US-EmmaMultilingualNeural',
  'en-US-AndrewMultilingualNeural',
  'en-US-AvaMultilingualNeural',
  'en-US-BrianMultilingualNeural',
];

export function resolveVoice(lang, requested) {
  if (lang === 'en-US' && SELECTABLE_VOICES.includes(requested)) return requested;
  return VOICES[lang] || DEFAULT_VOICE;
}
