#!/usr/bin/env node
// Pre-push checks for the shop app. Run from the repo root:  node scripts/check.mjs
// (also `npm run check` in worker/). Exits with an error if anything must be fixed.
//
//  1. Code:     every JavaScript file parses.
//  2. Design:   colours live only in app/tokens.css; styles.css and app.js use tokens
//               (var(--…)) that exist; no fixed inline styles in the screens.
//  3. Privacy:  no API keys, secrets, PIN hashes, private keys, script links or personal
//               details (emails, phone numbers) in tracked files, and no secret files tracked.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);
const errors = [], warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const read = f => fs.readFileSync(f, 'utf8');
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

// ---- 1. Code parses ----
for (const f of tracked.filter(f => /\.(m?js)$/.test(f) && !f.startsWith('apps-script/'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { err(f, 'does not parse: ' + String(e.stderr || e.message).split('\n').find(l => /Error/.test(l))); }
}

// ---- 2. Design tokens ----
const COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi;
if (fs.existsSync('app/tokens.css') && fs.existsSync('app/styles.css')) {
  const tokens = read('app/tokens.css'), styles = read('app/styles.css'), app = read('app/app.js');
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  for (const m of styles.matchAll(COLOUR)) err('app/styles.css', `line ${lineOf(styles, m.index)}: raw colour "${m[0]}" — add a token to tokens.css and use var(--…)`);
  for (const [f, text] of [['app/styles.css', styles], ['app/app.js', app], ['app/tokens.css', tokens]])
    for (const m of text.matchAll(/var\((--[\w-]+)/g))
      if (!defined.has(m[1]) && m[1] !== '--swatch-') err(f, `line ${lineOf(text, m.index)}: ${m[1]} is not defined in tokens.css`);
  for (const m of app.matchAll(/#[0-9a-f]{6}\b/gi)) err('app/app.js', `line ${lineOf(app, m.index)}: raw colour "${m[0]}" — use a token`);
  for (const m of app.matchAll(/ style="([^"]*)"/g))
    if (!m[1].includes('${')) err('app/app.js', `line ${lineOf(app, m.index)}: fixed inline style "${m[1]}" — move it to a class in styles.css`);
} else err('app', 'tokens.css and styles.css are missing');

// ---- 3. Secrets and personal info ----
const NEVER_TRACK = [/(^|\/)\.dev\.vars$/, /(^|\/)\.env(\.|$)/, /\.(pem|key|p12)$/, /(^|\/)\.wrangler\//, /(^|\/)\.data\//, /(^|\/)node_modules\//];
for (const f of tracked) if (NEVER_TRACK.some(r => r.test(f))) err(f, 'must not be in git (secrets, local data or build files) — remove it and add it to .gitignore');
// Allowed: GitHub no-reply, the shop's own business domain, and obvious placeholders.
const OK_EMAILS = [/@users\.noreply\.github\.com$/i, /@milkyanyong\.shop$/i, /@example\.test$/i, /^name@gmail\.com$/i, /^onboarding@resend\.dev$/i, /@example\.(com|org)$/i];
const SECRET_PATTERNS = [
  [/\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/gi, 'looks like a hard-coded secret'],
  [/\bre_[A-Za-z0-9]{16,}\b/g, 'looks like a Resend API key'],
  [/\b(sk|pk)_(live|test)_[A-Za-z0-9]{12,}/g, 'looks like an API key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
  [/_PIN_HASH\s*=\s*[0-9a-f]{8,}/gi, 'a PIN hash'],
  [/script\.google\.com\/macros\/s\/[\w-]{20,}/g, 'an Apps Script web-app link (anyone with it can change data)'],
  [/docs\.google\.com\/spreadsheets\/d\/[\w-]{20,}/g, 'a Google Sheet link'],
  [/(?<![\w.])(\+66|0)[689]\d[- ]?\d{3}[- ]?\d{4}\b/g, 'looks like a phone number'],
];
for (const f of tracked) {
  if (/\.(zip|png|jpe?g|gif|webp|ico|pdf|woff2?)$/i.test(f)) { if (/\.zip$/i.test(f)) warn(f, 'archive in git — its contents can’t be checked; remove it if it isn’t needed'); continue; }
  if (f === 'scripts/check.mjs' || /package-lock\.json$/.test(f)) continue;
  let text; try { text = read(f); } catch (e) { continue; }
  for (const [re, what] of SECRET_PATTERNS) for (const m of text.matchAll(re)) err(f, `line ${lineOf(text, m.index)}: ${what}`);
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g))
    if (!OK_EMAILS.some(r => r.test(m[0]))) err(f, `line ${lineOf(text, m.index)}: email address "${m[0]}" — personal details belong in a Cloudflare secret, not the repo`);
}

// ---- Report ----
for (const w of warnings) console.log('warning  ' + w);
for (const e of errors) console.log('ERROR    ' + e);
console.log(errors.length ? `\n${errors.length} problem(s) to fix before pushing.` : `\nAll checks passed (${tracked.length} files).${warnings.length ? ' ' + warnings.length + ' warning(s).' : ''}`);
process.exit(errors.length ? 1 : 0);
