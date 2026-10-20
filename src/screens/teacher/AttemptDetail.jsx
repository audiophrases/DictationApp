import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getAttempt } from '../../lib/assignmentApi';
import DiffText from '../../components/DiffText';
import DiffLegend from '../../components/DiffLegend';
import { accuracyClass } from '../../lib/score';
import { dictationUnit } from '../../lib/delivery';

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
  const unit = dictationUnit(data || {});
  const listens = data?.attempt?.listens || {};

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>{attempt.studentName}</h1>
        <p>
          {data?.mode === 'notebook' ? (attempt.submitted ? 'Completed' : 'In progress') : (attempt.submitted ? 'Submitted' : 'Not submitted')}
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
        ) : data?.mode === 'notebook' ? (
          <div>
            <h2 style={{ fontSize: '1.2rem' }}>Written in a notebook</h2>
            <p className="field-hint">{data.attempt.submitted ? 'The student has finished the dictation.' : 'The student has not finished the dictation yet.'} No automatic score is assigned.</p>
            <h3 style={{ marginTop: '1.5rem' }}>Correction passage</h3>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: '0.75rem' }}>{data.sentences.join(' ')}</p>
          </div>
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
                      {unit === 'segment' ? 'Segment' : 'Sentence'} {i + 1}
                      {listens[i] ? ` · played ${listens[i]}×` : ' · never played'}
                    </span>
                    <span className={`score-badge ${accuracyClass(s.accuracy)}`}>
                      {Math.round(s.accuracy * 100)}%
                    </span>
                  </div>
                  <div className="sentence-card-body">
                    <DiffText segments={s.segments} typedBy="The student" />
                  </div>
                  {!s.typed.trim() && (
                    <p className="field-hint">No answer typed for this {unit}.</p>
                  )}
                </div>
              ))}
            </div>

            <DiffLegend typedBy="the student" />
          </>
        ) : null}
      </div>
    </div>
  );
}

export default AttemptDetail;
