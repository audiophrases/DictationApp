import { AUDIO_IV_BYTES, decodeAudioKey, encodeAudioKey } from '../src/lib/audioCipher.js';

export function newAudioSecret() {
  return encodeAudioKey(crypto.getRandomValues(new Uint8Array(32)));
}

// Every recording version and segment has a different key, derived from a
// server-only secret belonging to this attempt. Releasing one key cannot
// unlock another segment, another attempt, or a replacement recording.
export async function audioClipKey(attempt, index, version) {
  const secret = await crypto.subtle.importKey(
    'raw', decodeAudioKey(attempt.audioSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(
    JSON.stringify(['dictation-audio-v1', attempt.code, index, version])
  ));
}

export async function encryptAudio(bytes, rawKey) {
  const iv = crypto.getRandomValues(new Uint8Array(AUDIO_IV_BYTES));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return new Blob([iv, encrypted]);
}
