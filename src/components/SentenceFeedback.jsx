import { useEffect, useRef } from 'react';
import { ArrowRight, Check, CloudOff, Minus, Plus, X } from 'lucide-react';
import DiffText from './DiffText';
import DiffLegend from './DiffLegend';
import { accuracyClass, reviewSummary, reviewTiles } from '../lib/score';

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

  const counts = reviewSummary(reviewTiles(grade.segments));
  const perfect = counts.wrong + counts.missing + counts.extra === 0;
  const tone = accuracyClass(grade.accuracy);
  const verdict = perfect ? 'Perfect!'
    : grade.accuracy >= 0.9 ? 'Very good'
    : grade.accuracy >= 0.7 ? 'Good try'
    : 'Keep going';

  return (
    <div className={`sentence-card feedback-card feedback-${tone} animate-fade-in`}>
      <div className="feedback-head">
        <ScoreRing accuracy={grade.accuracy} perfect={perfect} tone={tone} />
        <div>
          <div className={`feedback-verdict ${tone}`}>{verdict}</div>
          <div className="feedback-sub">{grade.correct} of {grade.total} words right</div>
          {!perfect && (
            <div className="feedback-pills">
              {counts.wrong > 0 && <span className="feedback-pill pill-wrong"><X size={13} /> {counts.wrong} wrong</span>}
              {counts.missing > 0 && <span className="feedback-pill pill-missing"><Minus size={13} /> {counts.missing} missed</span>}
              {counts.extra > 0 && <span className="feedback-pill pill-extra"><Plus size={13} /> {counts.extra} extra</span>}
            </div>
          )}
        </div>
      </div>
      <div className="sentence-card-body feedback-body">
        <DiffText segments={grade.segments} />
      </div>
      {!perfect && <DiffLegend />}
      {next}
    </div>
  );
}

// The sentence's score at a glance, drawn as a ring that fills to it; a full
// marks sentence gets a tick instead of "100%".
function ScoreRing({ accuracy, perfect, tone }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={`score-ring ${tone}`} role="img" aria-label={`${Math.round(accuracy * 100)}% of the words right`}>
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle className="score-ring-track" cx="32" cy="32" r={radius} />
        <circle
          className="score-ring-fill"
          cx="32"
          cy="32"
          r={radius}
          style={{
            '--ring-length': circumference,
            strokeDasharray: circumference,
            strokeDashoffset: circumference * (1 - accuracy),
          }}
        />
      </svg>
      <span className="score-ring-label">
        {perfect ? <Check size={26} strokeWidth={3} /> : `${Math.round(accuracy * 100)}%`}
      </span>
    </div>
  );
}

export default SentenceFeedback;
