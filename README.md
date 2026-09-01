# Match Analysis — deploy notes

A three-page static site. No build step, no server, no database. Everything runs in the visitor's browser.

```
index.html          landing page
tagger.html         Video Tagger — telestration, match coding, session suggestions
finder.html         Session Finder — the same 617 sessions, searched by hand
sessions.js         the index and the tag vocabulary, shared by both tools
config.js           Supabase URL + anon key. Blank = everything stays local
cloud.js            the optional cloud layer: login, saved matches, page serving
supabase/           migration, auth config, email template
tools/              PDF splitter and uploader
Training Tasks.pdf  your own copy of the MBP bank — not in git, see below
favicon.svg         icon
robots.txt          asks search engines to stay away
vercel.json         headers + clean URLs
```

## How the two tools join up

`sessions.js` holds the 617-session index **and** the vocabulary — the moments, phases,
themes, levels and microcycle days. Both pages load it, so a tag made in the tagger means
exactly the same thing to the finder, and one scorer (`rankSessions`) ranks the bank for both.

Tag a moment in the tagger and the strip under the tagbar names the session that trains it and
the page it is on; the **Sessions** tab holds the full shortlist, and *Open this search in the
finder* hands the same filters to `finder.html`. The exported match note carries the session
titles and page numbers against each finding.

Add a theme or rename a level in `sessions.js` and both pages change together.

## The cloud, which is optional but is now set up

`config.js` points at a Supabase project in eu-west-2 — schema applied, all 617
session pages uploaded. Details and how it was built: **[SETUP.md](SETUP.md)**.

It stays optional in the way that matters. Blank `config.js` and both tools are
what they always were: video from disk, PDF from this folder, work saved as a
JSON download. Nothing to sign up for, nothing to go wrong at half time. Signed
out, they behave the same way. That is deliberate and it is tested.

Signed in, you also get:

- **matches saved off the laptop.** Clips, themes, levels, notes and the
  drawings, in Postgres, private to whoever tagged them by row-level security.
  The first save is a button; after that it keeps itself in step as you tag.
- **the training bank without the 243 MB file.** The PDF is split into 617
  one-page files in a private bucket; opening a session fetches that page and
  nothing else, through a URL signed for you that lapses within the hour.
- **an email sign-in.** A link in the post, no password to keep.

Sign-ups are off — `config.js` is in a public repo, so open registration would
have handed the course to anyone who found it. Accounts are made with
`node tools/approve-coach.mjs them@club.com`.

### Using it

It is deployed: **https://match-analysis-site1.vercel.app**

Sign in from the Cloud button, or skip the mailer with
`node tools/signin-link.mjs --open`. Sign in once and the session sticks.

For working on it locally, `node tools/serve.mjs` serves port 3000 and
`node tools/signin-link.mjs --local --open` signs you in there.

The match video is never uploaded, with or without a cloud. It is gigabytes,
and it is yours.

> **Before you sign in:** the free plan sends about **two emails an hour** and
> will not let us change the template, so what arrives is a link and no code —
> the code box in both tools stays decorative until you add custom SMTP. Fine
> for one person; add SMTP before a second coach uses it. SETUP.md covers it.

## The PDF

`Training Tasks.pdf` must sit in this folder, next to `index.html`. Both tools open it by
themselves — no picking a file first — and every session result jumps to its own page.

It is **not** in git (`.gitignore`), because it is 243 MB of MBP course material: over
GitHub's 100 MB file limit, and not ours to publish. Keep your copy here locally. If the file
is missing, both pages fall back to a file picker and work exactly as before.

That size also rules out dropping the folder on Vercel as-is — see below.

## Deploy in about a minute

> **Deploy without the PDF.** A 243 MB file will not go up: Vercel rejects it long before the
> deploy finishes, and putting the course material on a public URL is not something to do by
> accident. Upload everything *except* `Training Tasks.pdf` — the pages fall back to the file
> picker, and each person points at their own copy. `.vercelignore` already keeps the test rig out.

**Vercel Drop** — go to `vercel.com/drop`, sign in, drag the files onto the page, pick a team and a project name, hit Deploy. You get a live URL straight away.

> **`index.html` must sit at the top level of what you drop.** If you drag a folder that *contains* the files, or a zip that unpacks into a folder, Vercel finds no page at the root and the deploy fails within a second or two. Either select all seven files and drag them together, or drag the unzipped folder's *contents*.

If a deploy does fail, expand **Deployment Summary** on the result screen — the actual error is in there, not in the Deploy Logs panel. And if anything about `vercel.json` is ever the problem, just delete it: the site works without it. All it does is add no-index headers and let `/tagger` work as well as `/tagger.html`.

One catch worth knowing before you start: **each drop creates a new project with a new URL.** Drop is for getting something live, not for iterating. If you'll be updating the site, do it once through Drop to see it working, then connect it to a Git repo from the project's settings — after that every push redeploys the same address.

**Vercel CLI**, if you'd rather stay in the terminal:

```bash
npm i -g vercel
cd this-folder
vercel          # preview URL
vercel --prod   # production URL
```

## Custom domain

Project → Settings → Domains → add yours, then point the DNS records Vercel shows you. Free on any plan.

## About privacy

`robots.txt` and the `X-Robots-Tag` header ask search engines not to index the site. That's a request, not a lock — **the URL is public to anyone who has it.**

If you want a real gate:

- **Vercel Authentication** (all plans, including Hobby) protects preview and deployment URLs, but your production domain stays public. That's the opposite of what you'd want here.
- **Password Protection** needs Enterprise, or the paid Advanced Deployment Protection add-on on Pro.
- **Cloudflare Pages + Cloudflare Access** is the usual free route to a real password gate. Worth checking their current free-tier limits before committing.

## What to think about before sharing the address

The **video tagger** holds your own match code — but it now loads `sessions.js` too, so it carries
the same 617 session titles the finder does.

`sessions.js` is the MBP course's material: 617 titles and objectives. Treat any address serving it
as something for people who already own the course, and never upload `Training Tasks.pdf` itself.
If in doubt, run the whole thing locally — open `index.html`, or `npx serve .` if you want the
PDF page anchors to behave.

## Updating later

Each tool is one HTML file plus the shared `sessions.js`. Edit them, re-drop (or push, if you
connected Git). There is no state on the server to migrate — every visitor's work lives in their
own downloads.

## Checking a change

There is a small jsdom harness that drives both pages headlessly — tagging, the drawing
lifecycle, the session shortlist, the export, the finder deep link:

```bash
npm i --no-save --prefix .check jsdom
node .check/smoke.mjs     # the tagger, 42 checks
node .check/finder.mjs    # the finder, 13 checks
node .check/cloud.mjs     # the cloud paths, 52 checks against a fake Supabase
node .check/browser.mjs   # what Edge/Chrome actually paint, 19 checks
node .check/live.mjs      # 25 checks against the real project — needs .env
```

The first three never touch the network; the cloud suite talks to an in-memory
stand-in and asserts both halves of the deal — that signing in really does move
storage and page serving to Supabase, and that a blank config leaves both tools
exactly as they were.

`live.mjs` is the one that matters for security, and it earned its keep: it is
what proved that a stranger could once register themselves with the public key
and download all 617 pages. It creates two throwaway coaches, approves one, and
checks that nobody can self-register, that neither coach can touch the other's
work, that the key in `config.js` can do nothing at all, and that an account not
on the approved list cannot open a single session page. Then it cleans up.
