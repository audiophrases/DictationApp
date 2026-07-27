// Diagnoses a student-roster bridge without revealing anything sensitive.
//
// Run it when student logins fail and you need to know whether the bridge is
// the right one, the secret is wrong, or the credentials simply don't match:
//
//   node cloudflare/check-roster.mjs
//
// It prompts for the Apps Script /exec URL, the shared secret, and one
// student's username and password (all hidden except the URL), calls the
// bridge exactly the way the worker does, and prints only the SHAPE of the
// answer — which keys came back, never their values. Nothing is stored and
// nothing is echoed, so it is safe to run on a shared screen.
import readline from 'node:readline';

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      // Swallow the echo so the value never appears on screen or in a scrollback.
      const onData = (char) => {
        if (['\n', '\r', ''].includes(String(char))) process.stdin.removeListener('data', onData);
        else readline.clearLine(process.stdout, 0) || readline.cursorTo(process.stdout, 0) || process.stdout.write(`${question}`);
      };
      process.stdin.on('data', onData);
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const url = await ask('Apps Script /exec URL: ');
const secret = await ask('Shared secret (hidden): ', { hidden: true });
const username = await ask('A real student username: ');
const password = await ask('That student password (hidden): ', { hidden: true });

console.log('\nCalling the bridge the way the worker does…\n');

let res;
let text;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({ usernames: [username], secret, password }),
  });
  text = await res.text();
} catch (error) {
  console.log(`Could not reach it at all: ${error.message}`);
  process.exit(1);
}

console.log(`HTTP status      : ${res.status}`);

if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
  console.log('Response type    : NOT JSON (looks like an HTML error page)');
  const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`What it said     : ${stripped.slice(0, 200)}`);
  console.log('\nVERDICT: this deployment has no doPost, so it is not the roster API.');
  console.log('Look for another Apps Script project, or add a doPost to this one.');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(text);
} catch {
  console.log('Response type    : unparseable JSON');
  process.exit(1);
}

console.log(`Response type    : JSON`);
console.log(`Top-level keys   : ${Object.keys(data).join(', ') || '(none)'}`);
console.log(`ok               : ${JSON.stringify(data.ok)}`);
if (data.error) console.log(`error            : ${JSON.stringify(data.error)}`);

const results = Array.isArray(data.results) ? data.results : null;
console.log(`results array    : ${results ? `yes, ${results.length} entr${results.length === 1 ? 'y' : 'ies'}` : 'NO'}`);

if (results && results[0]) {
  const first = results[0];
  console.log(`result[0] keys   : ${Object.keys(first).join(', ')}`);
  console.log(`  has an email   : ${first.email ? 'yes' : 'NO'}`);
  console.log(`  passwordOk     : ${JSON.stringify(first.passwordOk)}`);
}

console.log('\nVERDICT');
if (!data.ok) {
  console.log('  The bridge refused the call. Usually the shared secret is wrong');
  console.log('  (or this project expects a different field name for it).');
} else if (!results) {
  console.log('  Wrong bridge. It answered ok, but with no `results` array — this is');
  console.log('  the older single-user login script. The worker needs the newer one');
  console.log('  that takes `usernames` and returns `results: [{ email, passwordOk }]`.');
} else if (!results[0]?.email) {
  console.log('  Right shape but no email came back, so the username was not found in');
  console.log('  the sheet. Check the spelling against the roster.');
} else if (results[0]?.passwordOk !== true) {
  console.log('  The student exists and the bridge works — the PASSWORD was rejected.');
  console.log('  Try another student, or check that password in the sheet.');
} else {
  console.log('  All correct. This URL and secret are the right ones, and this');
  console.log('  student can log in. If the app still refuses them, the values stored');
  console.log('  in the worker differ from what you just typed — re-run the two');
  console.log('  `wrangler secret put` commands.');
}
