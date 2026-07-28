// Where a score sits on the good / fair / poor scale, as a CSS class. One
// definition, so a percentage is coloured the same on the student's results
// screen and in the teacher's tables.
export function accuracyClass(accuracy) {
  if (accuracy >= 0.9) return 'badge-good';
  if (accuracy >= 0.7) return 'badge-ok';
  return 'badge-poor';
}

/**
 * Puts a substitution in the order a teacher marks one: the mistake first, then
 * the correction after it.
 *
 * The diff emits the original word before the typed one, which reads backwards
 * on screen — "Lava lava" looks like the correction is being repeated wrongly,
 * rather than "lava" being wrong and "Lava" being the fix. Swapping each
 * missed/extra pair gives "lava Lava": what the student wrote, then what it
 * should have been.
 *
 * Presentation only, so it also fixes attempts already stored in R2 — their
 * segments keep the diff's own order.
 */
export function orderForReview(segments) {
  const ordered = [];
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i];
    const next = segments[i + 1];
    // A run of correct words never moves; only a missed word immediately
    // replaced by a typed one is a substitution worth reordering.
    if (current.type === 'missed' && next?.type === 'extra') {
      ordered.push(next, current);
      i += 1;
    } else {
      ordered.push(current);
    }
  }
  return ordered;
}
