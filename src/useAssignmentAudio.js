import { useCallback, useEffect, useRef, useState } from 'react';
import { sentenceAudioUrl } from './lib/assignmentApi';

/**
 * Playback for an assignment, where the student's browser knows sentence
 * numbers but never the words. Each request asks the worker for "sentence 3"
 * and gets back an MP3.
 *
 * Two details matter here:
 *
 * 1. play() is synchronous, exactly like useSpeech.speak — the URL is handed
 *    to an Audio element inside the click that asked for it. Awaiting a fetch
 *    first would move play() outside the user gesture and risk tripping
 *    autoplay blocking.
 * 2. Every request the worker serves counts as one play, so prefetching is only
 *    safe when replays are unlimited. When they are, the prefetched clip is
 *    used for the *first* play only; a replay always goes back to the server,
 *    which keeps the teacher's play count honest either way.
 */
export function useAssignmentAudio({ code, attemptId, maxListens, initialListens }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [listens, setListens] = useState(() => ({ ...(initialListens || {}) }));
  const [error, setError] = useState('');
  const audioRef = useRef(null);
  const clipsRef = useRef(new Map());
  const inFlightRef = useRef(new Set());

  useEffect(() => {
    const clips = clipsRef.current;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      for (const url of clips.values()) URL.revokeObjectURL(url);
      clips.clear();
    };
  }, []);

  const unlimited = maxListens === 0;

  const prefetch = useCallback(
    (index) => {
      if (!unlimited || index == null || index < 0 || !attemptId) return;
      const clips = clipsRef.current;
      if (clips.has(index) || inFlightRef.current.has(index)) return;

      inFlightRef.current.add(index);
      fetch(sentenceAudioUrl(code, index, attemptId))
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (!blob || clips.has(index)) return;
          clips.set(index, URL.createObjectURL(blob));
          // One sentence ahead is all this ever holds.
          for (const key of clips.keys()) {
            if (key < index - 1) {
              URL.revokeObjectURL(clips.get(key));
              clips.delete(key);
            }
          }
        })
        .catch(() => {
          // Best effort; play() will request it for real.
        })
        .finally(() => inFlightRef.current.delete(index));
    },
    [code, attemptId, unlimited]
  );

  const play = useCallback(
    (index, { replay = false } = {}) => {
      if (audioRef.current) audioRef.current.pause();
      setError('');

      const clips = clipsRef.current;
      let url;
      if (!replay && clips.has(index)) {
        // Already paid for by the prefetch, so this play is not a new request.
        url = clips.get(index);
      } else {
        url = sentenceAudioUrl(code, index, attemptId);
        setListens((prev) => ({ ...prev, [index]: (prev[index] || 0) + 1 }));
      }

      const audio = new Audio(url);
      audioRef.current = audio;

      const finish = () => {
        if (audioRef.current === audio) setIsSpeaking(false);
      };
      audio.onplaying = () => {
        if (audioRef.current === audio) setIsSpeaking(true);
      };
      audio.onended = finish;
      audio.onerror = () => {
        setError("That sentence wouldn't play. Try Listen Again.");
        finish();
      };
      audio.play().catch(() => {
        setError("That sentence wouldn't play. Try Listen Again.");
        finish();
      });
    },
    [code, attemptId]
  );

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  // Allowance is maxListens + 1: hearing a sentence for the first time is not
  // a replay. The worker enforces the same sum — this only keeps the button and
  // the counter on screen truthful.
  const replaysLeftFor = useCallback(
    (index) => (unlimited ? null : Math.max(0, maxListens + 1 - (listens[index] || 0))),
    [unlimited, maxListens, listens]
  );

  return { play, prefetch, stop, isSpeaking, listens, replaysLeftFor, error };
}
