import { useState, useEffect, useRef } from 'react';
import { useSpeech } from './useSpeech';
import { useServerReady } from './useServerReady';
import SetupScreen from './screens/SetupScreen';
import DictationScreen from './screens/DictationScreen';
import ResultsScreen from './screens/ResultsScreen';
import NotebookScreen from './screens/NotebookScreen';
import NotebookCompletion from './screens/NotebookCompletion';
import { prepareNotebook, prepareNotebookSentence } from './lib/notebookAudio';
import { notebookPlan } from './lib/notebook';
import WakingOverlay from './components/WakingOverlay';
import { splitIntoSentences } from './lib/sentences';
import { ttsBase } from './lib/api';
import { lessonToPassage } from './lib/lessons';
import { gradeSentence, DEFAULT_GRADING_OPTIONS } from './lib/grading';

const SETTINGS_KEY = 'dictation.settings';
const PASSAGE_KEY = 'dictation.passage';
const SOURCE_KEY = 'dictation.source';

const DEFAULT_SETTINGS = { lang: 'en-US', rate: 1, maxListens: 0, feedbackMode: 'end' };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadPassage() {
  return localStorage.getItem(PASSAGE_KEY) || '';
}

function loadSource() {
  try {
    return JSON.parse(localStorage.getItem(SOURCE_KEY)) || null;
  } catch {
    return null;
  }
}

/**
 * Free practice: pick or fetch a passage, dictate it, mark it. No account, no
 * server-side state, and fully offline-capable under the portable pack — the
 * original app, unchanged apart from where its audio comes from.
 */
