import { Play, Sparkles, Loader2 } from 'lucide-react';
import { splitIntoSentences, countWords } from '../lib/sentences';
import { SPEEDS } from '../lib/options';
import SourceCitation from '../components/SourceCitation';

// Wikipedia editions are only available for languages we can map server-side.
const FETCH_SUPPORTED = new Set([
  'en-US', 'ca-ES', 'fr-FR', 'es-ES', 'de-DE', 'it-IT', 'pt-PT',
  'ar-MA', 'ru-RU', 'uk-UA', 'ro-RO',
]);

const LANGUAGES = [
  { code: 'ca-ES', name: 'Catalan' },
  { code: 'en-US', name: 'English' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'ar-MA', name: 'Moroccan Darija' },
  { code: 'pt-PT', name: 'Portuguese' },
  { code: 'ro-RO', name: 'Romanian' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'uk-UA', name: 'Ukrainian' },
];

const REPLAY_LIMITS = [
  { value: 0, name: 'Unlimited replays' },
  { value: 1, name: '1 replay per sentence' },
  { value: 2, name: '2 replays per sentence' },
  { value: 3, name: '3 replays per sentence' },
];

function SetupScreen({
  passage,
  setPassage,
  settings,
  setSettings,
  onStart,
  onFetchPassage,
  fetchState,
  passageSource,
}) {
  const sentenceCount = splitIntoSentences(passage).length;
  const wordCount = countWords(passage);
  const canFetch = FETCH_SUPPORTED.has(settings.lang);
  const langName = LANGUAGES.find((l) => l.code === settings.lang)?.name || 'this language';

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

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Passage to Dictate</label>
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
          </div>

          <button
            className="btn-primary"
            style={{ width: '100%', padding: '1rem', fontSize: '1.125rem' }}
            onClick={onStart}
            disabled={!passage.trim()}
          >
            <Play size={24} /> Start Dictation Session
          </button>
        </div>
      </div>
    </div>
  );
}

export default SetupScreen;
