import { useMemo, useState } from 'react';
import { CheckCircle, Volume2, RefreshCw, FilePlus2 } from 'lucide-react';
import { gradeDictation, DEFAULT_GRADING_OPTIONS } from '../lib/grading';
import SourceCitation from '../components/SourceCitation';

function accuracyClass(accuracy) {
  if (accuracy >= 0.9) return 'badge-good';
  if (accuracy >= 0.7) return 'badge-ok';
  return 'badge-poor';
}

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

function ResultsScreen({
  sentences,
  typedSentences,
  listenCounts,
  warnings,
  passageSource,
  onReplaySentence,
  onRetry,
  onNewPassage,
}) {
  const [options, setOptions] = useState(DEFAULT_GRADING_OPTIONS);
  const grade = useMemo(
    () => gradeDictation(sentences, typedSentences, options),
    [sentences, typedSentences, options]
  );

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
          <h2 style={{ fontSize: '2rem' }}>Dictation Complete</h2>
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
            <span className="stat-label">Replays used</span>
          </div>
          <div className="stat-cell">
            <span className="stat-value" style={warnings > 0 ? { color: 'var(--warning-color)' } : {}}>
              {warnings}
            </span>
            <span className="stat-label">Times left the page</span>
          </div>
        </div>

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

        <div style={{ display: 'grid', gap: '1rem' }}>
          {grade.sentences.map((s, i) => (
            <div key={i} className="sentence-card">
              <div className="sentence-card-header">
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Sentence {i + 1}
                  {listenCounts[i] > 0 ? ` · ${listenCounts[i]} replay${listenCounts[i] !== 1 ? 's' : ''}` : ''}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className={`score-badge ${accuracyClass(s.accuracy)}`}>
                    {Math.round(s.accuracy * 100)}%
                  </span>
                  <button
                    className="btn-icon"
                    onClick={() => onReplaySentence(s.original)}
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

        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button className="btn-primary" onClick={onRetry}>
            <RefreshCw size={18} /> Try Again
          </button>
          <button className="btn-ghost" onClick={onNewPassage}>
            <FilePlus2 size={18} /> New Passage
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResultsScreen;
