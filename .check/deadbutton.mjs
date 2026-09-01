/* Pressing a page button must always do something visible.

   The bug this exists for: signed out, the finder's "Open p.N" set one line of
   text in the bar at the top of the document and returned. Scrolled down among
   results — which is where you are when you press it — that is a dead button.

   Checks both tools, signed out and signed in, on the deployed site.

   Usage: node .check/repro-finder.mjs [site]
*/
import fs from 'fs';
import { chromium } from 'playwright-core';
import { reporter } from './report.mjs';

const r = reporter(), is = r.is, okay = r.okay;
const SITE = process.argv[2] || 'https://match-analysis-site1.vercel.app';
/* Deployed, there is no PDF in the folder, so a page can only come from the
   bank. Locally the PDF *is* there and the fallback quite correctly handles
   the click — which would make these checks pass for the wrong reason. Guard
   against being pointed at a folder that still has it. */
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
const exe = [
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`
].find(p => p && fs.existsSync(p));
if (!exe) { console.log('no browser found — skipping'); process.exit(0); }

async function signInUrl(dest) {
  const coach = (await (await fetch(`${env.SUPABASE_URL}/rest/v1/coaches?select=email&limit=1`, { headers: H })).json())[0];
  const gen = await (await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: coach.email })
  })).json();
  return `${env.SUPABASE_URL}/auth/v1/verify?token=${gen.hashed_token}&type=magiclink`
    + `&redirect_to=${encodeURIComponent(dest)}`;
}

const browser = await chromium.launch({ executablePath: exe });

/* ---------------- signed out: the button must not be a no-op ------------- */
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${SITE}/finder`, { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  is('finder, signed out: starts signed out', await p.evaluate("typeof CLOUD==='undefined'?'x':String(CLOUD.email||'')"), '');
  okay('finder, signed out: the sign-in button is prominent',
    (await p.getAttribute('#signbtn', 'class')) === 'pick', await p.getAttribute('#signbtn', 'class'));

  await p.click('#c-theme .chip');
  await p.waitForTimeout(400);
  /* scroll to the results, where a coach actually is when they press it */
  await p.locator('#out .card .pg').first().scrollIntoViewIfNeeded();
  const barVisibleBefore = await p.locator('#pdfname').isVisible();

  await p.click('#out .card .pg >> nth=0');
  await p.waitForTimeout(900);

  okay('finder, signed out: pressing it opens the sign-in sheet',
    await p.locator('#signmodal').isVisible());
  const why = (await p.locator('#signwhy').innerText()).trim();
  okay('finder, signed out: and it names the page you wanted', /page \d+/i.test(why), JSON.stringify(why.slice(0, 70)));
  okay('finder, signed out: with a way out that is not an account',
    await p.locator('#signmodal button', { hasText: 'Use my own PDF' }).isVisible());
  console.log(`    (the old failure text lived in #pdfname, ${barVisibleBefore ? 'visible' : 'scrolled out of view'} at that moment)`);
  await ctx.close();
}

/* ---------------- signing in from that sheet finishes the job ------------ */
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${SITE}/finder`, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.click('#c-theme .chip');
  await p.waitForTimeout(400);
  const want = parseInt((await p.locator('#out .card .pg').first().innerText()).match(/\d+/)[0], 10);
  await p.click('#out .card .pg >> nth=0');
  await p.waitForTimeout(700);
  okay('the sheet is up, holding the request', await p.locator('#signmodal').isVisible());

  /* sign in in the same tab, as the emailed link would */
  await p.goto(await signInUrl(`${SITE}/finder`), { waitUntil: 'load' });
  await p.waitForTimeout(2200);
  is('signed in now', await p.evaluate("typeof CLOUD==='undefined'?'x':String(!!CLOUD.user)"), 'true');

  /* the pending page does not survive a full page load, so press it again */
  await p.click('#c-theme .chip');
  await p.waitForTimeout(400);
  await p.click('#out .card .pg >> nth=0');
  await p.waitForTimeout(2200);
  okay('and now the page opens', await p.locator('#modal').isVisible());
  okay('from the bank', /training-pages\/\d+\.pdf/.test(String(await p.getAttribute('#mframe', 'src'))));
  await ctx.close();
}

/* ---------------- the tagger's button, signed out ------------------------ */
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${SITE}/tagger`, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.evaluate('openPage(42)');
  await p.waitForTimeout(900);
  okay('tagger, signed out: pressing a page opens the Cloud sheet',
    await p.locator('#cloudmodal').isVisible());
  okay('tagger, signed out: and the status says why',
    /sign in to open page 42/i.test(await p.locator('#status').innerText()),
    await p.locator('#status').innerText());
  await ctx.close();
}

await browser.close();
r.done();
