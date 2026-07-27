// Word-by-word marking of one sentence, shared by the student's results screen
// and the teacher's view of an attempt — so both are literally looking at the
// same rendering of the same numbers.
function DiffText({ segments }) {
  return (
    <>
      {segments.map((seg, i) => (
        <span key={i} className={seg.type === 'missed' ? 'word-missed' : seg.type === 'extra' ? 'word-extra' : ''}>
          {seg.words.join(' ')}
          {i < segments.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

export default DiffText;
