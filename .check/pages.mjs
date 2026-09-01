/* Does page N actually hold session N?

   Everything so far proved the plumbing: the right file arrives, byte for byte.
   None of it proved the *index* is aligned with the book — that the session the
   finder names on page 311 is the one a coach turns to. If that mapping were
   off by even one, every result would open a plausible-looking wrong drill, and
   nothing else in the test suite would notice.

   So: pull the text out of a sample of page PDFs and look for the title the
   index claims is there.

   Usage: node .check/pages.mjs [howMany]
*/
import fs from 'fs';
import { reporter } from './report.mjs';
import { getDocument } from '../tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs';

const r = reporter();
const S = JSON.parse(fs.readFileSync('sessions.js', 'utf8').match(/^const S = (\[.*\]);?$/m)[1]);

const norm = s => String(s || '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function textOf(page) {
  const file = `pages/${String(page).padStart(4, '0')}.pdf`;
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
  const p = await doc.getPage(1);
  const c = await p.getTextContent();
  const t = c.items.map(i => i.str).join(' ');
  await doc.cleanup();
  return norm(t);
}

/* how much of the claimed title shows up in the page's own text */
function overlap(title, text) {
  const words = norm(title).split(' ').filter(w => w.length > 3);
  if (!words.length) return 1;
  const hit = words.filter(w => text.includes(w)).length;
  return hit / words.length;
}

const howMany = parseInt(process.argv[2] || '40', 10);
/* a spread across the book, plus the two ends, plus a few at random */
const picks = new Set([1, 2, 42, 100, 200, 311, 400, 500, 616, 617]);
while (picks.size < howMany) picks.add(1 + Math.floor(Math.random() * 617));
const pages = [...picks].sort((a, b) => a - b);

console.log(`checking ${pages.length} of 617 pages against the index\n`);

/* 20 index entries have no real title — "Coordinative Game (p.614)" and the
   like. Those pages turned out to be continuation sheets: the second page of a
   multi-page session that the index builder read as a session of its own. They
   are a known flaw in the index, not a broken mapping, so they are counted
   rather than failed — but the count must not grow. */
const PLACEHOLDER = /\(p\.\d+\)\s*$/;
const placeholders = S.filter(s => PLACEHOLDER.test(s.title));

let weak = [], blank = 0, skipped = 0;
for (const page of pages) {
  const s = S.find(x => x.page === page);
  if (PLACEHOLDER.test(s.title)) { skipped++; continue; }
  const text = await textOf(page);
  if (text.length < 40) { blank++; continue; }          // an image-only page proves nothing
  const score = overlap(s.title, text);
  if (score < 0.5) weak.push({ page, score, title: s.title.slice(0, 58), got: text.slice(0, 90) });
}

const judged = pages.length - blank - skipped;
r.okay(`${judged} pages carried extractable text`, judged > pages.length * 0.5,
  `${blank} image-only, ${skipped} untitled`);
r.is('every judged page holds the session the index puts there',
  weak.map(w => `p.${w.page} (${Math.round(w.score * 100)}%)`), []);
r.is('the untitled entries have not multiplied', placeholders.length, 20);

if (weak.length) {
  console.log('\nmismatches:');
  weak.forEach(w => {
    console.log(`  p.${w.page}  index says: ${w.title}`);
    console.log(`         page says: ${w.got}\n`);
  });
}

/* an off-by-one would be the classic failure, so name it explicitly */
if (weak.length > pages.length * 0.5) {
  const sample = weak[0];
  const before = await textOf(Math.max(1, sample.page - 1));
  const after = await textOf(Math.min(617, sample.page + 1));
  console.log('checking for an off-by-one:');
  console.log('  matches page-1 :', overlap(sample.title, before).toFixed(2));
  console.log('  matches page+1 :', overlap(sample.title, after).toFixed(2));
}

r.done();
