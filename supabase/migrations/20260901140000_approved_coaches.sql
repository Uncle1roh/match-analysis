-- Close the door the first migration left open.
--
-- config.js carries the publishable key, and that file lives in a public git
-- repo — which is fine and is what the key is for. What was not fine: sign-ups
-- were open, and the bucket policy read `to authenticated`. Together those two
-- meant anyone who found the repo could register themselves an account and
-- pull all 617 pages of the MBP course.
--
-- Two changes. Sign-ups are turned off in supabase/config.toml, so an account
-- can only be made with the service role. And access to the pages now needs
-- more than a session: it needs a row in `coaches`, put there deliberately.
-- Either one alone would do; both means neither has to be remembered.

create table if not exists public.coaches (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text not null,
  note     text not null default '',
  added_at timestamptz not null default now()
);

comment on table public.coaches is
  'People allowed to read the training bank. Rows are added with the service role only (tools/approve-coach.mjs) — there is deliberately no insert policy.';

alter table public.coaches enable row level security;

-- A coach may confirm their own approval and nothing else. No insert, update or
-- delete policy exists, so the anon and authenticated roles cannot write here
-- at all; only the service role can, and it bypasses RLS by design.
drop policy if exists "a coach sees their own approval" on public.coaches;
create policy "a coach sees their own approval" on public.coaches for select to authenticated
  using ((select auth.uid()) = user_id);

-- The bucket now checks membership, not merely a session.
drop policy if exists "signed in coaches read training pages" on storage.objects;
drop policy if exists "approved coaches read training pages" on storage.objects;
create policy "approved coaches read training pages" on storage.objects for select to authenticated
  using (
    bucket_id = 'training-pages'
    and exists (select 1 from public.coaches c where c.user_id = (select auth.uid()))
  );

-- Tagging is deliberately NOT gated on this. A coach's own match coding is
-- their own work and stays reachable to any account they hold; it is the
-- course material, which is not ours to hand out, that needs the list.
