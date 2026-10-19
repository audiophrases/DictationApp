import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import AssignmentGate from './screens/assignment/AssignmentGate';
import DictationScreen from './screens/DictationScreen';
import ResultsScreen from './screens/ResultsScreen';
import NotebookScreen from './screens/NotebookScreen';
import { NotebookSubmission, NotebookCorrections } from './screens/NotebookSubmission';
import { useAssignmentAudio } from './useAssignmentAudio';
import { clearStudentSession, readStudentSession } from './lib/studentAuth';
import {
  forgetAttempt,
  rememberAttempt,
  reportWarning,
  saveAnswer,
  startAttempt,
  submitAttempt,
  fetchAttemptResults,
} from './lib/assignmentApi';

/**
 * A student doing an assignment.
 *
 * The shape is the same as free practice — hear a sentence, type it, move on —
 * but nothing about the passage is in this component. `sentenceCount` is all it
 * knows; audio arrives by index, and the marked answers only after submitting
 * — or, when the teacher chose per-sentence feedback, each one the moment it
 * has been answered, and then never again for that sentence.
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
  // Per-sentence mode only: the marked sentence being shown, and the wait for
  // the worker to mark the one just handed over.
  const [feedback, setFeedback] = useState(null);
  const [marking, setMarking] = useState(false);

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

  // Set the moment handing in begins, so a mark still in flight when the
  // student finished early cannot act on a dictation that has already ended
  // — play the next sentence over the results, or hand in twice.
  const endedRef = useRef(false);

  // Per-sentence mode: answers whose save failed. They are re-sent ahead of
  // the next save so the worker's idea of the sentence the student is on
  // catches up — otherwise one blip would leave every later sentence unmarked,
  // because the worker only marks in order. The first stored answer is final
  // there, so re-sending one whose response was merely lost changes nothing.
  const unsavedRef = useRef([]);

  // Per-sentence mode: sentences that already had an answer stored when this
  // attempt was resumed. They lie past the point the dictation picks up from
  // — a save that landed while an earlier one did not — and were answered but
  // never shown. The first answer is final on the worker, so asking again
  // would only mark the old one; their marking is fetched and shown instead.
  const restoredRef = useRef(new Set());

  const finish = useCallback(
    async (finalAnswers, id = attemptId) => {
      endedRef.current = true;
      stop();
      setPhase('submitting');
      setSubmitError('');
      try {
        // The whole answer set goes up here, not just the last sentence. The
        // per-sentence saves during the dictation are only insurance against a
        // crash; this is the copy that gets marked (per-sentence mode aside,
        // where the worker keeps what it already marked and this fills gaps).
        const result = await submitAttempt(code, id, finalAnswers,
          meta?.mode === 'notebook' ? { classroomSubmitted: true } : {});
        if (meta?.mode !== 'notebook') forgetAttempt(code);
        setOutcome(result);
        setPhase('done');
      } catch (err) {
        setSubmitError(err.message);
      }
    },
    [code, attemptId, stop, meta?.mode]
  );

  async function handleStart() {
    setStarting(true);
    setStartError('');
    try {
      const session = readStudentSession();
      if (!session) throw Object.assign(new Error('Please sign in with your school account again.'), { status: 401 });
      const data = await startAttempt(code, session.studentToken);
      const count = data.meta.sentenceCount;
      const restored = Array.from({ length: count }, (_, i) => data.answers[i] ?? '');

      setMeta(data.meta);
      setAttemptId(data.attemptId);
      setInitialListens(data.listens || {});
      setWarnings(data.warnings || 0);
      answersRef.current = restored;
      rememberAttempt(code, data.attemptId, session.student.email);

      if (data.meta.mode === 'notebook' && data.submitted) {
        setOutcome(data.outcome);
        setPhase('done');
        return;
      }

      // Per-sentence mode: every sentence answered means every one has been
      // marked and shown, and only the hand-in was lost with the page. Redoing
      // the last sentence would replay one they have already read.
      if (data.meta.feedbackMode === 'sentence' && data.nextIndex >= count) {
        await finish(restored, data.attemptId);
        return;
      }

      const resumeAt = Math.min(data.nextIndex, count - 1);
      endedRef.current = false;
      unsavedRef.current = [];
      restoredRef.current = new Set(
        data.meta.feedbackMode === 'sentence'
          ? (data.answered || []).filter((i) => i > resumeAt)
          : []
      );
      setCurrentIndex(resumeAt);
      setStudentInput('');
      setPhase('dictating');
    } catch (err) {
      if (err.status === 401) clearStudentSession();
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
    if (phase !== 'dictating' || !meta || meta.mode === 'notebook') return;
    if (currentIndex + 1 < meta.sentenceCount) prefetch(currentIndex + 1);
  }, [phase, meta, currentIndex, prefetch]);

  // Leaving the page mid-dictation is recorded for the teacher, same as in free
  // practice, but here it also has to reach the server.
  useEffect(() => {
    if (phase !== 'dictating' || !attemptId || meta?.mode === 'notebook') return;

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
  }, [phase, code, attemptId, meta?.mode]);

  function advance(index) {
    const next = index + 1;
    if (next >= meta.sentenceCount) {
      finish(answersRef.current);
      return;
    }
    setCurrentIndex(next);
    if (restoredRef.current.has(next)) {
      // Already answered (see restoredRef): show its marking, don't play it.
      restoredRef.current.delete(next);
      setMarking(true);
      saveMarked(next, answersRef.current[next]).then((grade) => {
        if (endedRef.current) return;
        setMarking(false);
        setFeedback({ index: next, grade });
      });
      return;
    }
    play(next);
  }

  async function nextSentence() {
    const index = currentIndex;
    const text = studentInput;
    setAnswerAt(index, text);
    setStudentInput('');

    if (meta.feedbackMode !== 'sentence') {
      saveAnswer(code, attemptId, index, text).catch(() => {
        // Deliberately quiet: submit() re-sends every answer, so a dropped save
        // here costs nothing and interrupting the student would cost attention.
      });
      advance(index);
      return;
    }

    // Per-sentence marks ride back on the save, so this one is waited on. A
    // failed save still must not strand the student: the answer is re-sent at
    // submit regardless, so they move on with that one sentence unmarked.
    setMarking(true);
    const grade = await saveMarked(index, text);
    if (endedRef.current) return;
    setMarking(false);
    // Always a panel, marked or not: the student's click to continue is what
    // starts the next sentence, and play() has to stay inside that click (see
    // useAssignmentAudio). A null grade renders as "couldn't mark this one".
    setFeedback({ index, grade });
  }

  async function saveMarked(index, text) {
    // Earlier answers whose save failed go first, in order (see unsavedRef).
    for (const i of [...unsavedRef.current]) {
      try {
        await saveAnswer(code, attemptId, i, answersRef.current[i]);
        unsavedRef.current = unsavedRef.current.filter((n) => n !== i);
      } catch {
        break;
      }
    }
    try {
      return (await saveAnswer(code, attemptId, index, text)).feedback || null;
    } catch {
      unsavedRef.current = [...unsavedRef.current, index];
      return null;
    }
  }

  function continueAfterFeedback() {
    const { index } = feedback;
    setFeedback(null);
    advance(index);
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
        onIdentityChange={() => setStartError('')}
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
                Your work is still here — don't close this page.
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
    if (meta?.mode === 'notebook') return <NotebookCorrections outcome={outcome}
      onRefresh={async () => setOutcome(await fetchAttemptResults(code, attemptId))} />;
    if (outcome?.feedbackMode === 'none' || !outcome?.results) {
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

  if (phase === 'photo') return <NotebookSubmission classroomUrl={meta.classroomUrl}
    onSubmit={() => finish([])} onBack={() => { endedRef.current = false; setPhase('dictating'); }} />;

  if (meta?.mode === 'notebook') {
    return <NotebookScreen heading={meta.title} count={meta.sentenceCount} index={currentIndex}
      onMove={(index) => {
        stop();
        saveAnswer(code, attemptId, currentIndex, '').catch(() => {});
        setCurrentIndex(index);
        if (audio.replaysLeftFor(index) === null || audio.replaysLeftFor(index) > 0) play(index, { replay: true });
      }}
      onRepeat={() => play(currentIndex, { replay: true })}
      onFinish={() => { stop(); setPhase('photo'); }}
      isSpeaking={audio.isSpeaking} replaysLeft={audio.replaysLeftFor(currentIndex)} error={audio.error} />;
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
      feedback={feedback}
      onContinue={continueAfterFeedback}
      marking={marking}
    />
  );
}

export default AssignmentApp;
