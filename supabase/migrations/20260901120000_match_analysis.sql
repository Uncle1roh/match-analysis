-- Match analysis: matches, clips, and the split training PDF.
--
-- One coach, one bank of matches. Every row carries the user who tagged it and
-- row-level security keeps it that way: nobody reads or writes anyone else's
-- work, and the anon key on its own gets nothing at all.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- matches --
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  us          text not null default '',
  them        text not null default '',
  played_on   text not null default '',            -- kept as typed: the tagger's date box is free text
  cam         jsonb not null default '{}'::jsonb,  -- camera calibration for this match's footage
  train       jsonb not null default '{}'::jsonb,  -- microcycle day + squad size the sessions are picked for
  video_name  text not null default '',            -- the file the clips were cut against; the video itself never leaves the machine
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.matches is 'One coded match. The video stays on the coach''s disk; only the coding lives here.';

-- ------------------------------------------------------------------ clips --
create table if not exists public.clips (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  t          double precision not null,            -- clip start, lead-in already taken off
  tagged     double precision not null,            -- the second the coach hit Tag
  team       text not null check (team in ('us','them')),
  phase      text not null check (phase in ('attacking','defensive','transition','set-pieces')),
  moment     text not null check (moment in ('buildup','progression','finishing','set-pieces')),
  verdict    text not null check (verdict in ('good','bad','neutral')),
  level      text not null default '',             -- IFP / LGF / UCF / IBF / CBF / SP / GM / PER / SMS, or blank
  themes     text[] not null default '{}',
  player     text not null default '',
  note       text not null default '',
  img        text not null default '',             -- filename of a snapshot the coach saved locally
  shapes     jsonb,                                -- the telestration, in normalised coordinates
  cam        jsonb,                                -- the calibration the drawing was made under
  created_at timestamptz not null default now()
);

comment on column public.clips.shapes is 'Drawing for this clip in 0-1 frame coordinates, so it survives any window size.';

create index if not exists clips_match_idx  on public.clips(match_id);
create index if not exists clips_user_idx   on public.clips(user_id);
create index if not exists clips_theme_idx  on public.clips using gin(themes);
create index if not exists matches_user_idx on public.matches(user_id, updated_at desc);

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists matches_touch on public.matches;
create trigger matches_touch before update on public.matches
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------- RLS --
alter table public.matches enable row level security;
alter table public.clips   enable row level security;

-- Four policies each, not one FOR ALL: insert needs `with check` so a coach
-- cannot file a row under someone else's id, update needs both clauses so they
-- cannot hand a row away.  (select auth.uid()) is cached per statement.

drop policy if exists "matches are read by their owner"   on public.matches;
drop policy if exists "matches are made by their owner"   on public.matches;
drop policy if exists "matches are edited by their owner" on public.matches;
drop policy if exists "matches are dropped by their owner" on public.matches;

create policy "matches are read by their owner"    on public.matches for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "matches are made by their owner"    on public.matches for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "matches are edited by their owner"  on public.matches for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "matches are dropped by their owner" on public.matches for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "clips are read by their owner"    on public.clips;
drop policy if exists "clips are made by their owner"    on public.clips;
drop policy if exists "clips are edited by their owner"  on public.clips;
drop policy if exists "clips are dropped by their owner" on public.clips;

create policy "clips are read by their owner"    on public.clips for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "clips are made by their owner"    on public.clips for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "clips are edited by their owner"  on public.clips for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "clips are dropped by their owner" on public.clips for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- storage --
-- The MBP bank, one PDF per session page. Private: signed URLs only, and only
-- for signed-in coaches. 50 MB cap matches the free plan's own ceiling.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-pages', 'training-pages', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "signed in coaches read training pages" on storage.objects;
create policy "signed in coaches read training pages" on storage.objects for select to authenticated
  using (bucket_id = 'training-pages');
-- No insert/update/delete policy on purpose: pages go up with the service role
-- from tools/upload-pages.mjs, never from the browser.
