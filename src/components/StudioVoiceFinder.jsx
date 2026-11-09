import { useEffect, useMemo, useRef, useState } from 'react';
import {
  accentName, catalogPath, counted, finderLabel, finderMatches, finderName, finderStart, finderVoices,
  studioApi, studioLanguage,
} from '../lib/listeningStudio';

// 🌍 Find a voice, as in Listening Studio: real voices from open recordings.
// "Use this voice" adds it to the studio's voice library (once, with its
// credit) and chooses it for this dictation.
const PAGE = 20;
const ABOUT = {
  readers: 'LibriVox volunteers reading audiobooks, cleaned in a studio (free to use with credit). “Calm” voices copy best.',
  accents: 'People from all over the world reading the same English paragraph (Speech Accent Archive, George Mason University: free for teaching, not for selling).',
};
const GENDERS = [['', 'Any'], ['female', 'Woman'], ['male', 'Man']];
const PITCHES = [['', 'Any'], ['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High']];
const PACES = [['', 'Any'], ['slow', 'Slow'], ['moderate', 'Moderate'], ['fast', 'Fast']];
const MANNERS = [['calm', 'Calm (copies best)'], ['mixed', 'Calm or lively'], ['any', 'Any']];
const AGES = [['', 'Any'], ['young', 'Under 30'], ['middle', '30–49'], ['older', '50 or more']];

// About 400 KB: fetched once per visit to the page.
let catalogLoad = null;
function loadCatalog() {
  if (!catalogLoad) catalogLoad = studioApi('catalog').catch((err) => { catalogLoad = null; throw err; });
  return catalogLoad;
}

function Choice({ label, value, options, onChange }) {
  return <label className="field-label">{label}
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  </label>;
}

