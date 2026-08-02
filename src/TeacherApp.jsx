import { useState } from 'react';
import { useServerReady } from './useServerReady';
import WakingOverlay from './components/WakingOverlay';
import TeacherLogin from './screens/teacher/TeacherLogin';
import TeacherDashboard from './screens/teacher/TeacherDashboard';
import CreateAssignmentScreen from './screens/teacher/CreateAssignmentScreen';
import AssignmentDetail from './screens/teacher/AssignmentDetail';
import AttemptDetail from './screens/teacher/AttemptDetail';
import { hasTeacherPassword } from './lib/teacherAuth';
import { assignmentsAvailable } from './lib/api';

/**
 * The teacher side: sign in, create assignments, read the results.
 *
 * Its own area rather than more states on the practice screen, because almost
 * nothing is shared — different data, different requests, and a password gate
 * in front of all of it.
 */
function TeacherApp({ onExit }) {
  const [view, setView] = useState('dashboard');
  // Mirrored into state because the password itself lives in a module variable
  // that React cannot re-render on — signing in has to change something React
  // is watching, or the login screen stays up over a valid session.
  const [signedIn, setSignedIn] = useState(hasTeacherPassword);
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState(null);
  const { waking, requireServer, dismiss } = useServerReady();

  if (!assignmentsAvailable()) {
    return (
      <div className="app-container" style={{ padding: '2rem', maxWidth: '520px', margin: '0 auto' }}>
        <div className="glass-panel animate-fade-in">
          <h2 style={{ fontSize: '1.3rem', marginBottom: '0.75rem' }}>Assignments aren't set up yet</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            This copy of the app has no assignment server configured. Deploy the worker in
            <code> cloudflare/</code> and set its address as <code>VITE_WORKER_BASE</code> — see
            <code> cloudflare/SECRETS.md</code>.
          </p>
          <button className="btn-ghost" style={{ marginTop: '1.25rem' }} onClick={onExit}>
            Back to practice
          </button>
        </div>
      </div>
    );
  }

  let screen;
  if (!signedIn) {
    screen = (
      <TeacherLogin
        onSignedIn={() => {
          setSignedIn(true);
          setView('dashboard');
        }}
        onCancel={onExit}
      />
    );
  } else if (view === 'create') {
    screen = (
      <CreateAssignmentScreen
        requireServer={requireServer}
        onCancel={() => setView('dashboard')}
        onFinished={() => setView('dashboard')}
      />
    );
  } else if (view === 'attempt') {
    screen = (
      <AttemptDetail
        code={code}
        attempt={attempt}
        onBack={() => setView('assignment')}
      />
    );
  } else if (view === 'assignment') {
    screen = (
      <AssignmentDetail
        code={code}
        onBack={() => setView('dashboard')}
        onOpenAttempt={(row) => {
          setAttempt(row);
          setView('attempt');
        }}
      />
    );
  } else {
    screen = (
      <TeacherDashboard
        onCreate={() => setView('create')}
        onOpen={(assignmentCode) => {
          setCode(assignmentCode);
          setView('assignment');
        }}
        onExit={onExit}
      />
    );
  }

  return (
    <>
      {waking && <WakingOverlay onDismiss={dismiss} />}
      {screen}
    </>
  );
}

export default TeacherApp;
