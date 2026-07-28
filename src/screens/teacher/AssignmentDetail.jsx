import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Copy, Loader2, RefreshCw } from 'lucide-react';
import { getAssignment } from '../../lib/assignmentApi';
import { accuracyClass } from '../../lib/score';
import { studentLink } from '../../lib/appLinks';

function formatWhen(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function AssignmentDetail({ code, onBack, onOpenAttempt }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await getAssignment(code));
    } catch (err) {
      setError(err.message);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  const record = data?.record;
  const attempts = data?.attempts || [];
  const submitted = attempts.filter((a) => a.submitted);
  const average = submitted.length
    ? Math.round(submitted.reduce((sum, a) => sum + (a.scorePercent || 0), 0) / submitted.length)
    : null;

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>{record?.title || code}</h1>
        {record && (
          <p>
            <span className="code-chip">{code}</span>
            {record.className ? ` · ${record.className}` : ''}
            {` · ${record.sentenceCount} sentences`}
            {record.dueAt ? ` · due ${formatWhen(record.dueAt)}` : ''}
          </p>
        )}
      </div>

      <div className="glass-panel animate-fade-in">
        <div className="screen-head">
          <button className="btn-ghost btn-small" onClick={onBack}>
            <ArrowLeft size={15} /> All assignments
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-ghost btn-small"
              onClick={() => navigator.clipboard?.writeText(studentLink(code))}
            >
              <Copy size={15} /> Copy link
            </button>
            <button className="btn-ghost btn-small" onClick={load}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
        </div>

        {error && <div className="fetch-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {!data ? (
          <div className="empty-note"><Loader2 size={22} className="spin" /></div>
        ) : (
          <>
            <div className="stat-grid" style={{ marginBottom: '1.5rem' }}>
              <div className="stat-cell">
                <span className="stat-value">{attempts.length}</span>
                <span className="stat-label">Students started</span>
              </div>
              <div className="stat-cell">
                <span className="stat-value">{submitted.length}</span>
                <span className="stat-label">Submitted</span>
              </div>
              <div className="stat-cell">
                <span className={`stat-value ${average === null ? '' : accuracyClass(average / 100)}`}>
                  {average === null ? '—' : `${average}%`}
                </span>
                <span className="stat-label">Average score</span>
              </div>
              <div className="stat-cell">
                <span className="stat-value">
                  {record.maxListens === 0 ? '∞' : record.maxListens}
                </span>
                <span className="stat-label">Replays allowed</span>
              </div>
            </div>

            {attempts.length === 0 ? (
              <div className="empty-note">
                Nobody has opened this yet. Share the link or read out the code.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Score</th>
                      <th>Plays</th>
                      <th>Left page</th>
                      <th>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a) => (
                      <tr
                        key={a.id}
                        className="row-clickable"
                        onClick={() => onOpenAttempt(a)}
                      >
                        <td>{a.studentName}</td>
                        <td>
                          {a.submitted ? (
                            <span className={`score-badge ${accuracyClass((a.scorePercent || 0) / 100)}`}>
                              {a.scorePercent}%
                            </span>
                          ) : (
                            <span className="status-pill">in progress</span>
                          )}
                        </td>
                        <td>{a.plays}</td>
                        <td style={a.warnings > 0 ? { color: 'var(--warning-color)' } : undefined}>
                          {a.warnings}
                        </td>
                        <td>{formatWhen(a.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default AssignmentDetail;
