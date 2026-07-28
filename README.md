# Dictation Time

A dictation practice app: type what you hear, read aloud with natural neural
voices across several languages/dialects, or auto-fetch a real practice
passage from a plain-language encyclopedia. Teachers can also set a passage as
an assignment: students sign in with their PinPlay logins, and the text stays
hidden until they have handed their work in.

## Where the app runs

Three pieces, in three places, for one reason each:

| Piece | Where | Why there |
| --- | --- | --- |
| The app itself | **GitHub Pages** | A static host has no cold start, so opening a link is instant. |
| `/api/tts`, `/api/dictation` | **Render** (`server/`) | The Edge voices need a Node proxy — see [Voices](#voices). It may sleep; only the teacher ever waits for it. |
| Assignments, logins, results | **Cloudflare Worker + R2** (`cloudflare/`) | Always on, so a class signing in at 8:55am waits for nothing. |

Which back end a running copy calls is decided in
[src/lib/api.js](src/lib/api.js). Only the GitHub Pages build talks to Render by
absolute URL; the Render deploy, `npm run dev` and the portable pack all serve
their own APIs and call them same-origin, which is what keeps free practice
working offline in the pack.

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

- **The launcher sets `HOST=127.0.0.1`**, so the server binds loopback only.
  Listening on all interfaces makes Windows Defender ask permission, and that
  dialog needs an administrator. `start_local.bat` sets it too.
  `server/serve.js` itself defaults to every interface, because that is the only
  default that can't break a deploy — a host's health check reaches the container
  over its routable address and can't see a loopback-bound server. The local
  launchers opt in to loopback rather than the hosted path opting out: a launcher
  that forgets it merely prompts for a firewall rule, which is visible and
  recoverable, whereas a host missing the setting fails its health check with
  nothing obviously wrong.
- Voice audio is cached under `%TEMP%`, inside the student's own profile.
  Set `TTS_CACHE_DIR` to keep it elsewhere (e.g. on the USB stick).

Still expect two things: Windows shows an unrecognised-app warning on first run
(**More info → Run anyway**), and school-managed PCs sometimes block
executables outside `Program Files` by policy — so **try the pack on one
student machine before handing it to a class.** If policy blocks it, the hosted
URL below is unaffected.

**Rebuild the pack after changing the app** — it ships a copy of the built UI
and the bundled server, and cannot update itself. Assignments work from the
pack too (it calls the same worker), but they need a connection; free practice
does not.

## Installing it on a Chromebook

Chromebooks can't run the pack (Windows binary, and Linux/Crostini is
admin-locked), so they use the GitHub Pages URL — but the app is now installable:
open it in Chrome and choose **Install** (address-bar icon, or ⋮ → Cast, save
and share → Install page as app). That gives a shelf icon and its own window,
and the shell loads from a service worker ([public/sw.js](public/sw.js)) instead
of the network. Voices and passage-fetching still need the connection.

The service worker deliberately caches hashed `/assets` forever but always
revalidates `index.html` and itself, so a redeploy can't leave a student on a
stale shell pointing at deleted bundles.

## Splitting a passage into sentences

A period is only sometimes the end of a sentence, and getting it wrong is worse
here than in most places: "John M. Smith was born" split after the initial hands
a student "John M." as a whole dictation item. Sampled against live fetched
passages, roughly **one passage in three** had at least one such break — the
worst being French earthquake magnitudes splitting mid-number, into "…à 9." and
"0 sur l'échelle de Richter."

[src/lib/sentences.js](src/lib/sentences.js) therefore judges each candidate
rather than trusting it, and is deliberately biased towards *not* splitting: an
over-long item is a bad dictation, a fragment like "Dr." is a broken one. It
keeps initials, decimals, acronyms, list markers and a multilingual set of
titles together, and treats a following lowercase word as a sentence carrying
on. The residual risk is the reverse — two real sentences joined when the second
starts lowercase — measured at under 1% of sentences and almost always a
fragment the old splitter had itself invented.

`npm test` covers both directions: what must stay whole and what must still
split.

## Lesson dictations

