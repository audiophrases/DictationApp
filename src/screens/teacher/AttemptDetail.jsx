import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getAttempt } from '../../lib/assignmentApi';
import DiffText from '../../components/DiffText';
import { accuracyClass } from '../../lib/score';

function AttemptDetail({ code, attempt, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getAttempt(code, attempt.studentKey, attempt.id).then(
      (result) => { if (!cancelled) setData(result); },
      (err) => { if (!cancelled) setError(err.message); }
    );
    return () => { cancelled = true; };
  }, [code, attempt.studentKey, attempt.id]);

  const results = data?.results;
  const listens = data?.attempt?.listens || {};

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>{attempt.studentName}</h1>
        <p>
          {attempt.submitted ? 'Submitted' : 'Not submitted'}
          {results ? ` · ${Math.round(results.accuracy * 100)}% · ${results.correct} of ${results.total} words` : ''}
        </p>
      </div>

      <div className="glass-panel animate-fade-in">
        <div className="screen-head">
          <button className="btn-ghost btn-small" onClick={onBack}>
            <ArrowLeft size={15} /> Back to the class
          </button>
        </div>

        {error && <div className="fetch-error">{error}</div>}

        {!data && !error ? (
          <div className="empty-note"><Loader2 size={22} className="spin" /></div>
        ) : results ? (
          <>
            <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
              <div className="stat-cell">
                <span className={`stat-value ${accuracyClass(results.accuracy)}`}>
                  {Math.round(results.accuracy * 100)}%
                </span>
                <span className="stat-label">Score</span>
              </div>
              <div className="stat-cell">
                <span className="stat-value">{results.missed}</span>
                <span className="stat-label">Missed words</span>
              </div>
              <div className="stat-cell">
                <span className="stat-value">{results.extra}</span>
                <span className="stat-label">Extra / wrong words</span>
              </div>
              <div className="stat-cell">
                <span className="stat-value" style={attempt.warnings > 0 ? { color: 'var(--warning-color)' } : {}}>
                  {attempt.warnings}
                </span>
                <span className="stat-label">Times left the page</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
              {results.sentences.map((s, i) => (
                <div key={i} className="sentence-card">
                  <div className="sentence-card-header">
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Sentence {i + 1}
                      {listens[i] ? ` · played ${listens[i]}×` : ' · never played'}
                    </span>
                    <span className={`score-badge ${accuracyClass(s.accuracy)}`}>
                      {Math.round(s.accuracy * 100)}%
                    </span>
                  </div>
                  <div className="sentence-card-body">
                    <DiffText segments={s.segments} />
                  </div>
                  {!s.typed.trim() && (
                    <p className="field-hint">No answer typed for this sentence.</p>
                  )}
                </div>
              ))}
            </div>

            <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span className="word-extra">Red</span> = what the student typed, followed by{' '}
              <span className="word-missed">green underline</span> = what it should have been. A
              green word on its own was left out.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default AttemptDetail;
