import { useCallback, useEffect, useRef, useState } from 'react';
import { ttsBase } from './lib/api';

// How long a health check gets before we give up waiting on it. A free-tier
// host can take ~50s to wake from sleep; the local production server never
// sleeps, so it gets a much shorter budget — if something on the machine
// (antivirus, a browser extension) slows that one fetch down, this bounds the
// worst case to a few seconds.
const REMOTE_HEALTH_TIMEOUT_MS = 55000;
const LOCAL_HEALTH_TIMEOUT_MS = 4000;
// Grace period before the overlay appears once audio is actually wanted, so a
// server that answers promptly never flashes it.
const OVERLAY_DELAY_MS = 600;
const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;

// Whether the voice server this copy talks to is the one on this machine.
// ttsBase() is '' for the portable pack, start_local.bat and `vite dev`, and an
// absolute Render URL once the app is served from GitHub Pages.
function isLocalServer() {
  if (ttsBase()) return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

async function pingHealth(timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${ttsBase()}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Warms the server in the background on mount — same-origin /health, so it
 * works unmodified under the local production server or a hosted deploy. On a
 * free-tier host that ping is what wakes a sleeping instance, so the cold
 * start happens while the page is being read rather than when audio is first
 * needed.
 *
 * That warm-up is deliberately invisible: page load never shows an overlay.
 * The overlay appears only once `requireServer()` says audio is actually
 * wanted AND the check hasn't settled yet — i.e. only when someone is really
 * waiting on it. "Settled" means the check finished either way: if it failed
 * there is no server to wait for (e.g. a static host with no /health), so
 * playback should just proceed and fall back rather than hang behind a
 * spinner that would never clear.
 *
 * Pass `enabled: false` when this session will never ask the voice server for
 * anything — an assignment plays pre-recorded audio from the worker instead, so
 * waking Render for it would be pure waste (and its keep-alive pings noise).
 *
 * Returns { waking, requireServer, dismiss }.
 */
export function useServerReady({ enabled = true } = {}) {
  const [settled, setSettled] = useState(!enabled);
  const [audioWanted, setAudioWanted] = useState(false);
  const settledRef = useRef(!enabled);

  useEffect(() => {
    if (!enabled) {
      settledRef.current = true;
      setSettled(true);
      return undefined;
    }
    let cancelled = false;

    const markSettled = () => {
      if (cancelled) return;
      settledRef.current = true;
      setSettled(true);
    };

    const timeout = isLocalServer() ? LOCAL_HEALTH_TIMEOUT_MS : REMOTE_HEALTH_TIMEOUT_MS;
    pingHealth(timeout).finally(markSettled);

    // Keep a deployed instance from idling back to sleep mid-lesson, and
    // re-warm it after the tab has been in the background. Both are silent —
    // they never gate the overlay.
    let keepAliveId = null;
    let onVisible = null;
    if (!isLocalServer()) {
      keepAliveId = setInterval(() => {
        if (document.visibilityState === 'visible') pingHealth(5000);
      }, KEEP_ALIVE_INTERVAL_MS);
      onVisible = () => {
        if (document.visibilityState === 'visible') pingHealth(REMOTE_HEALTH_TIMEOUT_MS);
      };
      document.addEventListener('visibilitychange', onVisible);
    }

    return () => {
      cancelled = true;
      if (keepAliveId) clearInterval(keepAliveId);
      if (onVisible) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  // Called right before playback. Only flags that someone is waiting; if the
  // check already settled this is a no-op and no overlay ever appears.
  const requireServer = useCallback(() => {
    if (!settledRef.current) setAudioWanted(true);
  }, []);

  const [graceElapsed, setGraceElapsed] = useState(false);
  useEffect(() => {
    if (!audioWanted || settled) {
      setGraceElapsed(false);
      return;
    }
    const t = setTimeout(() => setGraceElapsed(true), OVERLAY_DELAY_MS);
    return () => clearTimeout(t);
  }, [audioWanted, settled]);

  const dismiss = useCallback(() => setAudioWanted(false), []);

  return { waking: audioWanted && !settled && graceElapsed, requireServer, dismiss };
}
