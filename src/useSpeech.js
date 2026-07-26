import { useState, useEffect, useCallback, useRef } from 'react';

// How many fetched clips to keep alive at once. A session only needs the current
// sentence and the next one; the rest of the budget covers replays and clicking
// around the results screen.
const MAX_PREFETCHED = 12;

function ttsUrl(text, langCode, rate) {
  return `/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(langCode)}&rate=${encodeURIComponent(rate)}`;
}

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef(null);
  // url -> blob: URL for clips already downloaded. Insertion order is eviction
  // order, and every entry must be revoked when dropped or the blob leaks.
  const clipsRef = useRef(new Map());
  const inFlightRef = useRef(new Set());

  // Cleanup on unmount
  useEffect(() => {
    const clips = clipsRef.current;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      for (const blobUrl of clips.values()) URL.revokeObjectURL(blobUrl);
      clips.clear();
    };
  }, []);

  /**
   * Downloads a sentence's audio ahead of time so playback can start with no
   * network wait. Deliberately silent: failures are ignored (the real playback
   * path will surface them) and it never signals that someone is waiting on
   * audio, so it can never raise the waking overlay.
   */
  const prefetch = useCallback((text, langCode, { rate = 1 } = {}) => {
    if (!text) return;
    const url = ttsUrl(text, langCode, rate);
    const clips = clipsRef.current;
    if (clips.has(url) || inFlightRef.current.has(url)) return;

    inFlightRef.current.add(url);
    fetch(url)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        // A concurrent request for the same URL may have stored one already.
        if (!blob || clips.has(url)) return;
        clips.set(url, URL.createObjectURL(blob));
        while (clips.size > MAX_PREFETCHED) {
          const oldest = clips.keys().next();
          if (oldest.done) break;
          URL.revokeObjectURL(clips.get(oldest.value));
          clips.delete(oldest.value);
        }
      })
      .catch(() => {
        // Offline, server asleep, upstream hiccup — speak() will request it for
        // real and report properly if that fails too.
      })
      .finally(() => {
        inFlightRef.current.delete(url);
      });
  }, []);

  const speak = useCallback((text, langCode, { rate = 1, onEnd } = {}) => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const url = ttsUrl(text, langCode, rate);
    // Use the prefetched clip when it's ready, otherwise hit the URL exactly as
    // before. This stays synchronous on purpose: awaiting a fetch here would move
    // play() outside the user's click and risk tripping autoplay blocking, so a
    // cache miss must behave identically to having no prefetch at all.
    const audio = new Audio(clipsRef.current.get(url) || url);
    audioRef.current = audio;

    const finish = () => {
      // Only react if this is still the active audio (a newer speak() may
      // have replaced it)
      if (audioRef.current === audio) {
        setIsSpeaking(false);
      }
      if (onEnd) onEnd();
    };

    audio.onplaying = () => {
      if (audioRef.current === audio) setIsSpeaking(true);
    };
    audio.onended = finish;
    audio.onerror = (e) => {
      console.error('Audio playback error:', e);
      finish(); // Proceed so the session doesn't get stuck
    };

    audio.play().catch((e) => {
      console.error('Audio play blocked or failed:', e);
      finish();
    });
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  return { speak, prefetch, stop, isSpeaking };
}
