// Choices shared by the setup screen, the in-dictation selector, and the
// teacher's assignment form.

// SSML prosody rates passed through to the TTS backend.
export const SPEEDS = [
  { value: 1, name: 'Normal' },
  { value: 0.85, name: 'Relaxed' },
  { value: 0.7, name: 'Slow' },
];

export const LANGUAGES = [
  { code: 'ca-ES', name: 'Catalan' },
  { code: 'en-US', name: 'English' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'ar-MA', name: 'Moroccan Darija' },
  { code: 'pt-PT', name: 'Portuguese' },
  { code: 'ro-RO', name: 'Romanian' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'uk-UA', name: 'Ukrainian' },
];

// Wikipedia editions are only available for languages we can map server-side.
export const FETCH_SUPPORTED = new Set([
  'en-US', 'ca-ES', 'fr-FR', 'es-ES', 'de-DE', 'it-IT', 'pt-PT',
  'ar-MA', 'ru-RU', 'uk-UA', 'ro-RO',
]);

export const REPLAY_LIMITS = [
  { value: 0, name: 'Unlimited replays' },
  { value: 1, name: '1 replay per sentence' },
  { value: 2, name: '2 replays per sentence' },
  { value: 3, name: '3 replays per sentence' },
];

export function languageName(code) {
  return LANGUAGES.find((l) => l.code === code)?.name || 'this language';
}
