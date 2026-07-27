// Builds the one-click Windows portable pack: a folder a student unzips and
// double-clicks. No installer, no Node.js install, no npm, no admin rights.
//
// Run it with `npm run pack:win` (which builds the app first).
//
// The student sees a launcher, two text files, and one app/ folder to ignore:
//   Start Dictation Time.bat  the one click
//   app/node.exe      the runtime, copied from THIS machine's Node. Bundling it
//                     is the whole point — installing Node.js needs an MSI, and
//                     that needs an administrator.
//   app/server.mjs    server/serve.js and its dependencies bundled into one
//                     file, so the pack carries no node_modules tree at all.
//   app/dist/         the already-built UI. Students never run a build; the
//                     current start_local.bat re-runs `vite build` on every
//                     launch, which is the slow part.
import { build } from 'esbuild';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'pack');
const PACK = path.join(OUT, 'DictationTime');
const ZIP = path.join(OUT, 'DictationTime-Windows.zip');
const PORT = 4173;

// cmd.exe is the one place where line endings still matter.
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');

const LAUNCHER = `@echo off
setlocal
cd /d "%~dp0"
title Dictation Time

rem Loopback only: a server listening on every network interface makes Windows
rem Defender ask permission, and that dialog needs an administrator.
set HOST=127.0.0.1
set PORT=${PORT}
set DIST_DIR=%~dp0app\\dist

rem A previous run may still hold the port - its window left open, or a crash.
rem This only ever kills a process owned by the same user, so no admin needed.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":${PORT}" ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>nul

echo.
echo   Dictation Time is starting...
echo.
echo   Your browser will open at http://127.0.0.1:${PORT}
echo   Keep this window open while you practise. Close it to stop.
echo.

start /b "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:${PORT}"

"%~dp0app\\node.exe" "%~dp0app\\server.mjs"

if errorlevel 1 (
  echo.
  echo   Dictation Time stopped. The message above explains why.
  echo.
  pause
)
`;

const READ_ME = `Dictation Time - portable version for Windows
=============================================

HOW TO START
------------
1. If you are looking at this inside a ZIP file, extract it first:
   right-click the ZIP, choose "Extract All...", then open the new folder.
2. Double-click "Start Dictation Time".
3. Your browser opens the app. Keep the black window open while you work,
   and close it when you are finished.

The first time you run it, Windows may say it does not recognise the app.
Choose "More info", then "Run anyway". Nothing is installed on your computer
and no administrator password is needed - everything lives in this folder,
and deleting the folder removes it completely.

WHAT NEEDS INTERNET
-------------------
The voices and the "fetch a passage" button both come from the internet, so
you need a connection to use them. Everything else - typing, marking, your
results - works on your own computer. Sentences you have already heard are
remembered, so repeating a lesson works even with a poor connection.

Assignments set by your teacher also need a connection, because signing in
and handing your work in both happen online. Practising on your own does not.

IF THE BROWSER DOES NOT OPEN
----------------------------
Open it yourself and go to:  http://127.0.0.1:${PORT}

IF IT SAYS THE PORT IS IN USE
-----------------------------
Another copy is probably already running. Close any other "Dictation Time"
windows and try again.

FOR TEACHERS
------------
Voice audio is cached in your temporary files folder so repeated lessons do
not need to be downloaded again. To keep that cache with the app instead - on
a USB stick, for example - set TTS_CACHE_DIR to a folder inside this one
before starting the server.
`;

const NOTICE = `This folder includes node.exe, an unmodified copy of the Node.js runtime.
Node.js is distributed under the MIT license and is copyright Node.js
contributors. See https://github.com/nodejs/node/blob/main/LICENSE for the
full license text.

The Dictation Time application code in app/ is separate from Node.js.
`;

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('No build found in dist/. Run "npm run build" first.');
    process.exit(1);
  }

  await fsp.rm(PACK, { recursive: true, force: true });
  await fsp.mkdir(path.join(PACK, 'app'), { recursive: true });

  // One self-contained ESM file. ESM (not CJS) because serve.js resolves its own
  // location through import.meta.url, which has no meaning in a CJS bundle.
  const result = await build({
    entryPoints: [path.join(ROOT, 'server', 'serve.js')],
    outfile: path.join(PACK, 'app', 'server.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // Some CJS dependencies deep under msedge-tts (axios -> form-data ->
    // combined-stream) call require() in ways esbuild cannot resolve statically.
    // In an ESM bundle its fallback shim just throws "Dynamic require of util is
    // not supported", so hand it a real require to delegate to.
    banner: {
      js: [
        "import { createRequire as __nodeCreateRequire } from 'node:module';",
        'const require = __nodeCreateRequire(import.meta.url);',
      ].join('\n'),
    },
    // Keeps stack traces from the bundle readable if a student reports an error.
    minify: false,
    logLevel: 'warning',
    metafile: true,
  });

  await fsp.cp(DIST, path.join(PACK, 'app', 'dist'), { recursive: true });
  await fsp.copyFile(process.execPath, path.join(PACK, 'app', 'node.exe'));

  await fsp.writeFile(path.join(PACK, 'Start Dictation Time.bat'), crlf(LAUNCHER));
  await fsp.writeFile(path.join(PACK, 'READ ME FIRST.txt'), crlf(READ_ME));
  await fsp.writeFile(path.join(PACK, 'NOTICE.txt'), crlf(NOTICE));

  // Compress-Archive ships with Windows PowerShell, so packing needs no extra
  // tool and no admin rights either.
  await fsp.rm(ZIP, { force: true });
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${PACK}' -DestinationPath '${ZIP}' -CompressionLevel Optimal`,
    ],
    { stdio: 'inherit' }
  );

  const bundleBytes = Object.values(result.metafile.outputs)[0].bytes;
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(`\nserver bundle   ${(bundleBytes / 1024).toFixed(0)} KB`);
  console.log(`node runtime    ${mb(fs.statSync(process.execPath).size)} (${process.version})`);
  console.log(`zip for students ${mb(fs.statSync(ZIP).size)}`);
  console.log(`\nfolder: ${PACK}`);
  console.log(`zip:    ${ZIP}`);
}

await main();