Free practice can also take a lesson from **Speech to IPA**: pick one and its
sentences become the dictation, one lesson to one dictation. Available in the
five languages that app teaches — English, Catalan, French, Italian and
Moroccan Darija — currently 38 lessons of 6 sentences each.

The lessons are not stored here. Both apps read the same published Google
Sheet, so editing a sentence there changes it in both with nothing to rebuild;
[speechtoipa/SCRIPTER_INSTRUCTIONS.md](https://github.com/audiophrases/speechtoipa)
documents the row schema, and [src/lib/lessons.js](src/lib/lessons.js) maps this
app's language codes onto its tabs. Each tab is ~200 KB, so it is fetched only
when someone actually opens the picker, never on page load.

A lesson is joined one sentence per line, which is exactly how
`splitIntoSentences` divides it again — so it behaves like any other passage
from there on, including hiding the text until the dictation is done and being
set as an assignment.

## Assignments

The teacher's side is its own page at **`/create/`** — the same shape pinplay
uses. Sign in there with the teacher password to build assignments and read
results: who has handed in, their scores, how often each sentence was played,
and the word-by-word marking of any attempt. (`?teacher`, where this used to
live, redirects there.)

Creating one: **New assignment**, or **Set as an assignment…** on the practice
screen, which carries the passage across. Fill in the form (title, class, due
date, replays allowed, attempts, marking rules) and it does one slow thing once
— reads every sentence aloud and stores it. Then you get a six-character code
and a link to share.

Students open that link and sign in with **the same username and password they
use for PinPlay**, then type what they hear.

Two pages rather than one app with a route, because a static host has no
rewrites and because they share almost nothing: a Chromebook opening the
student app downloads none of the dashboard, the builder, or anything else
behind the password.

A student who can't get in has the same two doors as in PinPlay, linked under
the sign-in box: **Sign up** (the Google Form that feeds your roster sheet) and
**Forgot username/password** (the Apps Script page that identifies them by the
school Google account they're already signed into and shows them their own
row). Both live in [src/lib/studentAccounts.js](src/lib/studentAccounts.js) —
set either to `''` to hide that link. Nothing about them touches this app, which
is why there is no password-reset machinery here: the school's Google sign-in is
the proof of identity.

**The passage text never reaches a student's browser until they submit.** The
worker sends audio by sentence number and withholds the sentences themselves,
so there is nothing to read in the page source, in storage, or in the network
tab. Replay limits are counted server-side for the same reason: each play is a
request, so there is no client-side counter to edit. Marking also happens on the
worker, under the rules set at creation, so the grading toggles a student can
use in free practice can't re-mark their own homework.

Setting this up once: [cloudflare/SECRETS.md](cloudflare/SECRETS.md). It reuses
PinPlay's student roster and teacher password, so there is one roster and one
password across both apps. Until a worker is configured, the assignment
features simply stay switched off and free practice is unaffected.

`npm run test:worker` exercises the whole flow — including the checks that the
text cannot leak early.

## Deploying

Three targets, and a push to `main` handles the first two:

1. **GitHub Pages** — where students open the app.
   [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)
   builds and publishes on every push. One-time: repo **Settings → Pages →
   Source = GitHub Actions**.
2. **Render** — the voices and passage fetching. In the
   [Render dashboard](https://dashboard.render.com): **New + → Blueprint** →
   pick the repo; [render.yaml](render.yaml) pre-fills everything. No card
   needed on the free tier. Setting `ROOT_REDIRECT_URL` there sends anyone
   opening the Render address itself on to the Pages one, while `/health` and
   `/api/*` keep answering normally.
3. **Cloudflare** — assignments. `cd cloudflare && npx wrangler deploy`, then
   put the worker's URL in `VITE_WORKER_BASE` (or in `src/lib/api.js`).

Render's free tier sleeps after ~15 minutes idle. That now only affects free
practice and recording an assignment: the app pings `/health` on load and shows
a "waking up" overlay during the ~30-60s cold start, and keeps pinging while a
visible tab stays open. A student doing an assignment never touches Render at
all — their audio comes from R2 — so that path has no cold start.

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
