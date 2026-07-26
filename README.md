# Dictation Time

A dictation practice app: type what you hear, read aloud with natural neural
voices across several languages/dialects, or auto-fetch a real practice
passage from a plain-language encyclopedia.

## Running locally

**Windows (easiest):** double-click `start_local.bat`. It installs
dependencies on first run, builds the app, starts a local server with neural
voices, and opens your browser at `http://127.0.0.1:4173`. Keep the console
window open while using the app; close it to stop.

Requires [Node.js](https://nodejs.org). For active development instead, use
`npm run dev` (or double-click `start_debug.bat`), which runs Vite's dev
server with hot reload on port 5173 — the same `/api/tts` and
`/api/dictation` endpoints work there too.

## Deploying for students (Render)

For students who can't install anything locally (no admin rights,
Chromebooks), deploy this app to Render's free tier — the same server that
runs locally also serves the built app and the voice APIs once deployed:

1. Push this repo to GitHub.
2. In the [Render dashboard](https://dashboard.render.com): **New +** →
   **Blueprint** → pick the repo. Render reads [render.yaml](render.yaml) and
   pre-fills everything (no manual config).
3. Share the resulting `https://….onrender.com` URL with students.

No card is required on Render's free tier. It sleeps after ~15 minutes idle;
the app pings `/health` on load and shows a "waking up" overlay during the
~30-60s cold start so it doesn't look broken, and pings periodically while a
tab stays open and visible to avoid re-sleeping mid-lesson.

## Voices

Neural voices come from Microsoft Edge's Read Aloud endpoint via
`msedge-tts` (`server/tts.js`) — no account or API key needed. If Microsoft
ever locks down that unofficial endpoint, the same voice names work on the
official Azure Speech free tier (500K chars/month); only the synthesis call
would need swapping.
