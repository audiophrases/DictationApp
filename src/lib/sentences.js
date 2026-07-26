/**
 * Split a passage into sentences for dictation.
 * Line breaks always end a sentence (poems, lists), and text without a
 * terminal . ! ? is kept as its own sentence instead of being dropped.
 * Closing quotes/brackets after the punctuation stay attached.
 */
export function splitIntoSentences(text) {
  const sentences = [];
  for (const line of (text || '').split(/\n+/)) {
    const parts = line.match(/[^.!?]*[.!?]+["'”’»)\]]*\s*|[^.!?]+$/g) || [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) sentences.push(trimmed);
    }
  }
  return sentences;
}

export function countWords(text) {
  const trimmed = (text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
