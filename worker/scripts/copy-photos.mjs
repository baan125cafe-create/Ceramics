// Copies product photos from Google Drive into Cloudflare R2 and points each
// product at its copy, so nothing depends on Google any more.
//
//   npm run copy-photos -- --shop baan --remote
//   npm run copy-photos -- --shop chud --local
//
// Run it on a computer that can open Google photo links (your own Terminal).
// Safe to run again: photos already downloaded are reused, and only products whose
// photo is still a Google link are changed. A photo that can't be downloaded (for
// example, no longer shared) is skipped and listed; that product keeps its Google link.
//
// Downloaded photos are kept in worker/.data/photos/ (ignored by git) as a backup.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const shop = opt('shop');
const target = args.includes('--remote') ? '--remote' : '--local';
// For tests only: download from a different address instead of Google.
const SOURCE = opt('source') || 'https://lh3.googleusercontent.com/d/';
const PARALLEL = 4;
if (!['baan', 'chud'].includes(shop)) { console.error('Usage: npm run copy-photos -- --shop baan|chud [--local|--remote]'); process.exit(1); }

// For tests only: a separate local database folder.
const persist = opt('persist-to') ? ['--persist-to', opt('persist-to')] : [];
const wr = async (...a) => (await run('npx', ['wrangler', ...a, ...persist], { cwd: root, maxBuffer: 64 << 20 })).stdout;
// wrangler can print notices before its JSON; read from the first line that starts with "[".
const fromJson = out => JSON.parse(out.slice(Math.max(0, out.search(/^\[/m))));
const query = async q => fromJson(await wr('d1', 'execute', 'shop-db', target, '--json', '--command', q))[0].results;

// Google photo links look like https://lh3.googleusercontent.com/d/<fileId> or drive.google.com/...id=<fileId>
const driveId = url => (/googleusercontent\.com\/d\/([\w-]+)/.exec(url) || /drive\.google\.com\/.*(?:id=|\/d\/)([\w-]+)/.exec(url) || [])[1];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' };

const rows = (await query(`SELECT id, name, imageUrl FROM products WHERE shop = '${shop}' AND (imageUrl LIKE '%googleusercontent.com%' OR imageUrl LIKE '%drive.google.com%')`))
  .map(r => Object.assign(r, { fileId: driveId(r.imageUrl) })).filter(r => r.fileId);
console.log(`${rows.length} ${shop} products still use a Google photo link.`);
const dir = path.join(root, '.data', opt('persist-to') ? 'test-photos' : 'photos', shop);
fs.mkdirSync(dir, { recursive: true });

const done = [], failed = [];
async function one(r) {
  try {
    let file = fs.readdirSync(dir).find(f => f.startsWith(r.fileId + '.'));
    let type;
    if (!file) {
      const res = await fetch(SOURCE + r.fileId, { redirect: 'follow' });
      type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !EXT[type]) throw new Error(res.ok ? 'not a photo (' + (type || 'unknown type') + ')' : 'HTTP ' + res.status);
      file = r.fileId + '.' + EXT[type];
      fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
    }
    type = type || Object.keys(EXT).find(k => file.endsWith('.' + EXT[k]));
    const key = `${shop}/drive-${file}`;
    await wr('r2', 'object', 'put', `shop-photos/${key}`, '--file', path.join(dir, file), '--content-type', type, target);
    done.push({ r, key });
  } catch (e) {
    failed.push({ r, why: String(e.message || e).split('\n')[0] });
  }
  process.stdout.write(`\r  ${done.length + failed.length}/${rows.length} (${failed.length} skipped)`);
}
for (let i = 0; i < rows.length; i += PARALLEL) await Promise.all(rows.slice(i, i + PARALLEL).map(one));
process.stdout.write('\n');

if (done.length) {
  // Only change rows whose photo is still that same Google link.
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const sqlFile = path.join(root, '.data', `photos-${shop}.sql`);
  fs.writeFileSync(sqlFile, done.map(({ r, key }) => `UPDATE products SET imageUrl = ${q('/img/' + key)} WHERE shop = ${q(shop)} AND id = ${q(r.id)} AND imageUrl = ${q(r.imageUrl)};`).join('\n') + '\n');
  await wr('d1', 'execute', 'shop-db', target, '--yes', '--file', sqlFile);
  fs.unlinkSync(sqlFile);
}
console.log(`Copied ${done.length} photos to R2 and updated those products.`);
if (failed.length) {
  console.log(`Skipped ${failed.length} (they keep their Google link; run again later or re-add the photo in the app):`);
  failed.forEach(({ r, why }) => console.log(`  - ${r.name} (${r.id}): ${why}`));
}
const left = (await query(`SELECT COUNT(*) AS n FROM products WHERE shop = '${shop}' AND (imageUrl LIKE '%googleusercontent.com%' OR imageUrl LIKE '%drive.google.com%')`))[0].n;
console.log(left ? `${left} products still use Google photos.` : 'All photos for this shop are now in Cloudflare.');
