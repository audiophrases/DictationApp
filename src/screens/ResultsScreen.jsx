import { useMemo, useState } from 'react';
import { CheckCircle, Volume2, RefreshCw, FilePlus2 } from 'lucide-react';
import { gradeDictation, DEFAULT_GRADING_OPTIONS } from '../lib/grading';
import SourceCitation from '../components/SourceCitation';
import DiffText from '../components/DiffText';
import { accuracyClass } from '../lib/score';

/**
 * The marked-up result of a session.
 *
 * Free practice grades here in the browser and lets the student loosen the
 * grading rules to explore their mistakes. An assignment passes `grade` in
 * instead — already computed by the worker, under the options the teacher
 * chose — and hides those toggles, because a score the teacher will read is not
 * one the student gets to re-mark.
 */
function ResultsScreen({
  sentences,
  typedSentences,
  listenCounts,
  warnings,
  passageSource,
  onReplaySentence,
  onRetry,
  onNewPassage,
  grade: providedGrade,
  heading = 'Dictation Complete',
  playsLabel = 'Replays used',
  // Free practice counts replays only; an assignment counts every play, so the
  // two can't share one wording without one of them being wrong.
  formatPlays = (n) => `${n} replay${n !== 1 ? 's' : ''}`,
  note,
  actions,
}) {
  const [options, setOptions] = useState(DEFAULT_GRADING_OPTIONS);
  const localGrade = useMemo(
    () => (providedGrade ? null : gradeDictation(sentences, typedSentences, options)),
    [providedGrade, sentences, typedSentences, options]
  );
  const grade = providedGrade || localGrade;

  const toggle = (key) => setOptions({ ...options, [key]: !options[key] });
  const percent = Math.round(grade.accuracy * 100);
  const totalReplays = listenCounts.reduce((a, b) => a + b, 0);

  const toggles = [
    { key: 'ignoreCase', label: 'Ignore case' },
    { key: 'ignorePunctuation', label: 'Ignore punctuation' },
    { key: 'ignoreAccents', label: 'Ignore accents' },
  ];

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div className="glass-panel">
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <CheckCircle size={48} color="var(--success-color)" style={{ margin: '0 auto 0.75rem' }} />
          <h2 style={{ fontSize: '2rem' }}>{heading}</h2>
          <div className={`score-hero ${accuracyClass(grade.accuracy)}`}>{percent}%</div>
          <p style={{ color: 'var(--text-muted)' }}>
            {grade.correct} of {grade.total} words correct
          </p>
        </div>

        <div className="stat-grid">
          <div className="stat-cell">
            <span className="stat-value">{grade.missed}</span>
            <span className="stat-label">Missed words</span>
          </div>
          <div className="stat-cell">
            <span className="stat-value">{grade.extra}</span>
            <span className="stat-label">Extra / wrong words</span>
          </div>
          <div className="stat-cell">
            <span className="stat-value">{totalReplays}</span>
            <span className="stat-label">{playsLabel}</span>
          </div>
          <div className="stat-cell">
            <span className="stat-value" style={warnings > 0 ? { color: 'var(--warning-color)' } : {}}>
              {warnings}
            </span>
            <span className="stat-label">Times left the page</span>
          </div>
        </div>

        {!providedGrade && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', margin: '1.5rem 0' }}>
            {toggles.map((t) => (
              <button
                key={t.key}
                className={`chip ${options[t.key] ? 'chip-active' : ''}`}
                onClick={() => toggle(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {note && <div style={{ margin: '1.5rem 0' }}>{note}</div>}

        <div style={{ display: 'grid', gap: '1rem' }}>
          {grade.sentences.map((s, i) => (
            <div key={i} className="sentence-card">
              <div className="sentence-card-header">
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Sentence {i + 1}
                  {listenCounts[i] > 0 ? ` · ${formatPlays(listenCounts[i])}` : ''}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className={`score-badge ${accuracyClass(s.accuracy)}`}>
                    {Math.round(s.accuracy * 100)}%
                  </span>
                  <button
                    className="btn-icon"
                    onClick={() => onReplaySentence(s.original, i)}
                    title="Hear this sentence again"
                  >
                    <Volume2 size={16} />
                  </button>
                </div>
              </div>
              <div className="sentence-card-body">
                <DiffText segments={s.segments} />
              </div>
            </div>
          ))}
        </div>

        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <span className="word-missed">Green underline</span> = words you missed from the original.{' '}
          <span className="word-extra">Red</span> = extra or incorrect words you typed.
        </p>

        {passageSource && (
          <div style={{ marginTop: '1rem' }}>
            <SourceCitation source={passageSource} compact />
          </div>
        )}

        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {actions || (
            <>
              <button className="btn-primary" onClick={onRetry}>
                <RefreshCw size={18} /> Try Again
              </button>
              <button className="btn-ghost" onClick={onNewPassage}>
                <FilePlus2 size={18} /> New Passage
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ResultsScreen;
