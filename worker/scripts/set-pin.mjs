// Sets a shop's owner or staff PIN. The PIN is typed (hidden), scrambled with a
// random salt, and only the scrambled value is stored. It's never printed or saved
// in the repo.
//
//   npm run set-pin -- --shop baan --role owner            # live (Cloudflare secret)
//   npm run set-pin -- --shop chud --role staff --local    # this computer (.dev.vars)
//
// After changing a live PIN, use Settings → "Sign out all phones" so everyone
// signs in with the new one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const shop = opt('shop'), role = opt('role'), local = args.includes('--local');
if (!['baan', 'chud'].includes(shop) || !['owner', 'staff'].includes(role)) {
  console.error('Usage: npm run set-pin -- --shop baan|chud --role owner|staff [--local]');
  process.exit(1);
}
const NAME = `${shop.toUpperCase()}_${role.toUpperCase()}_PIN_HASH`;
const OTHER = `${shop.toUpperCase()}_${role === 'owner' ? 'STAFF' : 'OWNER'}_PIN_HASH`;

export function scramble(pin, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.createHash('sha256').update(salt + pin).digest('hex');
}
const matches = (stored, pin) => { const i = (stored || '').indexOf(':'); return i > 0 && scramble(pin, stored.slice(0, i)) === stored; };

function ask(prompt) {
  return new Promise(resolve => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let v = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume(); stdin.setEncoding('utf8');
    const on = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { if (stdin.isTTY) stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); return resolve(v); }
        if (c === '\u0003') process.exit(1);
        if (c === '\u007f') v = v.slice(0, -1); else v += c;
      }
    };
    stdin.on('data', on);
  });
}

const pin = (await ask(`New ${role} PIN for ${shop} (6 digits): `)).trim();
if (!/^\d{6}$/.test(pin)) { console.error('The PIN must be exactly 6 digits. Nothing was changed.'); process.exit(1); }
if ((await ask('Type it again: ')).trim() !== pin) { console.error('The two PINs didn’t match. Nothing was changed.'); process.exit(1); }
const value = scramble(pin);

if (local) {
  const file = path.join(root, '.dev.vars');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  const other = (lines.find(l => l.startsWith(OTHER + '=')) || '').split('=')[1];
  if (matches(other, pin)) { console.error('The owner and staff PINs must be different. Nothing was changed.'); process.exit(1); }
  fs.writeFileSync(file, lines.filter(l => !l.startsWith(NAME + '=')).concat(`${NAME}=${value}`).join('\n') + '\n');
  console.log(`Saved for this computer (.dev.vars). Restart \`npm run dev\` to use it.`);
} else {
  // Cloudflare can't read secrets back, so the owner/staff difference is checked by the app's sign-in only.
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', NAME], { cwd: root, input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) { console.error('Couldn’t save the PIN. Are you signed in? Try: npx wrangler login'); process.exit(1); }
  console.log('Saved on Cloudflare. Now use Settings → "Sign out all phones" in the app so everyone uses the new PIN.');
}