export default function StudioVoiceFinder({ lang, library, onUse }) {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState(null); // { tab, f }
  const [shown, setShown] = useState(PAGE);
  const [pending, setPending] = useState(null); // { key, what: 'listen' | 'add' }
  const [itemError, setItemError] = useState(null); // { key, message }
  const [listening, setListening] = useState(null); // { key, url }
  const player = useRef(null);
  const controller = useRef(null);
  const language = studioLanguage(lang) || 'English';

  useEffect(() => {
    let live = true;
    loadCatalog().then((data) => { if (live) { setCatalog(data); setView(finderStart(data, lang)); } })
      .catch((err) => {
        if (live) setLoadError(err.status === 404 ? 'This copy of Listening Studio has no voice catalog yet. Update PinPlay on this computer to find voices here.' : err.message);
      });
    return () => { live = false; controller.current?.abort(); };
  }, [lang]);
  useEffect(() => () => { if (listening?.url) URL.revokeObjectURL(listening.url); }, [listening]);

  // Library voices that came from the catalog: chosen again, never added twice.
  const inLibrary = useMemo(() => new Map(library.filter((v) => v.catalogKey).map((v) => [v.catalogKey, v])), [library]);

  if (loadError) return <p className="fetch-error" role="alert">{loadError}</p>;
  if (!catalog || !view) return <p role="status">Loading the voice catalog…</p>;

  const { tab, f } = view;
  const all = finderVoices(catalog, tab);
  const found = finderMatches(catalog, tab, f);
  const set = (changes) => { setView((current) => ({ ...current, f: { ...current.f, ...changes } })); setShown(PAGE); };
  const switchTab = (next) => { setView((current) => ({ tab: next, f: { ...current.f, gender: '' } })); setShown(PAGE); };

  async function act(v, what, action) {
    const current = new AbortController();
    controller.current = current;
    setPending({ key: v.key, what });
    setItemError(null);
    try { await action(current.signal); }
    catch (err) {
      if (!current.signal.aborted) setItemError({ key: v.key, message: err.message });
    } finally {
      if (!current.signal.aborted) setPending(null);
      if (controller.current === current) controller.current = null;
    }
  }

  const listen = (v) => {
    if (listening?.key === v.key && player.current) {
      player.current.currentTime = 0;
      player.current.play().catch(() => {});
      return;
    }
    act(v, 'listen', async (signal) => {
      const own = inLibrary.get(v.key);
      const bytes = await studioApi(own ? `library/${own.id}/audio` : catalogPath(v.key, 'audio'), { binary: true, signal });
      setListening({ key: v.key, url: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })) });
    });
  };

  const use = (v) => act(v, 'add', async (signal) => {
    const own = inLibrary.get(v.key);
    if (own) { await onUse(own, false); return; }
    const { voice } = await studioApi(catalogPath(v.key, 'add'), { method: 'POST', body: { name: finderName(v) }, signal });
    await onUse(voice, true);
  });

  const readerLanguages = counted(finderVoices(catalog, 'readers'), 'language').map(([v, n]) => [v, `${v} (${n})`]);
  const languageReaders = all.filter((v) => v.language === f.readerLanguage);
  const accents = counted(languageReaders, 'accent').map(([v, n]) => [v, `${accentName(v)} (${n})`]);
  const firstLanguages = counted(all, 'language').map(([v, n]) => [v, `${v} (${n})`]);
  const otherLanguage = tab === 'readers' ? f.readerLanguage !== language : language !== 'English';

  return <div className="studio-finder">
    <div className="studio-finder-tabs" role="tablist" aria-label="Kind of voice">
      <button type="button" role="tab" aria-selected={tab === 'readers'} className={tab === 'readers' ? 'is-current' : ''}
        onClick={() => switchTab('readers')}>Native readers</button>
      <button type="button" role="tab" aria-selected={tab === 'accents'} className={tab === 'accents' ? 'is-current' : ''}
        onClick={() => switchTab('accents')}>English with an accent</button>
    </div>
    <p className="field-hint">{ABOUT[tab]}</p>

    <div className="studio-finder-filters">
      {tab === 'readers' ? <>
        <Choice label="Language" value={f.readerLanguage} options={readerLanguages} onChange={(value) => set({ readerLanguage: value, accent: '' })} />
        {accents.length > 0 && <Choice label="Accent" value={f.accent} options={[['', 'Any'], ...accents]} onChange={(value) => set({ accent: value })} />}
        <Choice label="Man or woman" value={f.gender} options={GENDERS} onChange={(value) => set({ gender: value })} />
        <Choice label="Pitch" value={f.pitch} options={PITCHES} onChange={(value) => set({ pitch: value })} />
        <Choice label="Manner" value={f.manner} options={MANNERS} onChange={(value) => set({ manner: value })} />
        <Choice label="Pace" value={f.pace} options={PACES} onChange={(value) => set({ pace: value })} />
      </> : <>
        <Choice label="First language" value={f.language} options={firstLanguages} onChange={(value) => set({ language: value })} />
        <Choice label="Man or woman" value={f.gender} options={GENDERS} onChange={(value) => set({ gender: value })} />
        <Choice label="Age" value={f.age} options={AGES} onChange={(value) => set({ age: value })} />
      </>}
    </div>
    {otherLanguage && <p className="field-hint">These samples are in {tab === 'readers' ? f.readerLanguage : 'English'}: the copied voice reads your {language} sentences. Listen to its voice sample before you use it.</p>}

    <p role="status" className="field-hint">{found.length} voice{found.length === 1 ? '' : 's'}</p>
    <ul className="studio-finder-list">
      {found.slice(0, shown).map((v) => {
        const { title, detail } = finderLabel(v);
        const here = pending?.key === v.key;
        return <li key={v.key}>
          <div>
            <strong>{title}</strong>{inLibrary.has(v.key) && <span className="studio-check studio-check-ok"> · in your library</span>}
            <span className="field-hint studio-heard">{detail}</span>
          </div>
          <span className="studio-line-actions">
            <button type="button" className="btn-ghost btn-small" disabled={!!pending} onClick={() => listen(v)}>
              {here && pending.what === 'listen' ? '⏳ Fetching…' : '▶ Listen'}</button>
            <button type="button" className="btn-ghost btn-small" disabled={!!pending} onClick={() => use(v)}>
              {here && pending.what === 'add' ? (v.text ? '⏳ Adding…' : '⏳ Adding (about a minute)…') : 'Use this voice'}</button>
          </span>
          {listening?.key === v.key && <audio ref={player} src={listening.url} controls autoPlay style={{ width: '100%' }} />}
          {itemError?.key === v.key && <p className="fetch-error" role="alert">{itemError.message}</p>}
        </li>;
      })}
    </ul>
    {found.length > shown && <button type="button" className="btn-ghost btn-small" onClick={() => setShown((n) => n + PAGE)}>
      Show more ({found.length - shown} left)</button>}
    {!found.length && <p className="field-hint">No voice matches: change a filter.</p>}
    <p className="field-hint">The first listen to a voice fetches it from the internet (up to a minute); after that it plays at once. “Use this voice” adds it to Listening Studio’s voice library, with its credit, and chooses it for this dictation.</p>
  </div>;
}
