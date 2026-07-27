// Where a score sits on the good / fair / poor scale, as a CSS class. One
// definition, so a percentage is coloured the same on the student's results
// screen and in the teacher's tables.
export function accuracyClass(accuracy) {
  if (accuracy >= 0.9) return 'badge-good';
  if (accuracy >= 0.7) return 'badge-ok';
  return 'badge-poor';
}
