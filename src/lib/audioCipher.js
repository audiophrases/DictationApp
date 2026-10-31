// Preloaded audio stays encrypted until a metered play releases this clip's
// key. The wire format is a 12-byte AES-GCM IV followed by ciphertext and tag.
export const AUDIO_IV_BYTES = 12;

export function encodeAudioKey(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export function decodeAudioKey(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function decryptAudio(bytes, encodedKey, type) {
  const key = await crypto.subtle.importKey('raw', decodeAudioKey(encodedKey), 'AES-GCM', false, ['decrypt']);
  const data = new Uint8Array(bytes);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, AUDIO_IV_BYTES) }, key, data.subarray(AUDIO_IV_BYTES)
  );
  return new Blob([plaintext], { type });
}
