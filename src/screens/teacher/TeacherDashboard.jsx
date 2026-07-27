import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Copy, Loader2, Plus, RefreshCw, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { deleteAssignment, listAssignments, setAssignmentStatus } from '../../lib/assignmentApi';

function formatDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function TeacherDashboard({ onCreate, onOpen, onExit }) {
  const [assignments, setAssignments] = useState(null);
  const [error, setError] = useState('');
  const [busyCode, setBusyCode] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await listAssignments();
      setAssignments(data.assignments);
    } catch (err) {
      setError(err.message);
      setAssignments([]);
    }
  }, []);

  // Loaded once per visit, and on demand. No polling: the teacher knows when
  // they've changed something, and a refresh timer here would be requests spent
  // on nothing for every minute the tab sits open.
  useEffect(() => {
    load();
  }, [load]);

  async function act(code, fn) {
    setBusyCode(code);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyCode('');
      setConfirmDelete('');
    }
  }

  function copyLink(code) {
    const link = `${window.location.origin}${window.location.pathname}?a=${code}`;
    navigator.clipboard?.writeText(link);
  }

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>Assignments</h1>
      </div>

      <div className="glass-panel animate-fade-in">
        <div className="screen-head">
          <button className="btn-primary" onClick={onCreate}>
            <Plus size={18} /> New assignment
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-ghost btn-small" onClick={load}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn-ghost btn-small" onClick={onExit}>
              <ArrowLeft size={15} /> Practice
            </button>
          </div>
        </div>

        {error && <div className="fetch-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {assignments === null ? (
          <div className="empty-note"><Loader2 size={22} className="spin" /></div>
        ) : assignments.length === 0 ? (
          <div className="empty-note">
            No assignments yet. Create one from a passage and share the link with your class.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Class</th>
                  <th>Due</th>
                  <th>Sentences</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.code} className="row-clickable" onClick={() => onOpen(a.code)}>
                    <td className="code-chip">{a.code}</td>
                    <td>{a.title}</td>
                    <td>{a.className || '—'}</td>
                    <td>{formatDate(a.dueAt)}</td>
                    <td>{a.sentenceCount}</td>
                    <td>
                      <span className={`status-pill status-${a.status}`}>{a.status}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn-icon"
                          title="Copy the student link"
                          onClick={() => copyLink(a.code)}
                        >
                          <Copy size={15} />
                        </button>
                        {a.status !== 'draft' && (
                          <button
                            className="btn-icon"
                            title={a.status === 'active' ? 'Close this assignment' : 'Reopen this assignment'}
                            disabled={busyCode === a.code}
                            onClick={() =>
                              act(a.code, () =>
                                setAssignmentStatus(a.code, a.status === 'active' ? 'archived' : 'active')
                              )
                            }
                          >
                            {a.status === 'active' ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                          </button>
                        )}
                        <button
                          className="btn-icon"
                          title={
                            confirmDelete === a.code
                              ? 'Click again to delete this assignment and every attempt'
                              : 'Delete this assignment'
                          }
                          disabled={busyCode === a.code}
                          style={confirmDelete === a.code ? { color: 'var(--danger-color)' } : undefined}
                          onClick={() =>
                            confirmDelete === a.code
                              ? act(a.code, () => deleteAssignment(a.code))
                              : setConfirmDelete(a.code)
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {confirmDelete && (
          <p className="field-hint" style={{ color: 'var(--danger-color)' }}>
            Click the bin again to delete {confirmDelete} — its recordings and every student attempt
            go with it, and there is no undo.
          </p>
        )}
      </div>
    </div>
  );
}

export default TeacherDashboard;
