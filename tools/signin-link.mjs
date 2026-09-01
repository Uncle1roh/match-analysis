/* Sign in without touching email.

   The normal route is: type your address into the tool, wait for a link. That
   is right for anyone else, but it costs a round trip through a mailer capped
   at roughly two messages an hour — and if you are the only person using this,
   it is pure friction.

   This mints the same link with the service key and hands it straight over.
   One click and the browser is signed in, exactly as if the mail had arrived.
   The link is single-use and dies within the hour.

   Usage:
     node tools/signin-link.mjs                    # the only approved coach
     node tools/signin-link.mjs you@club.com       # a specific one
     node tools/signin-link.mjs --open             # and open the browser too
     node tools/signin-link.mjs --port 8931        # if you serve on another port
*/
import fs from 'fs';
import { execFile } from 'child_process';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const URL_BASE = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !KEY) { console.error('.env needs SUPABASE_URL and SUPABASE_SERVICE_KEY'); process.exit(1); }
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const j = async res => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };

const args = process.argv.slice(2);
const open = args.includes('--open');
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? args[portAt + 1] : '3000';
const page = args.find(a => a === 'finder' || a === 'tagger') || 'tagger';
let email = args.find(a => a.includes('@'));

if (!email) {
  const rows = await j(await fetch(`${URL_BASE}/rest/v1/coaches?select=email&order=added_at`, { headers: H }));
  if (!rows.length) {
    console.error('nobody is approved yet — run: node tools/approve-coach.mjs you@club.com');
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error('more than one approved coach; say which:');
    rows.forEach(r => console.error('  ' + r.email));
    process.exit(1);
  }
  email = rows[0].email;
}

const dest = `http://localhost:${port}/${page}.html`;
const gen = await j(await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ type: 'magiclink', email, options: { redirect_to: dest } })
}));
if (!gen.hashed_token) {
  console.error('could not mint a link: ' + JSON.stringify(gen).slice(0, 300));
  process.exit(1);
}

/* Point at the project's own verify endpoint rather than gen.action_link, so
   the redirect lands on the port actually being served. */
const link = `${URL_BASE}/auth/v1/verify?token=${gen.hashed_token}`
  + `&type=magiclink&redirect_to=${encodeURIComponent(dest)}`;

console.log(`signing in ${email} at ${dest}`);
console.log('\n' + link + '\n');
console.log('Single use, good for an hour. Make sure the site is running first:');
console.log('  node tools/serve.mjs');

if (open) {
  /* NOT `cmd /c start`: cmd reads & as a command separator, so it hands the
     browser everything up to the first one and drops &type=magiclink — which
     comes back as "Verify requires a verification type". PowerShell takes the
     whole thing when it is single-quoted. */
  const [cmd, args] = process.platform === 'win32'
    ? ['powershell', ['-NoProfile', '-Command', 'Start-Process', "'" + link.replace(/'/g, "''") + "'"]]
    : process.platform === 'darwin'
      ? ['open', [link]]
      : ['xdg-open', [link]];
  execFile(cmd, args, err => {
    if (err) console.log('\n(could not open a browser — paste the link above yourself)');
  });
}
