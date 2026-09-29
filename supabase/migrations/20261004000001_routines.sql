-- Routines (issue #11). A habit owned by one Profile on a days-of-week schedule,
-- and the Routine Completions that record it done on a Household date. The
-- Household Account manages Routines from the phone; a Household Account or a
-- Device (the wall) ticks and unticks them.
--
-- "Checked" is derived: a Routine is checked today when a completion exists for
-- today's Household date. Nothing resets at midnight and no job runs; yesterday's
-- completions simply stop matching, and stay as history.

-- Lets routines.profile_id prove the Profile is the Household's own.
alter table public.profiles add constraint profiles_id_household_id_key unique (id, household_id);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  profile_id uuid not null,
  title text not null check (char_length(title) between 1 and 100 and title ~ '\S'),
  -- Bit n set: scheduled on weekday n, Sunday = 0 (the order of JS Date#getDay).
  -- At least one day, or the Routine could never show.
  days_of_week smallint not null check (days_of_week between 1 and 127),
  sort_order integer not null default 0,
  -- Set when archived: off the wall and the phone's list, kept with its history.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  -- A composite reference, so a Routine cannot point at another Household's Profile.
  -- Deleting the Profile deletes its Routines (and, below, their completions).
  constraint routines_profile_fkey
    foreign key (profile_id, household_id)
    references public.profiles (id, household_id)
    on delete cascade
);

comment on table public.routines is 'A habit owned by one Profile on a days-of-week schedule (Routine).';
comment on column public.routines.days_of_week is 'Weekday bitmask, Sunday = bit 0.';

create index routines_household_id_idx on public.routines (household_id, sort_order);
create index routines_profile_id_idx on public.routines (profile_id);

create table public.routine_completions (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines (id) on delete cascade,
  -- The Household date it was done on (Household Timezone), never the machine's.
  completed_on date not null,
  completed_at timestamptz not null default now(),
  -- One completion per Routine per day: a second tick is a no-op.
  unique (routine_id, completed_on)
);

comment on table public.routine_completions is 'A record that a Routine was done on a Household date (Routine Completion). Kept after the midnight reset.';

-- Only today's Household date may be ticked. The client names the date, and the
-- Household Timezone lives here, so a tablet with a wrong clock cannot write into
-- another day. Untick is a delete by (routine, date) and needs no such check.
create or replace function public.routine_completions_require_today()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today date;
begin
  select (now() at time zone h.timezone)::date
  into today
  from public.routines as r
  join public.households as h on h.id = r.household_id
  where r.id = new.routine_id;

  -- An unknown or invisible Routine: row-level security and the foreign key answer for it.
  if today is not null and new.completed_on <> today then
    raise exception 'a Routine can only be completed for the Household''s today' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger routine_completions_require_today
  before insert on public.routine_completions
  for each row execute function public.routine_completions_require_today();

alter table public.routines enable row level security;
alter table public.routine_completions enable row level security;

-- Column grants keep household_id and profile_id immutable. A Device runs as
-- authenticated too, so it holds these grants; the is_household_account() clause
-- in the write policies is what refuses it. There is no delete grant: Routines are
-- archived, and only a Profile or Household delete removes them (by cascade).
revoke all on public.routines from anon, authenticated;
grant select on public.routines to authenticated;
grant insert (household_id, profile_id, title, days_of_week, sort_order) on public.routines to authenticated;
grant update (title, days_of_week, sort_order, archived_at) on public.routines to authenticated;

-- A tick and an untick (of today) are all a Device may write; a completion is never edited.
revoke all on public.routine_completions from anon, authenticated;
grant select, delete on public.routine_completions to authenticated;
grant insert (routine_id, completed_on) on public.routine_completions to authenticated;

create policy "principals read their household's routines"
  on public.routines
  for select
  to authenticated
  using (household_id = public.current_household_id());

create policy "household account creates routines"
  on public.routines
  for insert
  to authenticated
  with check (household_id = public.current_household_id() and public.is_household_account());

create policy "household account edits, archives and reorders routines"
  on public.routines
  for update
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account())
  with check (household_id = public.current_household_id() and public.is_household_account());

-- Completions are reached through their Routine, so the Household check is the Routine's.
create policy "principals read their household's completions"
  on public.routine_completions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.routines as r
      where r.id = routine_completions.routine_id and r.household_id = public.current_household_id()
    )
  );

create policy "principals tick their household's routines"
  on public.routine_completions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.routines as r
      where r.id = routine_completions.routine_id
        and r.household_id = public.current_household_id()
        and r.archived_at is null
    )
  );

-- An untick removes today's completion only. Earlier days are history that outlives the
-- midnight reset, so a tablet still showing yesterday just after midnight cannot erase it.
create policy "principals untick their household's routines today"
  on public.routine_completions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.routines as r
      join public.households as h on h.id = r.household_id
      where r.id = routine_completions.routine_id
        and r.household_id = public.current_household_id()
        and routine_completions.completed_on = (now() at time zone h.timezone)::date
    )
  );

-- Atomic reorder, same shape as reorder_profiles (issue #25): every position in one
-- statement, and a named row the caller may not move rolls the whole reorder back.
-- security invoker, so the policies above stay the one authority on who may move a row.
create or replace function public.reorder_routines(ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.routines as r
  set sort_order = ordered.position - 1
  from unnest(ids) with ordinality as ordered (id, position)
  where r.id = ordered.id;

  get diagnostics moved = row_count;
  if moved < coalesce(cardinality(ids), 0) then
    raise exception 'reorder names a routine that cannot be moved' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.reorder_routines(uuid[]) from public;
-- Supabase grants execute on new functions to anon directly; revoking from public does not remove it.
revoke execute on function public.reorder_routines(uuid[]) from anon;
grant execute on function public.reorder_routines(uuid[]) to authenticated;