function PracticeApp() {
  const { speak, prefetch, stop, isSpeaking } = useSpeech();
  const { waking, requireServer, dismiss: dismissWaking } = useServerReady();
  const [appState, setAppState] = useState('setup'); // setup, dictating, finished
  const [settings, setSettings] = useState(loadSettings);
  const [passage, setPassageRaw] = useState(loadPassage);
  // Citation for a fetched passage (null once the text is edited by hand)
  const [passageSource, setPassageSource] = useState(loadSource);
  const [fetchState, setFetchState] = useState({ loading: false, error: null });

  // Dictation state
  const [sentences, setSentences] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [studentInput, setStudentInput] = useState('');
  const [allStudentInput, setAllStudentInput] = useState([]);
  const [listenCounts, setListenCounts] = useState([]);
  const [warnings, setWarnings] = useState(0);
  // Per-sentence mode only: the marked sentence just answered, shown before
  // the next one plays.
  const [feedback, setFeedback] = useState(null);
  const [prepareError, setPrepareError] = useState('');
  const [prepareProgress, setPrepareProgress] = useState('');
  const [notebookSpeaking, setNotebookSpeaking] = useState(false);
  const [notebookError, setNotebookError] = useState('');
  // Notebook clips by speed: rate → segment index → object URL. The setup
  // speed is recorded up front; another speed chosen mid-dictation is recorded
  // a sentence at a time as it's needed, and kept, so switching back is instant.
  const notebookClips = useRef(new Map());
  const notebookSentences = useRef([]); // { sentence, start, count } per sentence
  const notebookRecording = useRef(new Map());
  const notebookCues = useRef(new Map());
  const notebookPlayer = useRef(null);
  const [notebookLoading, setNotebookLoading] = useState(false);
  const revokeNotebookClips = () => {
    for (const clips of notebookClips.current.values()) clips.forEach((url) => url && URL.revokeObjectURL(url));
    notebookClips.current = new Map();
    notebookRecording.current = new Map();
  };
  useEffect(() => () => {
    notebookPlayer.current?.pause?.();
    revokeNotebookClips();
  }, []);

  function stopNotebook() {
    notebookPlayer.current?.pause?.();
    notebookPlayer.current = null;
    setNotebookSpeaking(false);
  }

  // The clip for one segment at one speed, recording its sentence if needed.
  function notebookClip(index, rate) {
    if (!notebookClips.current.has(rate)) notebookClips.current.set(rate, []);
    const clips = notebookClips.current.get(rate);
    if (clips[index]) return Promise.resolve(clips[index]);
    const part = notebookSentences.current.find((p) => index >= p.start && index < p.start + p.count);
    const key = `${rate}|${part.start}`;
    if (!notebookRecording.current.has(key)) {
      const recording = (async () => {
        const context = new AudioContext({ sampleRate: 24000 });
        try {
          const blobs = await prepareNotebookSentence(part.sentence, { lang: settings.lang, rate, context, cueCache: notebookCues.current });
          blobs.forEach((blob, i) => { clips[part.start + i] = URL.createObjectURL(blob); });
        } finally { await context.close(); }
      })();
      notebookRecording.current.set(key, recording);
      recording.catch(() => notebookRecording.current.delete(key));
    }
    return notebookRecording.current.get(key).then(() => clips[index]);
  }

  async function playNotebook(index, rate = settings.rate) {
    stopNotebook(); setNotebookError('');
    const token = {};
    notebookPlayer.current = token;
    let url;
    try {
      if (!notebookClips.current.get(rate)?.[index]) setNotebookLoading(true);
      url = await notebookClip(index, rate);
    } catch {
      if (notebookPlayer.current === token) setNotebookError('Could not record this segment at that speed. Press Space to try again.');
      return;
    } finally {
      if (notebookPlayer.current === token) setNotebookLoading(false);
    }
    // Something else started playing (or the student moved on) meanwhile.
    if (notebookPlayer.current !== token) return;
    const player = new Audio(url);
    notebookPlayer.current = player;
    player.onplaying = () => { if (notebookPlayer.current === player) setNotebookSpeaking(true); };
    player.onended = () => { if (notebookPlayer.current === player) setNotebookSpeaking(false); };
    player.play().catch(() => { if (notebookPlayer.current === player) { setNotebookError('Could not play this segment. Press Space to try again.'); setNotebookSpeaking(false); } });
  }

  // A new speed applies from the next play, like typing mode's selector;
  // the current sentence is recorded at it straight away so that play is quick.
  function changeNotebookRate(rate) {
    setSettings((current) => ({ ...current, rate }));
    notebookClip(currentIndex, rate).catch(() => {});
  }

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(PASSAGE_KEY, passage);
  }, [passage]);

  useEffect(() => {
    if (passageSource) localStorage.setItem(SOURCE_KEY, JSON.stringify(passageSource));
    else localStorage.removeItem(SOURCE_KEY);
  }, [passageSource]);

  // Manual edits invalidate a fetched citation, so it can't misattribute text
  const setPassage = (value) => {
    setPassageRaw(value);
    if (passageSource && value !== passageSource.text) setPassageSource(null);
  };

  const fetchPassage = async (length) => {
    setFetchState({ loading: true, error: null });
    try {
      const resp = await fetch(
        `${ttsBase()}/api/dictation?lang=${encodeURIComponent(settings.lang)}&length=${length}`
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to fetch passage');
      setPassageRaw(data.text);
      setPassageSource({
        text: data.text,
        title: data.title,
        url: data.url,
        date: data.date,
        source: data.source,
        edition: data.edition,
        length,
      });
      setFetchState({ loading: false, error: null });
    } catch (err) {
      setFetchState({ loading: false, error: err.message });
    }
  };

  // A lesson arrives as a list of sentences rather than prose, so it is joined
  // one per line — splitIntoSentences ends a sentence at a line break, which
  // makes the dictation follow the lesson exactly. Given a citation like a
  // fetched passage so it is hidden on the setup screen for the same reason:
  // the student should hear these sentences before reading them.
  const pickLesson = (lesson) => {
    const text = lessonToPassage(lesson);
    setPassageRaw(text);
    setPassageSource({
      text,
      title: lesson.title,
      source: 'Speech to IPA lesson',
      lessonId: lesson.id,
    });
    setFetchState({ loading: false, error: null });
  };

  // Anti-cheat: leaving the page/window during dictation is recorded
  useEffect(() => {
    if (appState !== 'dictating' || settings.mode === 'notebook') return;

    const handleVisibilityChange = () => {
      if (document.hidden) setWarnings((prev) => prev + 1);
    };
    const handleBlur = () => setWarnings((prev) => prev + 1);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [appState, settings.mode]);

  // Every playback path funnels through here, so this is the one place that
  // needs to tell the warm-up hook someone is actually waiting on audio —
  // the only condition under which the waking overlay is allowed to appear.
  const speakSentence = (text) => {
    requireServer();
    speak(text, settings.lang, { rate: settings.rate });
  };

  // Fetch the next sentence's audio while the student is still typing this one,
  // so pressing Enter starts playback immediately instead of waiting on a round
  // trip to the voice service. Silent and best-effort — see useSpeech.prefetch.
  useEffect(() => {
    if (appState !== 'dictating' || settings.mode === 'notebook') return;
    prefetch(sentences[currentIndex + 1], settings.lang, { rate: settings.rate });
  }, [appState, sentences, currentIndex, settings.lang, settings.rate, settings.mode, prefetch]);

  // The first sentence is the wait every student notices, so warm it while the
  // setup screen is still up. Debounced so typing a passage by hand doesn't
  // fire a request per keystroke. The text is not on screen while this happens
  // if the passage was fetched — only the audio is being readied.
  useEffect(() => {
    if (appState !== 'setup' || !passage.trim() || settings.mode === 'notebook') return;
    const timer = setTimeout(() => {
      const [first] = splitIntoSentences(passage);
      prefetch(first, settings.lang, { rate: settings.rate });
    }, 800);
    return () => clearTimeout(timer);
  }, [appState, passage, settings.lang, settings.rate, settings.mode, prefetch]);

  const startDictation = async () => {
    if (settings.mode === 'notebook') {
      setPrepareError(''); setPrepareProgress('Recording natural sentences…'); setAppState('preparing');
      stop(); stopNotebook(); requireServer();
      revokeNotebookClips();
      try {
        const clips = await prepareNotebook(passage, settings, (done, total) => setPrepareProgress(`Recorded ${done} of ${total} sentences`));
        notebookClips.current.set(settings.rate, clips.map((clip) => URL.createObjectURL(clip)));
        let start = 0;
        notebookSentences.current = notebookPlan(passage, settings.lang).map(({ sentence, segments }) => {
          const part = { sentence, start, count: segments.length };
          start += segments.length;
          return part;
        });
        setSentences(clips.map(() => ''));
        setCurrentIndex(0); setListenCounts(clips.map(() => 0)); setAppState('ready');
      } catch (err) { setPrepareError(err.message); }
      return;
    }
    const cleanedSentences = splitIntoSentences(passage);
    if (cleanedSentences.length === 0) return;

    setSentences(cleanedSentences);
    setCurrentIndex(0);
    setStudentInput('');
    setAllStudentInput([]);
    setListenCounts(cleanedSentences.map(() => 0));
    setWarnings(0);
    setFeedback(null);
    setAppState('dictating');

    speakSentence(cleanedSentences[0]);
  };

  const replaysLeft =
    settings.maxListens === 0
      ? null
      : Math.max(0, settings.maxListens - (listenCounts[currentIndex] || 0));

  const repeatSentence = () => {
    if (replaysLeft !== null && replaysLeft <= 0) return;
    setListenCounts((prev) => prev.map((c, i) => (i === currentIndex ? c + 1 : c)));
    speakSentence(sentences[currentIndex]);
  };

  const finishSession = (inputs) => {
    stop();
    setAllStudentInput(inputs);
    setAppState('finished');
  };

  const advance = (inputs) => {
    if (currentIndex + 1 < sentences.length) {
      setCurrentIndex(currentIndex + 1);
      speakSentence(sentences[currentIndex + 1]);
    } else {
      finishSession(inputs);
    }
  };

  const nextSentence = () => {
    const newAllInput = [...allStudentInput, studentInput];
    setAllStudentInput(newAllInput);
    setStudentInput('');

    if (settings.feedbackMode === 'sentence') {
      // Marked right here under the default rules — no server involved, so this
      // works offline in the portable pack. The results screen lets the student
      // loosen or tighten those rules afterwards, over the whole passage.
      setFeedback({ grade: gradeSentence(sentences[currentIndex], studentInput, DEFAULT_GRADING_OPTIONS) });
      return;
    }
    advance(newAllInput);
  };

  const continueAfterFeedback = () => {
    setFeedback(null);
    advance(allStudentInput);
  };

  const finishEarly = () => {
    const inputs = studentInput.trim()
      ? [...allStudentInput, studentInput]
      : allStudentInput;
    finishSession(inputs);
  };

  let screen;
  if (appState === 'preparing' || appState === 'ready') {
    screen = <div className="app-container notebook-container"><div className="glass-panel notebook-panel">
      <h1>{appState === 'ready' ? 'Notebook audio ready' : 'Preparing notebook audio'}</h1>
      <p className="field-hint">Complete sentences are recorded with natural voices, then divided into segments for writing.</p>
      <p role="status">{appState === 'ready' ? `${notebookClips.current.length} segments. Have your notebook ready.` : prepareProgress}</p>
      {prepareError && <p className="fetch-error" role="alert">{prepareError}</p>}
      {appState === 'ready' && <button className="btn-primary" onClick={() => { setAppState('dictating'); playNotebook(0); }}>Start notebook dictation</button>}
      {prepareError && <><button className="btn-primary" onClick={startDictation}>Try again</button><button className="btn-ghost" onClick={() => setAppState('setup')}>Back to setup</button></>}
    </div></div>;
  } else if (appState === 'finished' && settings.mode === 'notebook') {
    screen = <NotebookCompletion outcome={{ correctionsReleased: true, corrections: passage.trim() }} onNewPassage={() => setAppState('setup')} />;
  } else if (appState === 'finished') {
    screen = (
      <ResultsScreen
        sentences={sentences}
        typedSentences={allStudentInput}
        listenCounts={listenCounts}
        warnings={warnings}
        passageSource={passageSource}
        onReplaySentence={speakSentence}
        onRetry={startDictation}
        onNewPassage={() => setAppState('setup')}
      />
    );
  } else if (appState === 'dictating' && settings.mode === 'notebook') {
    screen = <NotebookScreen count={sentences.length} index={currentIndex}
      onMove={(index) => { setCurrentIndex(index); playNotebook(index); }}
      onRepeat={() => playNotebook(currentIndex)} onFinish={() => { stopNotebook(); setAppState('finished'); }}
      isSpeaking={notebookSpeaking} loading={notebookLoading} replaysLeft={null} error={notebookError}
      rate={settings.rate} onRateChange={changeNotebookRate} />;
  } else if (appState === 'dictating') {
    screen = (
      <DictationScreen
        sentenceCount={sentences.length}
        currentIndex={currentIndex}
        studentInput={studentInput}
        setStudentInput={setStudentInput}
        onSubmit={nextSentence}
        onRepeat={repeatSentence}
        onFinishEarly={finishEarly}
        replaysLeft={replaysLeft}
        isSpeaking={isSpeaking}
        warnings={warnings}
        rate={settings.rate}
        onRateChange={(rate) => setSettings({ ...settings, rate })}
        feedback={feedback}
        onContinue={continueAfterFeedback}
      />
    );
  } else {
    screen = (
      <SetupScreen
        passage={passage}
        setPassage={setPassage}
        settings={settings}
        setSettings={setSettings}
        onStart={startDictation}
        onFetchPassage={fetchPassage}
        fetchState={fetchState}
        passageSource={passageSource}
        onPickLesson={pickLesson}
      />
    );
  }

  return (
    <>
      {waking && <WakingOverlay onDismiss={dismissWaking} />}
      {screen}
    </>
  );
}

export default PracticeApp;
