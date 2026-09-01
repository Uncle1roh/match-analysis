# The Supabase side

**This is already done.** The project exists, the schema is applied, and all
617 session pages are uploaded. `config.js` points at it. What follows is the
record of how, so it can be redone, moved, or handed over.

| | |
|---|---|
| Organisation | Match Analysis |
| Project | Match analysis — `wzpswtrudjmneidfbnru` |
| Region | eu-west-2 (London) |
| Plan | Free |
| Sign-ups | **off** — accounts are made with `tools/approve-coach.mjs` |
| Dashboard | https://supabase.com/dashboard/project/wzpswtrudjmneidfbnru |

The database password, the project ref and the service-role key are in `.env`,
which is gitignored. **Keep that file.** The password cannot be read back from
Supabase — only reset.

---

## Running it

It is deployed: **https://match-analysis-site1.vercel.app**

Open it and press **Cloud** → your address → follow the link. Or skip the mailer
entirely:

```bash
node tools/signin-link.mjs --open
```

To work on it locally instead:

```bash
node tools/serve.mjs                        # http://localhost:3000
node tools/signin-link.mjs --local --open
```

A local server is required for that — signing in *needs* http, because the link
has to come back to an address on the project's allow-list and `file://` can
never be one. Port 3000 is on that list, as is the deployed origin.

`signin-link.mjs` mints a sign-in link with the service key and opens it — same
link the email would carry, without the email. Single use, an hour to live. That
matters more than it sounds: the free mailer sends about two messages an hour, so
the email route punishes a typo. Nothing about the account is weaker for it; the
link is minted by a key that already has full access.

Sign in once and it sticks — the session is kept in the browser and refreshes
itself. You should not need either command again until you clear site data.

## Adding somebody

**Sign-ups are off.** That is deliberate: the publishable key lives in
`config.js`, which is in a public repo, so open registration would have let
anyone who found it pull the whole course.

```bash
node tools/approve-coach.mjs them@theirclub.com
```

That creates the auth user and puts them on the `coaches` list, which is what
the storage policy checks. They then open the tagger, press **Cloud**, enter the
same address, and follow the link that arrives — or you send them one from
`signin-link.mjs`.

```bash
node tools/approve-coach.mjs --list                  # who has access
node tools/approve-coach.mjs --revoke them@club.com  # take the bank away
```

Currently approved: **didaskodeve@gmail.com**.

Revoking removes the course pages, not their own coding: a coach's clips are
their work and stay reachable to their account.

### Two locks, not one

Sign-up being off means no account can appear without the service key. The
`coaches` list means that even if sign-ups were switched back on tomorrow, an
account still would not reach the training pages. Either alone would do the job;
having both means neither has to be remembered.

What is *not* gated: tagging. Any account can code its own matches and read its
own rows back. It is the MBP material, which is not ours to hand out, that needs
the list.

---

## Read this before you sign in for the first time

The free plan's built-in mailer sends **about two emails an hour**, and it will
not let you change the email template — the API refuses with *"Email template
modification is not available for free tier projects using the default email
provider"*. Two things follow:

- **Sign in with the link, not a code.** The stock mail contains a link and no
  code. Both tools still show a code box, because it starts working the moment
  the mail can carry one; until then it stays empty.
- **Two mails an hour is not a login system for a staff.** For anyone beyond
  you testing it, add custom SMTP (Resend and Postmark both have free tiers
  that cover this) under **Authentication → Emails**. That lifts the rate
  limit *and* unlocks the template — at which point uncomment the
  `[auth.email.template.magic_link]` block in `supabase/config.toml`, run
  `supabase config push`, and the code box comes alive.

A sign-in link is refused unless it lands on an address in
`additional_redirect_urls` in `supabase/config.toml`. Localhost ports 3000,
5173, 8000, 8080 and 8931 are listed. **Add your deployed address there and
push again** before signing in from anywhere else.

---

## How it was built

Everything below is reproducible from this folder. You need the Supabase CLI
(`npm i -g supabase`) and `supabase login`.

