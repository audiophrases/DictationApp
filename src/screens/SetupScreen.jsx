import { useEffect, useState } from 'react';
import { Play, Sparkles, Loader2, EyeOff, Eye, BookOpen, ClipboardList, GraduationCap } from 'lucide-react';
import { splitIntoSentences, countWords } from '../lib/sentences';
import { SPEEDS, LANGUAGES, FETCH_SUPPORTED, REPLAY_LIMITS, languageName } from '../lib/options';
import { hasLessons, fetchLessons } from '../lib/lessons';
import SourceCitation from '../components/SourceCitation';

function SetupScreen({
  passage,
  setPassage,
  settings,
  setSettings,
  onStart,
  onFetchPassage,
  fetchState,
  passageSource,
  onAssign,
  onPickLesson,
}) {
  const sentenceCount = splitIntoSentences(passage).length;
  const wordCount = countWords(passage);
  const canFetch = FETCH_SUPPORTED.has(settings.lang);
  const langName = languageName(settings.lang);

  // A fetched passage is text the student has not seen, so reading it here would
  // give the whole exercise away. Hand-typed text is exempt: they wrote it.
  // The reveal is for the person setting the exercise up, and resets with every
  // new fetch so it can't stay on by accident.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
  }, [passageSource?.text]);
  const hidden = !!passageSource && !revealed;

  // Lessons are fetched only once someone asks for them: each language's tab is
  // a ~200 KB download, and most sessions never open the picker.
  const [lessons, setLessons] = useState(null);
  const [lessonState, setLessonState] = useState({ loading: false, error: null });
  const lessonsAvailable = hasLessons(settings.lang);

  // A lesson list belongs to one language, so switching language drops it.
  useEffect(() => {
    setLessons(null);
    setLessonState({ loading: false, error: null });
  }, [settings.lang]);

  const loadLessons = async () => {
    setLessonState({ loading: true, error: null });
    try {
      setLessons(await fetchLessons(settings.lang));
      setLessonState({ loading: false, error: null });
    } catch (err) {
      setLessonState({ loading: false, error: err.message });
    }
  };

  const updateSetting = (key, value) => setSettings({ ...settings, [key]: value });

  return (
    <div className="app-container" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div className="app-header">
        <h1>Dictation Time</h1>
      </div>

      <div className="glass-panel animate-fade-in">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="settings-grid">
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Language</label>
              <select
                value={settings.lang}
                onChange={(e) => updateSetting('lang', e.target.value)}
                style={{ width: '100%' }}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Voice speed</label>
              <select
                value={settings.rate}
                onChange={(e) => updateSetting('rate', parseFloat(e.target.value))}
                style={{ width: '100%' }}
              >
                {SPEEDS.map((s) => (
                  <option key={s.value} value={s.value}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Replays allowed</label>
              <select
                value={settings.maxListens}
                onChange={(e) => updateSetting('maxListens', parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              >
                {REPLAY_LIMITS.map((r) => (
                  <option key={r.value} value={r.value}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="fetch-panel">
            <div className="fetch-panel-head">
              <Sparkles size={18} className="fetch-panel-icon" />
              <div>
                <div className="fetch-panel-title">Fetch a passage</div>
                <div className="fetch-panel-sub">
                  {canFetch
                    ? `A real, dated ${langName} passage from a plain-language encyclopedia — pick a length:`
                    : `Auto-fetch isn't available for ${langName} yet.`}
                </div>
              </div>
            </div>
            <div className="fetch-buttons">
              <button
                className="btn-ghost"
                onClick={() => onFetchPassage('short')}
                disabled={!canFetch || fetchState.loading}
              >
                {fetchState.loading ? <Loader2 size={16} className="spin" /> : null} Short
              </button>
              <button
                className="btn-ghost"
                onClick={() => onFetchPassage('medium')}
                disabled={!canFetch || fetchState.loading}
              >
                {fetchState.loading ? <Loader2 size={16} className="spin" /> : null} Medium
              </button>
              <button
                className="btn-ghost"
                onClick={() => onFetchPassage('long')}
                disabled={!canFetch || fetchState.loading}
              >
                {fetchState.loading ? <Loader2 size={16} className="spin" /> : null} Long
              </button>
            </div>
            {fetchState.error && <div className="fetch-error">{fetchState.error}</div>}
          </div>

          {lessonsAvailable && (
            <div className="fetch-panel">
              <div className="fetch-panel-head">
                <GraduationCap size={18} className="fetch-panel-icon" />
                <div>
                  <div className="fetch-panel-title">Lesson dictations</div>
                  <div className="fetch-panel-sub">
                    The same lessons as Speech to IPA — one lesson makes one dictation.
                  </div>
                </div>
              </div>

              {lessons ? (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const lesson = lessons.find((l) => l.id === e.target.value);
                    if (lesson) onPickLesson(lesson);
                  }}
                  style={{ width: '100%' }}
                >
                  <option value="" disabled>
                    Choose a lesson…
                  </option>
                  {lessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title} · {l.sentences.length} sentence{l.sentences.length !== 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <button className="btn-ghost" onClick={loadLessons} disabled={lessonState.loading}>
                  {lessonState.loading
                    ? <><Loader2 size={16} className="spin" /> Loading lessons…</>
                    : <>Browse {langName} lessons</>}
                </button>
              )}

              {lessonState.error && <div className="fetch-error">{lessonState.error}</div>}
            </div>
          )}

          <div>
            <div className="passage-label-row">
              <label style={{ fontWeight: 500 }}>Passage to Dictate</label>
              {passageSource && (
                <button className="btn-ghost btn-small" onClick={() => setRevealed((r) => !r)}>
                  {revealed ? <><EyeOff size={15} /> Hide text</> : <><Eye size={15} /> Show text</>}
                </button>
              )}
            </div>

            {hidden ? (
              <div className="passage-cover">
                <BookOpen size={20} className="passage-cover-icon" />
                <div>
                  <div className="passage-cover-title">
                    Passage ready — {sentenceCount} sentence{sentenceCount !== 1 ? 's' : ''}
                  </div>
                  <div className="passage-cover-sub">
                    From {passageSource.source}. Hidden so you hear it before you read it.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <textarea
                  value={passage}
                  onChange={(e) => setPassage(e.target.value)}
                  placeholder="Paste your own text, or use “Fetch a passage” above..."
                  style={{ minHeight: '200px' }}
                />
                {passage.trim() && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {sentenceCount} sentence{sentenceCount !== 1 ? 's' : ''} · {wordCount} word{wordCount !== 1 ? 's' : ''}
                  </p>
                )}
                <SourceCitation source={passageSource} />
              </>
            )}
          </div>

          <button
            className="btn-primary"
            style={{ width: '100%', padding: '1rem', fontSize: '1.125rem' }}
            onClick={onStart}
            disabled={!passage.trim()}
          >
            <Play size={24} /> Start Dictation Session
          </button>

          {onAssign && (
            <button
              className="btn-ghost"
              style={{ width: '100%' }}
              onClick={onAssign}
              disabled={!passage.trim()}
              title="Set this passage as homework for your class"
            >
              <ClipboardList size={18} /> Set as an assignment…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SetupScreen;
