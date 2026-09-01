/* Give someone an account and access to the training bank.

   Sign-ups are off, so this is the only way in. It creates the auth user if
   they do not have one, then puts them on the `coaches` list that the bucket
   policy checks. Run it again for the same address and nothing breaks.

   Usage:
     node tools/approve-coach.mjs coach@club.com ["optional note"]
     node tools/approve-coach.mjs --list
     node tools/approve-coach.mjs --revoke coach@club.com

   Revoking takes away the training pages, not their own match coding: their
   clips are their work and stay reachable to their account.
*/
import fs from 'fs';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const URL_BASE = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !KEY) { console.error('.env needs SUPABASE_URL and SUPABASE_SERVICE_KEY'); process.exit(1); }
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const j = async res => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };

const args = process.argv.slice(2);
const list = async () => {
  const rows = await j(await fetch(`${URL_BASE}/rest/v1/coaches?select=email,note,added_at&order=added_at`, { headers: H }));
  if (!rows.length) return console.log('nobody is approved yet');
  console.log(`${rows.length} approved:`);
  rows.forEach(r => console.log(`  ${r.email}${r.note ? '  — ' + r.note : ''}   (${r.added_at.slice(0, 10)})`));
};

async function findUser(email) {
  const r = await j(await fetch(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=1000`, { headers: H }));
  return (r.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
}

if (args[0] === '--list') { await list(); process.exit(0); }

if (args[0] === '--revoke') {
  const email = args[1];
  if (!email) { console.error('which address?'); process.exit(1); }
  const u = await findUser(email);
  if (!u) { console.error('no account for ' + email); process.exit(1); }
  const res = await fetch(`${URL_BASE}/rest/v1/coaches?user_id=eq.${u.id}`, { method: 'DELETE', headers: H });
  if (!res.ok) { console.error('revoke failed: ' + await res.text()); process.exit(1); }
  console.log(`${email} can no longer open the training bank. Their own clips are untouched.`);
  await list();
  process.exit(0);
}

const email = args[0];
if (!email || !email.includes('@')) {
  console.error('usage: node tools/approve-coach.mjs coach@club.com ["note"]');
  process.exit(1);
}
const note = args[1] || '';

let user = await findUser(email);
if (user) {
  console.log(`account already exists for ${email}`);
} else {
  const made = await j(await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ email, email_confirm: true })
  }));
  if (!made.id) { console.error('could not create the account: ' + JSON.stringify(made).slice(0, 300)); process.exit(1); }
  user = made;
  console.log(`account created for ${email}`);
}

const up = await fetch(`${URL_BASE}/rest/v1/coaches`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify({ user_id: user.id, email, note })
});
if (!up.ok) { console.error('could not add them to the list: ' + await up.text()); process.exit(1); }

console.log(`${email} is approved for the training bank.`);
console.log('They sign in from the Cloud button in the tagger: enter this address,');
console.log('then open the link that arrives. No password is ever set.');
console.log();
await list();
