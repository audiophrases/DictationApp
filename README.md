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

## Giving students a portable copy (Windows, no admin)

`npm run pack:win` builds `pack/DictationTime-Windows.zip` (~33 MB): a folder a
student extracts and double-clicks, with **no installer, no Node.js install and
no administrator rights** at any point. It bundles `node.exe`, the server as one
esbuild'd file, and the prebuilt UI, so launching is immediate — unlike
`start_local.bat`, which reinstalls and rebuilds on every run and needs Node
already present (an admin-gated MSI).

Two details make the no-admin claim real, and both are load-bearing:

- The server binds **loopback only** by default. Listening on all interfaces
  makes Windows Defender ask permission, and that dialog needs an
  administrator. Hosts that must accept outside traffic set `HOST=0.0.0.0`
  ([render.yaml](render.yaml) does).
- Voice audio is cached under `%TEMP%`, inside the student's own profile.
  Set `TTS_CACHE_DIR` to keep it elsewhere (e.g. on the USB stick).

Still expect two things: Windows shows an unrecognised-app warning on first run
(**More info → Run anyway**), and school-managed PCs sometimes block
executables outside `Program Files` by policy — so **try the pack on one
student machine before handing it to a class.** If policy blocks it, the hosted
URL below is unaffected.

## Installing it on a Chromebook

Chromebooks can't run the pack (Windows binary, and Linux/Crostini is
admin-locked), so they use the hosted URL — but the app is now installable:
open it in Chrome and choose **Install** (address-bar icon, or ⋮ → Cast, save
and share → Install page as app). That gives a shelf icon and its own window,
and the shell loads from a service worker ([public/sw.js](public/sw.js)) instead
of the network. Voices and passage-fetching still need the connection.

The service worker deliberately caches hashed `/assets` forever but always
revalidates `index.html` and itself, so a redeploy can't leave a student on a
stale shell pointing at deleted bundles.

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

**The server can't be removed from this path.** That endpoint accepts a request
only when the `User-Agent` says Edge — it ignores `Origin`, but a plain
Chrome/ChromeOS UA gets a flat `403`. A browser can't forge its own
`User-Agent`, so talking to Microsoft directly from the page would work in Edge
and fail on every Chromebook. Hence the proxy in `server/tts.js`.

Synthesis is cached in front of that endpoint by
[server/ttsCache.js](server/ttsCache.js): an in-memory LRU, a disk copy under
`%TEMP%` that survives restarts, and coalescing so N students asking for the
same new sentence at the same moment cost one upstream call, not N. Responses
carry `X-Cache: synth | memory | disk | coalesced`, which is the quickest way to
confirm it's working. The client also prefetches the next sentence while the
student types the current one (`src/useSpeech.js`), so pressing Enter starts
playback with no round trip.
