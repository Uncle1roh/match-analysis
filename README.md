# Match Analysis — deploy notes

A three-page static site. No build step, no server, no database. Everything runs in the visitor's browser.

```
index.html     landing page
tagger.html    Video Tagger — telestration and match coding
finder.html    Session Finder — 617 sessions, indexed
favicon.svg    icon
robots.txt     asks search engines to stay away
vercel.json    headers + clean URLs
```

## Deploy in about a minute

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

The **tagger** holds nothing but your own code — share it freely.

The **finder** is different: its index carries 617 session titles and objectives from the MBP course. That's their material. Treat that page as something for people who already own the course, and never put the PDF itself on the site — the finder is built so each person picks their own local copy. If in doubt, delete `finder.html` before deploying and keep it as a local file.

## Updating later

Both tools are single self-contained files. Edit them, re-drop (or push, if you connected Git). There is no state on the server to migrate — every visitor's work lives in their own downloads.
