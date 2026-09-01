/* Live integration check against the real project. Opt-in: needs .env, and it
   talks to Supabase over the network, unlike the other three suites.

   It proves the parts a fake cannot: that the policies in the migration
   actually isolate one coach from another, that the anon key in config.js
   opens nothing, and that a signed page URL serves the right page.

   Creates two throwaway users and deletes them again.

   Usage: node .check/live.mjs
*/
import fs from 'fs';
import { reporter } from './harness.mjs';

const r = reporter(), is = r.is, okay = r.okay;
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const URL_BASE = env.SUPABASE_URL, SVC = env.SUPABASE_SERVICE_KEY;
const ANON = fs.readFileSync('config.js', 'utf8').match(/anonKey:\s*"([^"]+)"/)[1];
const admin = { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' };
const stamp = Date.now();

const j = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };

/* A throwaway coach. Created straight through the admin API and signed in
   with a password: the tools use an emailed code, but no headless test can
   read an inbox, and what is under test here is the policies, not the way
   the token was minted. Either route ends with the same authenticated JWT. */
async function signIn(email) {
  const password = "pw-" + Math.random().toString(36).slice(2) + "-Aa1!";
  const made = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: "POST", headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const u = await j(made);
  if (!u.id) throw new Error("create user: " + JSON.stringify(u).slice(0, 200));
  const tok = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const sess = await j(tok);
  if (!sess.access_token) throw new Error("sign in: " + JSON.stringify(sess).slice(0, 200));
  return { token: sess.access_token, id: u.id, email };
}
const asUser = u => ({ apikey: ANON, Authorization: 'Bearer ' + u.token, 'Content-Type': 'application/json' });

const alice = await signIn(`alice+${stamp}@example.com`);
const bob = await signIn(`bob+${stamp}@example.com`);
okay('a coach can sign in', !!alice.token);
okay('two coaches get different ids', alice.id !== bob.id);

/* --- nobody can give themselves an account ---------------------------- */
const selfSignup = await fetch(`${URL_BASE}/auth/v1/signup`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: `intruder+${stamp}@example.com`, password: "Str0ng-passw0rd!x" })
});
okay('a stranger cannot register with the public key', selfSignup.status >= 400, 'HTTP ' + selfSignup.status);
const selfOtp = await fetch(`${URL_BASE}/auth/v1/otp`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: `intruder2+${stamp}@example.com`, create_user: true })
});
okay('nor talk their way in with a magic link', selfOtp.status >= 400, 'HTTP ' + selfOtp.status);

/* alice is put on the approved list; bob deliberately is not */
await fetch(`${URL_BASE}/rest/v1/coaches`, {
  method: "POST", headers: { ...admin, Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify({ user_id: alice.id, email: alice.email, note: "live check" })
});

/* --- alice tags a match ------------------------------------------------- */
let mres = await fetch(`${URL_BASE}/rest/v1/matches`, {
  method: 'POST', headers: { ...asUser(alice), Prefer: 'return=representation' },
  body: JSON.stringify({ user_id: alice.id, us: 'Rovers', them: 'City', played_on: '2026-08-30' })
});
const match = (await j(mres))[0];
okay('she can file a match', mres.status === 201 && !!match.id, mres.status + ' ' + JSON.stringify(match).slice(0, 120));

const cres = await fetch(`${URL_BASE}/rest/v1/clips`, {
  method: 'POST', headers: { ...asUser(alice), Prefer: 'return=representation' },
  body: JSON.stringify([{
    match_id: match.id, user_id: alice.id, t: 114, tagged: 120,
    team: 'them', phase: 'defensive', moment: 'progression', verdict: 'bad',
    level: 'LGF', themes: ['pressing', 'compactness'], note: 'second ball lost',
    shapes: [{ k: 'ring', c: '#fff', x: 0.5, y: 0.6, r: 1 }]
  }])
});
const clip = (await j(cres))[0];
okay('and a clip under it', cres.status === 201, cres.status + ' ' + JSON.stringify(clip).slice(0, 140));
is('the themes came back as an array', clip && clip.themes, ['pressing', 'compactness']);
okay('the drawing survived the round trip', !!clip && Array.isArray(clip.shapes) && clip.shapes.length === 1);

/* --- the vocabulary is enforced in the database ------------------------- */
const badMoment = await fetch(`${URL_BASE}/rest/v1/clips`, {
  method: 'POST', headers: asUser(alice),
  body: JSON.stringify({
    match_id: match.id, user_id: alice.id, t: 1, tagged: 1, team: 'them',
    phase: 'defensive', moment: 'nonsense', verdict: 'bad'
  })
});
okay('a moment outside the vocabulary is refused', badMoment.status >= 400, 'HTTP ' + badMoment.status);

/* --- bob sees nothing of hers ------------------------------------------- */
const bobSees = await j(await fetch(`${URL_BASE}/rest/v1/matches?select=*`, { headers: asUser(bob) }));
is('another coach sees none of her matches', bobSees.length, 0);
const bobClips = await j(await fetch(`${URL_BASE}/rest/v1/clips?select=*`, { headers: asUser(bob) }));
is('nor any of her clips', bobClips.length, 0);

const steal = await fetch(`${URL_BASE}/rest/v1/matches?id=eq.${match.id}`, {
  method: 'PATCH', headers: asUser(bob), body: JSON.stringify({ them: 'stolen' })
});
const after = await j(await fetch(`${URL_BASE}/rest/v1/matches?id=eq.${match.id}&select=them`, { headers: asUser(alice) }));
is('and cannot edit one', after[0].them, 'City');

const forge = await fetch(`${URL_BASE}/rest/v1/matches`, {
  method: 'POST', headers: asUser(bob), body: JSON.stringify({ user_id: alice.id, us: 'forged' })
});
okay('nor file one in her name', forge.status >= 400, 'HTTP ' + forge.status);

/* --- the anon key on its own ------------------------------------------- */
const anonSees = await j(await fetch(`${URL_BASE}/rest/v1/matches?select=*`, { headers: { apikey: ANON } }));
is('the key in config.js reads nothing', Array.isArray(anonSees) ? anonSees.length : -1, 0);
const anonWrite = await fetch(`${URL_BASE}/rest/v1/matches`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ us: 'anon' })
});
okay('and writes nothing', anonWrite.status >= 400, 'HTTP ' + anonWrite.status);

