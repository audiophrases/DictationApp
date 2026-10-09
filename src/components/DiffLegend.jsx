// The one legend for DiffText, wherever it appears. Per-sentence feedback, the
// results screen and the teacher's attempt view show the same marking, so they
// describe it with the same sample tiles — a student should never meet two
// explanations of one colour. Missed and extra words label themselves, so only
// the corrected word needs a key.
function DiffLegend({ typedBy = 'you' }) {
  return (
    <div className="mark-legend">
      <span className="mark-tile mark-wrong mark-sample" aria-hidden="true">
        <span className="mark-main">house</span>
        <span className="mark-note mark-typed">hause</span>
      </span>
      <span>
        <strong className="badge-good">Green</strong> is the right word.{' '}
        <strong className="badge-poor">Crossed out</strong> underneath is what {typedBy} typed.
      </span>
    </div>
  );
}

export default DiffLegend;
