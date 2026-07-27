import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import AssignmentGate from './screens/assignment/AssignmentGate';
import DictationScreen from './screens/DictationScreen';
import ResultsScreen from './screens/ResultsScreen';
import { useAssignmentAudio } from './useAssignmentAudio';
import {
  forgetAttempt,
  rememberAttempt,
  reportWarning,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from './lib/assignmentApi';

/**
 * A student doing an assignment.
 *
 * The shape is the same as free practice — hear a sentence, type it, move on —
 * but nothing about the passage is in this component. `sentenceCount` is all it
 * knows; audio arrives by index, and the marked answers only after submitting.
 */
function AssignmentApp({ code }) {
  const [phase, setPhase] = useState('gate'); // gate | dictating | submitting | done
  const [meta, setMeta] = useState(null);
  const [attemptId, setAttemptId] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [studentInput, setStudentInput] = useState('');
  const [warnings, setWarnings] = useState(0);
  const [initialListens, setInitialListens] = useState({});
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [submitError, setSubmitError] = useState('');

  const audio = useAssignmentAudio({
    code,
    attemptId,
    maxListens: meta?.maxListens ?? 0,
    initialListens,
  });
  const { play, prefetch, stop } = audio;

  // A ref rather than state: nothing on screen reads the finished answers, and
  // submit must send the newest set even when called from a handler that closed
  // over an older render.
  const answersRef = useRef([]);
  const setAnswerAt = (index, text) => {
    answersRef.current = answersRef.current.with(index, text);
  };

  const finish = useCallback(
    async (finalAnswers) => {
      stop();
      setPhase('submitting');
      setSubmitError('');
      try {
        // The whole answer set goes up here, not just the last sentence. The
        // per-sentence saves during the dictation are only insurance against a
        // crash; this is the copy that gets marked.
        const result = await submitAttempt(code, attemptId, finalAnswers);
        forgetAttempt(code);
        setOutcome(result);
        setPhase('done');
      } catch (err) {
        setSubmitError(err.message);
      }
    },
    [code, attemptId, stop]
  );

  async function handleStart(username, password) {
    setStarting(true);
    setStartError('');
    try {
      const data = await startAttempt(code, username, password);
      const count = data.meta.sentenceCount;
      const restored = Array.from({ length: count }, (_, i) => data.answers[i] ?? '');

      setMeta(data.meta);
      setAttemptId(data.attemptId);
      setInitialListens(data.listens || {});
      setWarnings(data.warnings || 0);
      answersRef.current = restored;
      rememberAttempt(code, data.attemptId, username);

      const resumeAt = Math.min(data.nextIndex, count - 1);
      setCurrentIndex(resumeAt);
      setStudentInput('');
      setPhase('dictating');
    } catch (err) {
      setStartError(err.message);
    } finally {
      setStarting(false);
    }
  }

  // Playback waits for the attempt to be in state, so the first sentence starts
  // from an effect rather than inside handleStart.
  const startedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'dictating' || !attemptId || startedRef.current) return;
    startedRef.current = true;
    play(currentIndex);
  }, [phase, attemptId, currentIndex, play]);

  // One sentence ahead, and only when replays are unlimited — see the note in
  // useAssignmentAudio about why prefetching is metered.
  useEffect(() => {
    if (phase !== 'dictating' || !meta) return;
    if (currentIndex + 1 < meta.sentenceCount) prefetch(currentIndex + 1);
  }, [phase, meta, currentIndex, prefetch]);

  // Leaving the page mid-dictation is recorded for the teacher, same as in free
  // practice, but here it also has to reach the server.
  useEffect(() => {
    if (phase !== 'dictating' || !attemptId) return;

    const flag = () => {
      setWarnings((n) => n + 1);
      reportWarning(code, attemptId).catch(() => {
        // The count the teacher sees may miss one; not worth interrupting a
        // dictation over.
      });
    };
    const onVisibility = () => {
      if (document.hidden) flag();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', flag);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', flag);
    };
  }, [phase, code, attemptId]);

  function nextSentence() {
    const index = currentIndex;
    setAnswerAt(index, studentInput);
    setStudentInput('');

    saveAnswer(code, attemptId, index, studentInput).catch(() => {
      // Deliberately quiet: submit() re-sends every answer, so a dropped save
      // here costs nothing and interrupting the student would cost attention.
    });

    if (index + 1 < meta.sentenceCount) {
      setCurrentIndex(index + 1);
      play(index + 1);
    } else {
      finish(answersRef.current);
    }
  }

  function finishEarly() {
    if (studentInput.trim()) setAnswerAt(currentIndex, studentInput);
    finish(answersRef.current);
  }

  if (phase === 'gate') {
    return (
      <AssignmentGate
        code={code}
        onStart={handleStart}
        starting={starting}
        startError={startError}
      />
    );
  }

  if (phase === 'submitting') {
    return (
      <div className="app-container" style={{ padding: '2rem', maxWidth: '460px', margin: '0 auto' }}>
        <div className="glass-panel animate-fade-in" style={{ textAlign: 'center' }}>
          {submitError ? (
            <>
              <h2 style={{ fontSize: '1.3rem' }}>Couldn't hand this in</h2>
              <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem' }}>{submitError}</p>
              <p className="field-hint">
                Your answers are still here — don't close this page.
              </p>
              <button
                className="btn-primary"
                style={{ marginTop: '1.25rem' }}
                onClick={() => finish(answersRef.current)}
              >
                <RefreshCw size={18} /> Try again
              </button>
            </>
          ) : (
            <>
              <Loader2 size={26} className="spin" style={{ color: 'var(--text-muted)' }} />
              <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)' }}>Handing in your work…</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    if (outcome?.feedbackMode !== 'end' || !outcome?.results) {
      return (
        <div className="app-container" style={{ padding: '2rem', maxWidth: '460px', margin: '0 auto' }}>
          <div className="glass-panel animate-fade-in" style={{ textAlign: 'center' }}>
            <CheckCircle size={44} color="var(--success-color)" style={{ margin: '0 auto 0.75rem' }} />
            <h2 style={{ fontSize: '1.5rem' }}>Handed in</h2>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              Your teacher has your answers. You can close this page.
            </p>
          </div>
        </div>
      );
    }

    const listenCounts = Array.from(
      { length: meta.sentenceCount },
      (_, i) => outcome.listens?.[i] || 0
    );
    return (
      <ResultsScreen
        grade={outcome.results}
        sentences={outcome.results.sentences.map((s) => s.original)}
        typedSentences={outcome.results.sentences.map((s) => s.typed)}
        listenCounts={listenCounts}
        warnings={outcome.warnings ?? warnings}
        heading="Handed in"
        playsLabel="Times played"
        formatPlays={(n) => `played ${n}×`}
        onReplaySentence={(_text, index) => play(index)}
        note={
          <p className="field-hint" style={{ textAlign: 'center', marginTop: 0 }}>
            Marked with the rules your teacher set, who can also see this.
          </p>
        }
        actions={<span className="field-hint">You can close this page now.</span>}
      />
    );
  }

  return (
    <DictationScreen
      heading={meta.title}
      sentenceCount={meta.sentenceCount}
      currentIndex={currentIndex}
      studentInput={studentInput}
      setStudentInput={setStudentInput}
      onSubmit={nextSentence}
      onRepeat={() => play(currentIndex, { replay: true })}
      onFinishEarly={finishEarly}
      replaysLeft={audio.replaysLeftFor(currentIndex)}
      isSpeaking={audio.isSpeaking}
      warnings={warnings}
      error={audio.error}
    />
  );
}

export default AssignmentApp;