/* --- the training pages ------------------------------------------------- */
const unsigned = await fetch(`${URL_BASE}/storage/v1/object/training-pages/0042.pdf`, { headers: { apikey: ANON } });
okay('a session page is not readable unsigned', unsigned.status >= 400, 'HTTP ' + unsigned.status);

/* an account on its own is not enough — the course needs the approved list */
const bobSign = await fetch(`${URL_BASE}/storage/v1/object/sign/training-pages/0042.pdf`, {
  method: "POST", headers: asUser(bob), body: JSON.stringify({ expiresIn: 60 })
});
okay('a signed-in but unapproved account cannot reach the bank', bobSign.status >= 400, 'HTTP ' + bobSign.status);
const bobAdds = await fetch(`${URL_BASE}/rest/v1/coaches`, {
  method: "POST", headers: asUser(bob), body: JSON.stringify({ user_id: bob.id, email: bob.email })
});
okay('nor add itself to the list', bobAdds.status >= 400, 'HTTP ' + bobAdds.status);
const bobReads = await j(await fetch(`${URL_BASE}/rest/v1/coaches?select=*`, { headers: asUser(bob) }));
is('nor see who is on it', Array.isArray(bobReads) ? bobReads.length : -1, 0);

/* but an unapproved account can still do its own tagging */
const bobMatch = await fetch(`${URL_BASE}/rest/v1/matches`, {
  method: "POST", headers: { ...asUser(bob), Prefer: "return=representation" },
  body: JSON.stringify({ user_id: bob.id, us: "Bob FC", them: "Someone" })
});
okay('an unapproved account can still tag its own matches', bobMatch.status === 201, 'HTTP ' + bobMatch.status);

const sign = await fetch(`${URL_BASE}/storage/v1/object/sign/training-pages/0042.pdf`, {
  method: 'POST', headers: asUser(alice), body: JSON.stringify({ expiresIn: 60 })
});
const signed = await j(sign);
okay('an approved coach can sign for one', !!signed.signedURL, JSON.stringify(signed).slice(0, 120));
const page = await fetch(`${URL_BASE}/storage/v1${signed.signedURL}`);
const buf = Buffer.from(await page.arrayBuffer());
okay('and it is a real PDF', page.status === 200 && buf.slice(0, 5).toString() === '%PDF-');
is('the right one, byte for byte', buf.length, fs.statSync('pages/0042.pdf').size);

/* --- deleting a match takes its clips --------------------------------- */
await fetch(`${URL_BASE}/rest/v1/matches?id=eq.${match.id}`, { method: 'DELETE', headers: asUser(alice) });
const left = await j(await fetch(`${URL_BASE}/rest/v1/clips?match_id=eq.${match.id}&select=id`, { headers: asUser(alice) }));
is('clips cascade with the match', left.length, 0);

/* --- tidy up ----------------------------------------------------------- */
await fetch(`${URL_BASE}/rest/v1/coaches?user_id=eq.${alice.id}`, { method: "DELETE", headers: admin });
for (const u of [alice, bob]) {
  await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: admin });
}
const gone = await j(await fetch(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: admin }));
const leftovers = (gone.users || []).filter(u => u.email && u.email.includes(String(stamp)));
is('the throwaway coaches are gone', leftovers.length, 0);

r.done();
