import { useEffect, useRef } from 'react';
import { ArrowRight, CloudOff } from 'lucide-react';
import DiffText from './DiffText';
import DiffLegend from './DiffLegend';
import { accuracyClass } from '../lib/score';

// One sentence's marking, shown in place of the answer box between sentences
// when feedback is per-sentence. It is the same DiffText the results screen
// uses, so what the student reads here is exactly what they will see at the
// end, not a second opinion.
//
// `grade` is null when an assignment's marks did not come back (the save
// failed). The panel still appears then, with nothing to show: the student's
// click to continue is what starts the next sentence, and that has to stay a
// click for the audio to be allowed to play (see useAssignmentAudio).
function SentenceFeedback({ grade, onContinue, isLast }) {
  const buttonRef = useRef(null);
  // The answer box just lost focus along with the sentence, so focus lands on
  // the one thing to do next and Enter keeps meaning "carry on". But a second
  // Enter arriving right behind the one that submitted the answer — a double
  // tap, a held key — would land here and skip the marks, which are the
  // whole point. Ignore quick activation and repeated keydown events, including
  // repeats from a key held down longer than the initial delay.
  const readyRef = useRef(false);
  useEffect(() => {
    buttonRef.current?.focus();
    const timer = setTimeout(() => {
      readyRef.current = true;
    }, 400);
    return () => clearTimeout(timer);
  }, []);
  const carryOn = () => {
    if (!readyRef.current) return;
    readyRef.current = false;
    onContinue();
  };
  const handleKeyDown = (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  };

  const next = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
      <button ref={buttonRef} className="btn-primary" onClick={carryOn} onKeyDown={handleKeyDown}>
        {isLast ? 'See results' : 'Next sentence'} <ArrowRight size={18} />
      </button>
    </div>
  );

  if (!grade) {
    return (
      <div className="sentence-card animate-fade-in">
        <div className="sentence-card-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <CloudOff size={15} /> This one couldn't be marked right now
          </span>
        </div>
        <div className="sentence-card-body" style={{ color: 'var(--text-muted)' }}>
          Your answer is kept and will be marked with the rest when you hand in.
        </div>
        {next}
      </div>
    );
  }

  return (
    <div className="sentence-card animate-fade-in">
      <div className="sentence-card-header">
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {grade.correct} of {grade.total} words correct
        </span>
        <span className={`score-badge ${accuracyClass(grade.accuracy)}`}>
          {Math.round(grade.accuracy * 100)}%
        </span>
      </div>
      <div className="sentence-card-body">
        <DiffText segments={grade.segments} />
      </div>
      <DiffLegend />
      {next}
    </div>
  );
}

export default SentenceFeedback;
