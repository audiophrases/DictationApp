import { reviewTiles } from '../lib/score';

// Word-by-word marking of one sentence, shared by per-sentence feedback, the
// student's results screen and the teacher's view of an attempt — so all three
// are literally looking at the same rendering of the same numbers.
//
// Marked the way a teacher corrects on paper: the sentence reads in order, a
// wrong word shows the right one with what was typed crossed out beneath it,
// a missed word is boxed in, and a word that doesn't belong is struck through.
// `typedBy` only changes the hover text, for the teacher's view.
function DiffText({ segments, typedBy = 'You' }) {
  const tiles = reviewTiles(segments);
  let mistake = 0;
  return (
    <span className="marked-sentence">
      {tiles.map((tile, i) => {
        const gap = i < tiles.length - 1 ? ' ' : '';
        if (tile.kind === 'right') return <span key={i}>{tile.expected}{gap}</span>;
        // Staggers the mistakes in one after another, so the eye is drawn
        // along the sentence to each of them in turn.
        const style = { '--i': mistake++ };
        if (tile.kind === 'wrong') {
          return (
            <span key={i}>
              <span className="mark-tile mark-wrong" style={style} title={`${typedBy} wrote “${tile.typed}” — it should be “${tile.expected}”`}>
                <span className="mark-main">{tile.expected}</span>
                <span className="mark-note mark-typed">{tile.typed}</span>
              </span>
              {gap}
            </span>
          );
        }
        if (tile.kind === 'missing') {
          return (
            <span key={i}>
              <span className="mark-tile mark-missing" style={style} title={`“${tile.expected}” was left out`}>
                <span className="mark-main">{tile.expected}</span>
                <span className="mark-note">missed</span>
              </span>
              {gap}
            </span>
          );
        }
        return (
          <span key={i}>
            <span className="mark-tile mark-extra" style={style} title={`“${tile.typed}” isn't in the sentence`}>
              <span className="mark-main">{tile.typed}</span>
              <span className="mark-note">extra</span>
            </span>
            {gap}
          </span>
        );
      })}
    </span>
  );
}

export default DiffText;
