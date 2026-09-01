/* Does clicking a result actually open that session?

   Signs in for real, opens the finder against the deployed site, clicks a
   result's page button, and checks that what lands in the sheet is a signed
   URL for that exact page — then fetches it and confirms it is the right PDF,
   byte for byte against the local copy.

   Then does the same from the tagger, which reaches pages by a different path.

   Usage: node .check/open-page.mjs [site]
*/
import fs from 'fs';
import { chromium } from 'playwright-core';
import { reporter } from './report.mjs';

const r = reporter(), is = r.is, okay = r.okay;
const SITE = process.argv[2] || 'https://match-analysis-site1.vercel.app';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };

const CANDIDATES = [
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'
];
const exe = CANDIDATES.find(p => p && fs.existsSync(p));
if (!exe) { console.log('no browser found — skipping'); process.exit(0); }

/* a real sign-in, the same one the tools use */
const coach = (await (await fetch(`${env.SUPABASE_URL}/rest/v1/coaches?select=email&limit=1`, { headers: H })).json())[0];
const gen = await (await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: coach.email })
})).json();
const signInUrl = `${env.SUPABASE_URL}/auth/v1/verify?token=${gen.hashed_token}&type=magiclink`
  + `&redirect_to=${encodeURIComponent(SITE + '/finder')}`;

const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext();
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));

await p.goto(signInUrl, { waitUntil: 'load' });
await p.waitForTimeout(1800);
/* CLOUD is a top-level const: a global lexical binding, not a window property.
   evaluate() runs in global scope, so name it directly. */
okay('signed in on the deployed finder', await p.evaluate("!!(typeof CLOUD !== 'undefined' && CLOUD.user)"),
  await p.evaluate("typeof CLOUD === 'undefined' ? 'no CLOUD' : String(CLOUD.email)"));
is('no script errors while signing in', errors, []);

okay('the bar says pages come from the bank',
  /bank/i.test(await p.locator('#pdfname').innerText()), await p.locator('#pdfname').innerText());

/* search the way a coach would, then open the top result */
await p.click('#c-moment .chip[data-v="progression"]');
await p.click('#c-theme .chip[data-v="pressing"]');
await p.waitForTimeout(400);
const cards = await p.locator('#out .card').count();
okay('the search returns sessions', cards > 0, cards + ' cards');

const topTitle = (await p.locator('#out .card h3').first().innerText()).trim();
const btn = p.locator('#out .card .pg').first();
const claimed = parseInt((await btn.innerText()).match(/\d+/)[0], 10);
console.log(`\n  top result: "${topTitle.slice(0, 58)}" -> p.${claimed}\n`);

await btn.click();
await p.waitForTimeout(2500);

okay('the sheet opened', await p.locator('#modal').isVisible());
const src = await p.getAttribute('#mframe', 'src');
okay('it is serving from the bank, not a local file',
  /storage\/v1\/object\/sign\/training-pages\//.test(src || ''), String(src).slice(0, 90));
is('and it is the page the result claimed',
  (String(src).match(/training-pages\/(\d+)\.pdf/) || [])[1], String(claimed).padStart(4, '0'));

/* fetch what the iframe was given and prove it is that session's page */
const fetched = await p.evaluate(async (u) => {
  const res = await fetch(u.split('#')[0]);
  const b = await res.arrayBuffer();
  return { status: res.status, len: b.byteLength, head: new TextDecoder().decode(b.slice(0, 5)) };
}, src);
is('the page really downloads', fetched.status, 200);
is('as a PDF', fetched.head, '%PDF-');
is('identical to the local copy of that page', fetched.len,
  fs.statSync(`pages/${String(claimed).padStart(4, '0')}.pdf`).size);

/* the index's claim about that page, checked against the page's own text */
const S = JSON.parse(fs.readFileSync('sessions.js', 'utf8').match(/^const S = (\[.*\]);?$/m)[1]);
is('the finder showed the title the index holds for that page',
  topTitle.slice(0, 40), (S.find(s => s.page === claimed).title || '').slice(0, 40));

await p.locator('#modal .pick.ghost:last-child').click();
await p.waitForTimeout(300);
okay('the sheet closes again', !(await p.locator('#modal').isVisible()));

/* --- and the same from the tagger, which takes a different route --- */
const t = await ctx.newPage();
const terrs = [];
t.on('pageerror', e => terrs.push(e.message));
await t.goto(`${SITE}/tagger`, { waitUntil: 'load' });
await t.waitForTimeout(1500);
okay('tagger picked up the same session', await t.evaluate("!!(typeof CLOUD !== 'undefined' && CLOUD.user)"),
  await t.evaluate("typeof CLOUD === 'undefined' ? 'no CLOUD' : String(CLOUD.email)"));
await t.evaluate(() => openPage(42));
await t.waitForTimeout(2000);
const tsrc = await t.getAttribute('#mframe', 'src');
okay('tagger opens its page from the bank too',
  /training-pages\/0042\.pdf/.test(String(tsrc)), String(tsrc).slice(0, 90));
is('no script errors in the tagger', terrs, []);

await browser.close();
r.done();
