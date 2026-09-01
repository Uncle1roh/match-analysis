/* What a real browser actually paints.

   jsdom is fine for logic but it is not a rendering engine: it reported
   `display: none` for a hidden modal that Edge and Chrome paint over the whole
   page, because an author `.modal{display:flex}` beats the UA sheet's
   `[hidden]{display:none}`. That shipped. This suite exists so it cannot again.

   Drives the real engine over a local server. Needs playwright-core and a
   Chromium-family browser already on the machine (Edge counts).

   Usage: node .check/browser.mjs [url]
*/
import fs from 'fs';
import path from 'path';
import http from 'http';
import { chromium } from 'playwright-core';
import { reporter } from './report.mjs';

const r = reporter(), is = r.is, okay = r.okay;

const CANDIDATES = [
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
];
const exe = CANDIDATES.find(p => p && fs.existsSync(p));
if (!exe) { console.log('no Chromium-family browser found — skipping'); process.exit(0); }

/* a static server, so the pages load over http as they really do */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(process.cwd(), rel);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(ok => server.listen(0, ok));
const base = process.argv[2] || `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext();

for (const page of ['tagger', 'finder']) {
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${base}/${page}.html`, { waitUntil: 'load' });
  await p.waitForTimeout(400);

  is(`${page}: loads without a script error`, errors, []);

  /* the actual bug: anything carrying [hidden] must not be painted */
  const shown = await p.$$eval('[hidden]', els => els
    .filter(e => getComputedStyle(e).display !== 'none')
    .map(e => (e.id ? '#' + e.id : e.className) + ' -> ' + getComputedStyle(e).display));
  is(`${page}: nothing marked hidden is painted`, shown, []);

  /* and nothing is sitting on top of the page swallowing clicks */
  const blocker = await p.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.position === 'fixed' && s.display !== 'none' && parseFloat(s.opacity) > 0
        && n.getBoundingClientRect().width > innerWidth * 0.8) return n.id || n.className;
    }
    return null;
  });
  is(`${page}: nothing is covering the page`, blocker, null);
  await p.close();
}

/* the tagger's own controls behave */
{
  const p = await ctx.newPage();
  await p.goto(`${base}/tagger.html`, { waitUntil: 'load' });
  await p.waitForTimeout(300);

  okay('tagger: the drop target is the thing you see', await p.locator('#drop').isVisible());
  okay('tagger: the tool rail waits for a video', !(await p.locator('#rail').isVisible()));
  okay('tagger: so does the transport', !(await p.locator('#transport').isVisible()));
  okay('tagger: the answer strip waits for a tag', !(await p.locator('#answer').isVisible()));

  /* the Cloud sheet opens, and has content in it */
  await p.click('#cloudbtn');
  await p.waitForTimeout(300);
  okay('tagger: Cloud opens', await p.locator('#cloudmodal').isVisible());
  const body = (await p.locator('#cbody').innerText()).trim();
  okay('tagger: and it is not empty', body.length > 20, JSON.stringify(body.slice(0, 60)));
  okay('tagger: it asks for an email', await p.locator('#cmail').isVisible());

  await p.click('#cloudmodal .mhead button:last-child');
  await p.waitForTimeout(250);
  okay('tagger: Cloud closes again', !(await p.locator('#cloudmodal').isVisible()));

  /* and the page underneath is usable */
  await p.click('.chip[data-v="finishing"]');
  is('tagger: the tagbar still takes clicks',
    await p.getAttribute('.chip[data-v="finishing"][data-k="moment"]', 'aria-pressed'), 'true');
  await p.close();
}

/* the finder lists sessions without being asked */
{
  const p = await ctx.newPage();
  await p.goto(`${base}/finder.html`, { waitUntil: 'load' });
  await p.waitForTimeout(400);
  okay('finder: the sheet is shut', !(await p.locator('#modal').isVisible()));
  okay('finder: the sign-in sheet is shut', !(await p.locator('#signmodal').isVisible()));
  const cards = await p.locator('#out .card').count();
  okay('finder: sessions are listed on arrival', cards > 0, cards + ' cards');
  await p.click('#c-theme .chip');
  await p.waitForTimeout(250);
  /* innerText, not textContent: the count is uppercased by CSS, so match loosely */
  okay('finder: picking a theme still filters', /\d+ sessions? match/i.test(await p.locator('#count').innerText()),
    await p.locator('#count').innerText());
  await p.close();
}

await browser.close();
server.close();
r.done();
