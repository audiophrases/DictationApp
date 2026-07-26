import { useEffect, useState } from 'react';

// How long a health check gets before we conclude the server is cold-starting
// (Render's free tier can take up to ~50s to wake from sleep). The local
// production server never sleeps, so it gets a much shorter budget — if
// something (antivirus, a browser extension, first-run disk I/O) ever slows
// that one fetch down, this bounds the worst case to a few seconds instead of
// up to a minute.
const STARTUP_HEALTH_TIMEOUT_MS = 55000;
const LOCAL_HEALTH_TIMEOUT_MS = 4000;
// Only flip on the "please wait" overlay if the check is still pending after
// this long — an already-warm server (or the local production server, which
// never sleeps) resolves well under this, so those users never see it.
const OVERLAY_DELAY_MS = 900;
const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;

function isLocalHost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

async function pingHealth(timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('/health', { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Warms the server on mount (same-origin /health — works unmodified whether
 * this page is served by the local production server or a Render deploy) and
 * reports whether the "waking up" overlay should be shown. Re-checks when the
 * tab regains visibility (covers a Render free-tier re-sleep while the tab
 * was backgrounded past the keep-alive interval) and keeps the deployed
 * server warm with a periodic ping while the tab is visible.
 *
 * Returns [waking, dismiss] — dismiss lets the student close the overlay by
 * hand. The overlay is purely informational (the app works the moment the
 * server responds regardless), so nothing should ever be able to trap
 * someone behind it if detection itself misbehaves.
 */
export function useServerReady() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let overlayTimer = null;

    const check = () => {
      overlayTimer = setTimeout(() => {
        if (!cancelled) setWaking(true);
      }, OVERLAY_DELAY_MS);
      const timeout = isLocalHost() ? LOCAL_HEALTH_TIMEOUT_MS : STARTUP_HEALTH_TIMEOUT_MS;
      pingHealth(timeout).finally(() => {
        clearTimeout(overlayTimer);
        if (!cancelled) setWaking(false);
      });
    };

    check();

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);

    let keepAliveId = null;
    if (!isLocalHost()) {
      keepAliveId = setInterval(() => {
        if (document.visibilityState === 'visible') pingHealth(5000);
      }, KEEP_ALIVE_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      clearTimeout(overlayTimer);
      document.removeEventListener('visibilitychange', onVisible);
      if (keepAliveId) clearInterval(keepAliveId);
    };
  }, []);

  const dismiss = () => setWaking(false);
  return [waking, dismiss];
}
