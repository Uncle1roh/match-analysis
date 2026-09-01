/* Split "Training Tasks.pdf" into one PDF per session page.

   The session index is 1:1 with the PDF: session on page N lives on page N.
   Supabase's free plan refuses any single file over 50 MB, and nobody wants
   to pull 243 MB to read one drill — so each page becomes its own file.

   Usage:  node tools/split-pdf.mjs [firstPage] [lastPage]
   Output: pages/0001.pdf … pages/0617.pdf
*/
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

const SRC = 'Training Tasks.pdf';
const OUT = 'pages';
const from = parseInt(process.argv[2] || '1', 10);
const to = parseInt(process.argv[3] || '0', 10);

const t0 = Date.now();
process.stdout.write(`reading ${SRC} … `);
const src = await PDFDocument.load(fs.readFileSync(SRC), { updateMetadata: false });
const total = src.getPageCount();
const last = to || total;
console.log(`${total} pages, ${(fs.statSync(SRC).size / 1048576).toFixed(1)} MB`);

fs.mkdirSync(OUT, { recursive: true });
let bytes = 0, biggest = 0, biggestPage = 0;
for (let n = from; n <= last; n++) {
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [n - 1]);
  out.addPage(page);
  const buf = await out.save({ useObjectStreams: true });
  const name = path.join(OUT, String(n).padStart(4, '0') + '.pdf');
  fs.writeFileSync(name, buf);
  bytes += buf.length;
  if (buf.length > biggest) { biggest = buf.length; biggestPage = n; }
  if (n % 25 === 0 || n === last) {
    const done = n - from + 1, all = last - from + 1;
    const rate = done / ((Date.now() - t0) / 1000);
    process.stdout.write(`\r  ${done}/${all} pages · ${(bytes / 1048576).toFixed(1)} MB out · ${rate.toFixed(1)}/s · eta ${Math.round((all - done) / rate)}s   `);
  }
}
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`total ${(bytes / 1048576).toFixed(1)} MB · avg ${(bytes / (last - from + 1) / 1024).toFixed(0)} KB · biggest p.${biggestPage} at ${(biggest / 1048576).toFixed(1)} MB`);
if (biggest > 50 * 1048576) console.log('WARNING: a page is over the 50 MB free-plan file cap');
