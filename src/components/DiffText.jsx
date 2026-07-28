import { orderForReview } from '../lib/score';

// Word-by-word marking of one sentence, shared by the student's results screen
// and the teacher's view of an attempt — so both are literally looking at the
// same rendering of the same numbers.
//
// Read in marking order: the mistake in red, then the correction in green after
// it. See orderForReview for why that differs from the diff's own order.
function DiffText({ segments }) {
  const ordered = orderForReview(segments);
  return (
    <>
      {ordered.map((seg, i) => (
        <span key={i} className={seg.type === 'missed' ? 'word-missed' : seg.type === 'extra' ? 'word-extra' : ''}>
          {seg.words.join(' ')}
          {i < ordered.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

export default DiffText;
