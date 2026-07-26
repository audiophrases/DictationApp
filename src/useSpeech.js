import { useState, useEffect, useCallback, useRef } from 'react';

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const speak = useCallback((text, langCode, { rate = 1, onEnd } = {}) => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const url = `/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(langCode)}&rate=${encodeURIComponent(rate)}`;

    const audio = new Audio(url);
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

  return { speak, stop, isSpeaking };
}
