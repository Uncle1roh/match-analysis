/* Push pages/0001.pdf … 0617.pdf into the training-pages bucket.

   Straight at the Storage REST API rather than through the CLI: the object
   path then means exactly what it says (0042.pdf at the bucket root, which is
   what cloud.js asks for), and uploads can run several at a time.

   Resumable — it lists what is already up and sends only the rest, so a run
   that dies halfway costs nothing but the time already spent.

   Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from .env. That key bypasses
   every RLS policy, which is exactly why it lives in a gitignored file and
   never goes near the browser.

   Usage: node tools/upload-pages.mjs [--force]
*/
import fs from 'fs';
import path from 'path';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const URL_BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;
const BUCKET = 'training-pages';
const SRC = 'pages';
const FORCE = process.argv.includes('--force');
const PARALLEL = 6;

if (!URL_BASE || !KEY) { console.error('.env needs SUPABASE_URL and SUPABASE_SERVICE_KEY'); process.exit(1); }
if (!fs.existsSync(SRC)) { console.error(`No ${SRC}/ — run: node tools/split-pdf.mjs`); process.exit(1); }

const head = { apikey: KEY, Authorization: 'Bearer ' + KEY };

/* what is already in the bucket (paged: the API caps a listing at 1000) */
async function listed() {
  const have = new Map();
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...head, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!res.ok) throw new Error('list failed: ' + res.status + ' ' + await res.text());
    const rows = await res.json();
    rows.forEach(r => have.set(r.name, (r.metadata && r.metadata.size) || 0));
    if (rows.length < 1000) break;
  }
  return have;
}

async function put(name) {
  const body = fs.readFileSync(path.join(SRC, name));
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: { ...head, 'Content-Type': 'application/pdf', 'x-upsert': 'true', 'cache-control': 'max-age=3600' },
    body
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  return body.length;
}

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.pdf')).sort();
console.log(`${files.length} page files in ${SRC}/`);

const have = await listed();
console.log(`${have.size} already in the bucket`);

const todo = FORCE ? files : files.filter(f => {
  const there = have.get(f);
  return there === undefined || there !== fs.statSync(path.join(SRC, f)).size;
});
if (!todo.length) { console.log('nothing to do'); process.exit(0); }
console.log(`uploading ${todo.length}…`);

const t0 = Date.now();
let done = 0, bytes = 0;
const failed = [];
let next = 0;
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (next < todo.length) {
    const name = todo[next++];
    /* read-modify-write across an await loses updates between workers, so add
       only after the value is in hand */
    try { const n = await put(name); bytes += n; }
    catch (e) {
      try { const n = await put(name); bytes += n; }    // one retry: the odd 5xx is normal
      catch (e2) { failed.push(e2.message); }
    }
    if (++done % 20 === 0 || done === todo.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r  ${done}/${todo.length} · ${(bytes / 1048576).toFixed(0)} MB · ${rate.toFixed(1)}/s · eta ${Math.round((todo.length - done) / rate)}s   `);
    }
  }
}));

console.log(`\nuploaded in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (failed.length) {
  console.log(`${failed.length} failed — run again to pick them up:`);
  failed.slice(0, 5).forEach(m => console.log('  ' + m.slice(0, 140)));
  process.exit(1);
}
const after = await listed();
console.log(`${after.size} / ${files.length} pages in the bucket`);
process.exit(after.size >= files.length ? 0 : 1);
