import { useState, useEffect } from 'react';
import { useSpeech } from './useSpeech';
import { useServerReady } from './useServerReady';
import SetupScreen from './screens/SetupScreen';
import DictationScreen from './screens/DictationScreen';
import ResultsScreen from './screens/ResultsScreen';
import WakingOverlay from './components/WakingOverlay';
import { splitIntoSentences } from './lib/sentences';
import { ttsBase } from './lib/api';
import { lessonToPassage } from './lib/lessons';

const SETTINGS_KEY = 'dictation.settings';
const PASSAGE_KEY = 'dictation.passage';
const SOURCE_KEY = 'dictation.source';

const DEFAULT_SETTINGS = { lang: 'en-US', rate: 1, maxListens: 0 };

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
function PracticeApp({ onOpenTeacher }) {
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
    if (appState !== 'dictating') return;

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
  }, [appState]);

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
    if (appState !== 'dictating') return;
    prefetch(sentences[currentIndex + 1], settings.lang, { rate: settings.rate });
  }, [appState, sentences, currentIndex, settings.lang, settings.rate, prefetch]);

  // The first sentence is the wait every student notices, so warm it while the
  // setup screen is still up. Debounced so typing a passage by hand doesn't
  // fire a request per keystroke. The text is not on screen while this happens
  // if the passage was fetched — only the audio is being readied.
  useEffect(() => {
    if (appState !== 'setup' || !passage.trim()) return;
    const timer = setTimeout(() => {
      const [first] = splitIntoSentences(passage);
      prefetch(first, settings.lang, { rate: settings.rate });
    }, 800);
    return () => clearTimeout(timer);
  }, [appState, passage, settings.lang, settings.rate, prefetch]);

  const startDictation = () => {
    const cleanedSentences = splitIntoSentences(passage);
    if (cleanedSentences.length === 0) return;

    setSentences(cleanedSentences);
    setCurrentIndex(0);
    setStudentInput('');
    setAllStudentInput([]);
    setListenCounts(cleanedSentences.map(() => 0));
    setWarnings(0);
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

  const nextSentence = () => {
    const newAllInput = [...allStudentInput, studentInput];
    setStudentInput('');

    if (currentIndex + 1 < sentences.length) {
      setAllStudentInput(newAllInput);
      setCurrentIndex(currentIndex + 1);
      speakSentence(sentences[currentIndex + 1]);
    } else {
      finishSession(newAllInput);
    }
  };

  const finishEarly = () => {
    const inputs = studentInput.trim()
      ? [...allStudentInput, studentInput]
      : allStudentInput;
    finishSession(inputs);
  };

  let screen;
  if (appState === 'finished') {
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
        onAssign={() => onOpenTeacher({ passage, settings, source: passageSource })}
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
