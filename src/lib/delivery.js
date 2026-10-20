// Preserve the historical defaults for saved settings and older assignments.
export function deliveryFor({ delivery, mode } = {}) {
  if (delivery === 'phrases' || delivery === 'sentences') return delivery;
  return mode === 'notebook' ? 'phrases' : 'sentences';
}

export function dictationUnit(settings) {
  return deliveryFor(settings) === 'phrases' ? 'segment' : 'sentence';
}
