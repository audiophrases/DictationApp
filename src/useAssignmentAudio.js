import { useCallback, useEffect, useRef, useState } from 'react';
import { authorizeCachedAudio, cachedAudioUrl, sentenceAudioUrl } from './lib/assignmentApi';
import { AssignmentAudioCache } from './lib/assignmentAudioCache';
import { decryptAudio } from './lib/audioCipher';

/**
 * Download encrypted recordings in the background. Every actual play still
 * asks the worker to count the listen before unlocking the local clip.
 *
 * Reuse one audio element. The first clip streams with play() inside the user's
 * gesture. Once allowed to play, that same element can switch to a local blob
 * after the small authorization request without losing playback permission.
 */
export function useAssignmentAudio({ code, attemptId, maxListens, initialListens, playbackRate = 1, preload = false }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [listens, setListens] = useState(() => ({ ...(initialListens || {}) }));
  const [error, setError] = useState('');
  const audioRef = useRef(null);
  const cacheRef = useRef(null);
  const unlockedRef = useRef(false);
  const sequenceRef = useRef(0);
  const blobRef = useRef(null);
  const pendingRef = useRef(null);
  const loadingTimerRef = useRef(null);

  useEffect(() => { setListens({ ...(initialListens || {}) }); }, [initialListens]);

  const stop = useCallback(() => {
    sequenceRef.current += 1;
    clearTimeout(loadingTimerRef.current);
    if (audioRef.current) {
      audioRef.current.onplaying = null;
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
    }
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = null;
    pendingRef.current = null;
    setIsSpeaking(false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const cache = preload && attemptId && globalThis.crypto?.subtle
      ? new AssignmentAudioCache({ urlFor: (index) => cachedAudioUrl(code, index, attemptId) }) : null;
    cacheRef.current = cache;
    return () => {
      cache?.dispose();
      cacheRef.current = null;
      stop();
      if (audioRef.current) {
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
      audioRef.current = null;
      unlockedRef.current = false;
    };
  }, [code, attemptId, preload, stop]);

  const prefetch = useCallback((count, currentIndex) => {
    cacheRef.current?.prefetch(count, currentIndex);
  }, []);

  const play = useCallback((index) => {
    // Repeated clicks while loading must not spend another listen.
    if (pendingRef.current?.index === index && pendingRef.current.loading) return;
    const retry = pendingRef.current?.index === index && pendingRef.current.blocked;
    if (!retry) stop();
    const sequence = ++sequenceRef.current;
    const current = () => sequenceRef.current === sequence;
    const audio = audioRef.current || (audioRef.current = new Audio());
    setError('');
    setIsLoading(true);
    pendingRef.current = { index, loading: true };

    const finish = () => {
      if (!current()) return;
      clearTimeout(loadingTimerRef.current);
      setIsSpeaking(false);
      setIsLoading(false);
    };
    const failed = (err) => {
      if (!current()) return;
      // Retry an already authorized clip after autoplay was blocked, without
      // spending another listen. Keep the source on this same media element.
      pendingRef.current = err?.name === 'NotAllowedError' ? { index, blocked: true } : null;
      setError(err?.name === 'NotAllowedError'
        ? 'Press Listen Again to start the audio.'
        : err?.message || "That recording wouldn't play. Try Listen Again.");
      finish();
    };
    audio.onplaying = () => {
      if (!current()) return;
      clearTimeout(loadingTimerRef.current);
      pendingRef.current = null;
      setIsLoading(false);
      setIsSpeaking(true);
    };
    audio.onended = finish;
    audio.onerror = () => failed(new Error("That recording wouldn't play. Try Listen Again."));
    loadingTimerRef.current = setTimeout(() => {
      if (!current()) return;
      failed(new Error('Audio took too long to load. Check your connection and try again.'));
      sequenceRef.current += 1;
      audio.pause();
    }, 20000);
    const start = (url) => {
      if (!current()) return;
      audio.defaultPlaybackRate = playbackRate;
      if (url) audio.src = url;
      audio.playbackRate = playbackRate;
      audio.preservesPitch = true;
      audio.play().then(() => { if (current()) unlockedRef.current = true; }).catch(failed);
    };
    const stream = () => {
      if (!current()) return;
      setListens((prev) => ({ ...prev, [index]: (prev[index] || 0) + 1 }));
      start(sentenceAudioUrl(code, index, attemptId));
    };

    if (retry) {
      start();
      return;
    }
    const cache = cacheRef.current;
    const clip = unlockedRef.current && cache?.get(index);
    if (!clip) {
      stream();
      return;
    }
    authorizeCachedAudio(code, index, attemptId, clip.version).then(async (authorization) => {
      if (cacheRef.current !== cache) return;
      setListens((prev) => ({ ...prev, [index]: authorization.listens }));
      if (!current()) return;
      // Authorization counted a play, so a decryption failure must not fall
      // through to another metered download. Evict and report a manual retry.
      let blob;
      try {
        blob = await decryptAudio(clip.bytes, authorization.key, clip.type);
      } catch {
        cache.delete(index);
        throw new Error("That recording wouldn't load. Try Listen Again.");
      }
      if (!current()) return;
      blobRef.current = URL.createObjectURL(blob);
      start(blobRef.current);
    }, (err) => {
      if (cacheRef.current === cache && err.status === 403) {
        setListens((prev) => ({ ...prev, [index]: maxListens + 1 }));
      }
      if (!current()) return;
      // These failures consume no listen, so streaming the replacement is safe.
      if (err.status === 409 || err.status === 404) {
        cache.delete(index);
        stream();
      } else {
        failed(err);
      }
    }).catch(failed);
  }, [code, attemptId, playbackRate, maxListens, stop]);

  const replaysLeftFor = useCallback(
    (index) => (maxListens === 0 ? null : Math.max(
      pendingRef.current?.index === index && pendingRef.current.blocked ? 1 : 0,
      maxListens + 1 - (listens[index] || 0)
    )),
    [maxListens, listens]
  );

  return { play, prefetch, stop, isSpeaking, isLoading, listens, replaysLeftFor, error };
}
