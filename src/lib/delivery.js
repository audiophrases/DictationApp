// Preserve the historical defaults for saved settings and older assignments.
export function deliveryFor({ delivery, mode } = {}) {
  if (delivery === 'phrases' || delivery === 'sentences') return delivery;
  return mode === 'notebook' ? 'phrases' : 'sentences';
}

/**
 * The delivery an assignment needs for what the splitting studio produced.
 * Splitting any sentence there makes a phrase dictation: for full-sentence
 * delivery the assignment server ignores phrases and keeps whole sentences,
 * so the reviewed audio would no longer match and could not be saved. The
 * studio never merges across sentences, so more segments than sentences means
 * a sentence was split.
 */
export function reviewedDelivery(delivery, sentenceCount, segments) {
  return delivery === 'sentences' && Array.isArray(segments) && segments.length > sentenceCount ? 'phrases' : delivery;
}

export function dictationUnit(settings) {
  return deliveryFor(settings) === 'phrases' ? 'segment' : 'sentence';
}
