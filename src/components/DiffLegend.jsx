// The one legend for DiffText, wherever it appears. Per-sentence feedback and
// the results screen show the same marking, so they describe it in the same
// words — a student should never meet two explanations of one colour.
function DiffLegend() {
  return (
    <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
      <span className="word-extra">Red</span> = what you typed, followed by{' '}
      <span className="word-missed">green underline</span> = what it should have been. A green
      word on its own is one you left out.
    </p>
  );
}

export default DiffLegend;