```bash
supabase orgs create "Match Analysis"
supabase projects create "Match analysis" --org-id <org> --region eu-west-2 --db-password <pw>
supabase link --project-ref <ref> --password <pw>
supabase db push          # tables, policies, bucket
supabase config push      # auth settings and redirect allow-list
node tools/split-pdf.mjs      # Training Tasks.pdf -> pages/0001.pdf … 0617.pdf
node tools/upload-pages.mjs   # -> the training-pages bucket
```

Then put the project URL and the **publishable** key
(`supabase projects api-keys --project-ref <ref>`) into `config.js`.

### What the migration sets up

`supabase/migrations/20260901120000_match_analysis.sql`:

- `matches` and `clips`, with the tag vocabulary enforced as check constraints
  — a clip with a moment outside `buildup / progression / finishing /
  set-pieces` is refused by the database, not just by the page.
- Four RLS policies on each table rather than one `FOR ALL`, so that inserting
  a row in someone else's name and handing a row away are both refused, not
  merely discouraged.
- A private `training-pages` bucket, 50 MB per object, PDFs only, with **no
  write policy at all**: pages go up from `tools/upload-pages.mjs` with the
  service key, never from a browser.

`supabase/migrations/20260901140000_approved_coaches.sql` then tightens it:

- a `coaches` table — the list of people allowed to read the bank. A coach can
  read their own row and nothing else; there is no insert, update or delete
  policy, so only the service role can change who is on it.
- the bucket's read policy now requires a row on that list, not merely a
  session. This is the second of the two locks described above.

### About the keys

`config.js` carries the **publishable** key. That is what it is for — it is in
every page load and it opens nothing on its own, which the live check proves by
trying.

The **service-role** key in `.env` ignores every policy above. It belongs to
`tools/` and nowhere else. Never put it in `config.js`, and never commit it.

### Why the PDF is 617 files

The free plan refuses any single object over 50 MB, and the book is 243 MB. It
would be the wrong shape even without that rule: opening one drill should not
pull the whole course. Split, it is 617 files averaging 412 KB — biggest 3.9 MB
— for 248 MB of the free 1 GB.

`tools/upload-pages.mjs` is resumable: it lists what is already there, compares
sizes, and sends only what is missing or different. `--force` re-sends
everything.

---

## Checking it

```bash
npm i --no-save --prefix .check jsdom
node .check/smoke.mjs     # the tagger, 42 checks
node .check/finder.mjs    # the finder, 13 checks
node .check/cloud.mjs     # the cloud paths against a fake Supabase, 52 checks
node .check/browser.mjs   # what Edge/Chrome actually paint, 19 checks
node .check/live.mjs      # against the real project, 25 checks — needs .env
```

The first three never touch the network. `live.mjs` does, and it is the one to
rerun after any change to the migrations. It creates two throwaway coaches and
approves only one, then checks that:

- a stranger can neither register with the public key nor talk their way in
  with a magic link
- one coach can neither read, edit, nor forge a row belonging to the other
- the key sitting in `config.js` can read nothing and write nothing
- an account that exists but is **not** on the approved list cannot reach a
  session page, cannot add itself to the list, and cannot see who is on it —
  while still being able to tag its own matches
- an approved coach gets a signed page that matches the local file byte for byte

Then it deletes both users and its list entry.

## Cost, and the one catch

Free plan: 500 MB database (this schema uses kilobytes), 1 GB storage (248 MB
used), 5 GB egress a month. A session page is ~400 KB, so egress is a question
somewhere past ten thousand page opens a month.

The catch: **a free project pauses after a week with no requests.** Opening the
site wakes it, but the first request after a pause is slow, and the tagger will
look like it has failed to save. If that becomes annoying, Pro removes it.

## Turning it off

Blank out `config.js`. Both tools drop straight back to local files — video
from disk, PDF from this folder, work saved as a JSON download — with nothing
else changed. The data stays in Postgres until you delete it.
