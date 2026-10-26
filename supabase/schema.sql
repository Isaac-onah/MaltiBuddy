-- Run this once in the Supabase SQL editor.
-- Then, in Authentication → Providers, turn on Anonymous sign-ins.
-- The website uses the anon key. These policies let a person read and write
-- only their own rows. The archive schema is not readable from the website.

create schema if not exists archive;

revoke all on schema archive from public;
revoke all on schema archive from anon;
revoke all on schema archive from authenticated;

create table if not exists public.learners (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  email text not null check (position('@' in email) > 1),
  gdpr_accepted boolean not null,
  gdpr_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint learners_gdpr_accepted check (gdpr_accepted = true),
  constraint learners_email_unique unique (email)
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learners (id) on delete cascade,
  lesson_id integer not null,
  lesson_title text not null,
  section text not null,
  percent integer not null check (percent between 0 and 100),
  stars integer not null check (stars between 0 and 3),
  completed_at timestamptz not null default now()
);

create index if not exists scores_learner_completed_idx
  on public.scores (learner_id, completed_at);

create table if not exists archive.learners (
  archive_id uuid primary key default gen_random_uuid(),
  id uuid not null,
  first_name text not null,
  last_name text not null,
  email text not null,
  gdpr_accepted boolean not null,
  gdpr_accepted_at timestamptz not null,
  created_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create table if not exists archive.scores (
  archive_id uuid primary key default gen_random_uuid(),
  id uuid not null,
  learner_id uuid not null,
  lesson_id integer not null,
  lesson_title text not null,
  section text not null,
  percent integer not null,
  stars integer not null,
  completed_at timestamptz not null,
  archived_at timestamptz not null default now()
);

alter table public.learners enable row level security;
alter table public.scores enable row level security;

create policy "read own learner"
  on public.learners for select
  to authenticated
  using (id = auth.uid() and gdpr_accepted = true);

create policy "create own learner"
  on public.learners for insert
  to authenticated
  with check (id = auth.uid() and gdpr_accepted = true);

create policy "read own scores"
  on public.scores for select
  to authenticated
  using (learner_id = auth.uid());

create policy "add own scores"
  on public.scores for insert
  to authenticated
  with check (
    learner_id = auth.uid()
    and exists (
      select 1 from public.learners
      where id = auth.uid() and gdpr_accepted = true
    )
  );

revoke all on archive.learners from public, anon, authenticated;
revoke all on archive.scores from public, anon, authenticated;

create or replace function public.archive_my_record()
returns void
language plpgsql
security definer
set search_path = public, archive
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  insert into archive.learners (
    id, first_name, last_name, email, gdpr_accepted, gdpr_accepted_at, created_at
  )
  select id, first_name, last_name, email, gdpr_accepted, gdpr_accepted_at, created_at
  from public.learners
  where id = uid;

  insert into archive.scores (
    id, learner_id, lesson_id, lesson_title, section, percent, stars, completed_at
  )
  select id, learner_id, lesson_id, lesson_title, section, percent, stars, completed_at
  from public.scores
  where learner_id = uid;

  delete from public.scores where learner_id = uid;
  delete from public.learners where id = uid;
end;
$$;

revoke all on function public.archive_my_record() from public;
grant execute on function public.archive_my_record() to authenticated;
