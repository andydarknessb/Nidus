-- Profiles (issue #4). A person in the Household, used for attribution and
-- colour-coding; no credentials. The Household Account manages them from the
-- phone; a Device (the wall) only reads them. The colour is the palette every
-- later feature (events, Routines) draws from.

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100 and name ~ '\S'),
  -- A #rrggbb hex. Which hexes are offered is the app's fixed high-contrast
  -- palette (src/lib/profiles.ts), tested for WCAG AAA on Zinc-950; the column
  -- only guards the shape so the palette can change without a migration.
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~* '^https://')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'A person in the Household, for attribution and colour-coding (Profile). Has no credentials.';

create index profiles_household_id_idx on public.profiles (household_id, sort_order);

alter table public.profiles enable row level security;

-- household_id is set on insert and never moves; a Device gets no write grant at all.
revoke all on public.profiles from anon, authenticated;
grant select, delete on public.profiles to authenticated;
grant insert (household_id, name, color, avatar_url, sort_order) on public.profiles to authenticated;
grant update (name, color, avatar_url, sort_order) on public.profiles to authenticated;

create policy "principals read their household's profiles"
  on public.profiles
  for select
  to authenticated
  using (household_id = public.current_household_id());

create policy "household account creates profiles"
  on public.profiles
  for insert
  to authenticated
  with check (household_id = public.current_household_id() and public.is_household_account());

create policy "household account edits and reorders profiles"
  on public.profiles
  for update
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account())
  with check (household_id = public.current_household_id() and public.is_household_account());

create policy "household account deletes profiles"
  on public.profiles
  for delete
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account());

-- Atomic reorder, same shape as reorder_lists (issue #25): every position in one
-- statement, and a named row the caller may not move rolls the whole reorder back.
-- security invoker, so the policies above stay the one authority on who may move a row.
create or replace function public.reorder_profiles(ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.profiles as p
  set sort_order = ordered.position - 1
  from unnest(ids) with ordinality as ordered (id, position)
  where p.id = ordered.id;

  get diagnostics moved = row_count;
  if moved < coalesce(cardinality(ids), 0) then
    raise exception 'reorder names a profile that cannot be moved' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.reorder_profiles(uuid[]) from public;
-- Supabase grants execute on new functions to anon directly; revoking from public does not remove it.
revoke execute on function public.reorder_profiles(uuid[]) from anon;
grant execute on function public.reorder_profiles(uuid[]) to authenticated;
