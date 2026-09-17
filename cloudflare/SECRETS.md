# Assignments Worker — setup and secrets

The worker in this directory is the assignments API: student login, assignment
records, sentence audio, and grading. It is deployed to Cloudflare (the same
account as pinplay) and backed by an R2 bucket.

## One-time setup

```bash
cd cloudflare

# 1. The bucket the worker stores everything in.
npx wrangler r2 bucket create school-assignments

# 2. Teacher secret (prompted securely; see the table below).
npx wrangler secret put CREATE_PASSWORD_HASH --name dictation-api

# 3. Deploy.
npx wrangler deploy
```

`wrangler deploy` prints the worker's URL. Put that URL in
`DEFAULT_WORKER_BASE` in [../src/lib/api.js](../src/lib/api.js), or set it as
the `VITE_WORKER_BASE` repository variable (Settings → Secrets and variables →
Actions → Variables) so the GitHub Pages build picks it up. Without it, the app
runs fine but the assignment features stay switched off.

## Secrets

| Secret | Purpose |
|---|---|
| `CREATE_PASSWORD_HASH` | Teacher password, as a lowercase-hex SHA-256 of the NFC-normalised password. **Use the same value as pinplay's** and there is only one password to remember. |
| `STUDENT_ROSTER_LOOKUP_URL` | Legacy Speech to IPA only: its existing Google Apps Script roster endpoint. |
| `STUDENT_ROSTER_LOOKUP_SECRET` | Legacy Speech to IPA only: its roster shared secret. |
| `STUDENT_LOGIN_OVERRIDE_USER` | Optional legacy IPA test account; never accepted for Dictation assignments. |
| `STUDENT_LOGIN_OVERRIDE_PASS` | Optional legacy IPA test account password. |

Dictation students use Google sign-in through PinPlay. **Do not copy
`GOOGLE_CLIENT_ID` or `STUDENT_SESSION_KEY` here.** They remain in `pinplay-api`,
along with the shared roster and its allowed-domain / roster-only policy.
Keep existing legacy roster secrets while the separate Speech to IPA frontend
still uses username/password sign-in.

## Activating Google sign-in

1. Deploy the companion PinPlay Worker change first. It adds
   `GET /api/student/me`, which verifies a PinPlay session and returns its
   current roster name, email and class. Its existing `/api/student/config`
   and `/api/student/login` endpoints provide configuration and Google login.
2. In the **existing Google OAuth Web client used by PinPlay**, add each
   Dictation frontend origin under **Authorized JavaScript origins**, if it
   is not there already. For GitHub Pages this is
   `https://audiophrases.github.io` (no `/DictationApp/` path). Also add any
   custom domain or Render frontend origin you actually use. Local testing
   uses `http://localhost` and `http://localhost:5173` (or your chosen port).
   This is a Google Console setting, not a Worker secret.
3. Deploy `dictation-api` with the checked-in `wrangler.toml`. Its
   `PINPLAY_AUTH` service binding targets `pinplay-api` in the same Cloudflare
   account. If using another teacher's deployment, change that service name.
4. Publish the updated frontend. Check a school account can sign in, resume
   an existing assignment, and switch accounts with **Not you?**.

The Worker proxies only the fixed student config/login routes; it sends a
session to PinPlay's `/api/student/me` when an assignment starts. Teacher
credentials and assignment content are never forwarded. Auth responses use
`Cache-Control: no-store`. The browser stores sessions separately for each
assignment server; it does not store Google ID tokens or student passwords.

Roster and sign-in policy changes are managed in **PinPlay → Students**.
Sessions have PinPlay's existing lifetime and revocation behavior; changing
its signing key invalidates sessions in both apps. No existing attempts need
rekeying because their primary key is still the verified email.

References: [Cloudflare HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)
and [Google client/origin setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

To generate a password hash:

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1].trim().normalize('NFC')).digest('hex'))" "your password"
```

Check what is set (the `--name` flag is required, or the list comes back empty):

```bash
npx wrangler secret list --name dictation-api
```

## Running locally

```bash
cd cloudflare
npx wrangler dev            # serves on http://127.0.0.1:8787 with a local R2
```

Run PinPlay's `wrangler dev --port 8788` in its own `cloudflare/` directory
as well; Wrangler connects the local `PINPLAY_AUTH` binding to that named
Worker. PinPlay needs its Google/signing configuration and a local test roster.
Use local storage for both Workers so tests cannot modify the production roster.

Put the Dictation teacher hash in `cloudflare/.dev.vars` (gitignored, same
`KEY=value` format as a .env file). Then point a dev build of the app at it:

```bash
# in the repo root, in another terminal
VITE_WORKER_BASE=http://127.0.0.1:8787 npm run dev
```

Or, without rebuilding, from the browser console on any build:

```js
localStorage.setItem('dictation.workerBase', 'http://127.0.0.1:8787')
```

## What is stored, and where

```
records/<code>.json                                   assignment (teacher writes)
assign/<code>/audio/<i>.mp3                           one clip per sentence
assign/<code>/attempts/<studentKey>/<attemptId>.json  one student's attempt
```

`studentKey` is `usr_<email>`, derived from PinPlay's verified identity, so a
student who changes their display name keeps their history.

Two properties of this layout are load-bearing, both about the Workers free
plan's limit of 50 subrequests per request:

- Attempts are filed under the student's key, so counting a student's attempts
  is one `list()` of keys instead of reading every attempt in the class.
- Everything a list view displays is duplicated into R2 custom metadata, so one
  `list({include:['customMetadata']})` renders a whole dashboard. Nothing keeps
  a running total in a shared object. Attempt updates use conditional writes
  and bounded retries so simultaneous answers, listens and submissions cannot
  overwrite one another.

Deleting an assignment deletes its audio and every attempt with it, and there
is no undo — the worker is the only copy.
