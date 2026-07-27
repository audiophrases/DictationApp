# Assignments Worker — setup and secrets

The worker in this directory is the assignments API: student login, assignment
records, sentence audio, and grading. It is deployed to Cloudflare (the same
account as pinplay) and backed by an R2 bucket.

## One-time setup

```bash
cd cloudflare

# 1. The bucket the worker stores everything in.
npx wrangler r2 bucket create school-assignments

# 2. Secrets (see the table below). Each is prompted for, or piped in:
echo "value" | npx wrangler secret put NAME --name dictation-api

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
| `STUDENT_ROSTER_LOOKUP_URL` | The Google Apps Script roster endpoint. Same value as pinplay. |
| `STUDENT_ROSTER_LOOKUP_SECRET` | Shared secret for that endpoint. Same value as pinplay. |
| `STUDENT_LOGIN_OVERRIDE_USER` | Optional. A test student username that bypasses the roster. |
| `STUDENT_LOGIN_OVERRIDE_PASS` | Optional. That test student's password. |

Copy the roster values from pinplay's saved secrets (`~/.pinplay-secrets.json`);
they are the same bridge, so the two apps stay in step automatically when the
roster sheet changes.

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

Put local values in `cloudflare/.dev.vars` (gitignored, same `KEY=value`
format as a .env file). Then point a dev build of the app at it:

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

`studentKey` is `usr_<email>`, derived from the roster, so a student who
changes their username keeps their history.

Two properties of this layout are load-bearing, both about the Workers free
plan's limit of 50 subrequests per request:

- Attempts are filed under the student's key, so counting a student's attempts
  is one `list()` of keys instead of reading every attempt in the class.
- Everything a list view displays is duplicated into R2 custom metadata, so one
  `list({include:['customMetadata']})` renders a whole dashboard. Nothing keeps
  a running total in a shared object, which is why there are no write races:
  every object here has exactly one writer.

Deleting an assignment deletes its audio and every attempt with it, and there
is no undo — the worker is the only copy.
