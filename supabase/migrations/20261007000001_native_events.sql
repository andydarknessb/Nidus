-- Native Events (issue #10). A one-off event created in Nidus that lives only in Nidus and is
-- never pushed to any provider (ADR 0002). Attributed to zero or more Profiles; zero rows in
-- native_event_profiles means the whole Household. No recurrence in v1.
--
-- Who writes what: unlike every other table but list items and Routine Completions, a Device
-- may insert, update and delete these (CONTEXT.md: Device). Both principals are held to their
-- own Household by current_household_id(); there is deliberately no is_household_account()
-- clause. Synced Events stay untouchable: nothing here reaches synced_events.

create table public.native_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200 and title ~ '\S'),
  location text check (location is null or char_length(location) <= 500),
  notes text check (notes is null or char_length(notes) <= 5000),
  starts_at timestamptz not null,
  -- For an all-day event, the midnight after its last day (Household Timezone), as for a Synced Event.
  ends_at timestamptz not null check (ends_at >= starts_at),
  is_all_day boolean not null default false,
  created_at timestamptz not null default now(),
  -- The composite key native_event_profiles points at, so a join row cannot cross Households.
  unique (id, household_id)
);

comment on table public.native_events is 'An event created in Nidus that exists only in Nidus (Native Event). Written by a Household Account or a Device.';

create index native_events_household_starts_idx on public.native_events (household_id, starts_at);

create table public.native_event_profiles (
  native_event_id uuid not null,
  profile_id uuid not null,
  household_id uuid not null,
  primary key (native_event_id, profile_id),
  -- Composite references: an event can only name its own Household's Profiles. Deleting a
  -- Profile deletes its join rows and leaves the event, which then reads as household-wide.
  foreign key (native_event_id, household_id) references public.native_events (id, household_id) on delete cascade,
  foreign key (profile_id, household_id) references public.profiles (id, household_id) on delete cascade
);

comment on table public.native_event_profiles is 'Which Profiles a Native Event is attributed to. No rows means the whole Household.';

create index native_event_profiles_profile_idx on public.native_event_profiles (profile_id);

alter table public.native_events enable row level security;
alter table public.native_event_profiles enable row level security;

-- Column grants keep household_id immutable. A join row is only ever inserted or deleted.
revoke all on public.native_events from anon, authenticated;
grant select, delete on public.native_events to authenticated;
grant insert (household_id, title, location, notes, starts_at, ends_at, is_all_day) on public.native_events to authenticated;
grant update (title, location, notes, starts_at, ends_at, is_all_day) on public.native_events to authenticated;

revoke all on public.native_event_profiles from anon, authenticated;
grant select, delete on public.native_event_profiles to authenticated;
grant insert (native_event_id, profile_id, household_id) on public.native_event_profiles to authenticated;

create policy "principals read their household's native events"
  on public.native_events for select to authenticated
  using (household_id = public.current_household_id());

create policy "principals create native events in their household"
  on public.native_events for insert to authenticated
  with check (household_id = public.current_household_id());

create policy "principals edit their household's native events"
  on public.native_events for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy "principals delete their household's native events"
  on public.native_events for delete to authenticated
  using (household_id = public.current_household_id());

create policy "principals read their household's native event profiles"
  on public.native_event_profiles for select to authenticated
  using (household_id = public.current_household_id());

create policy "principals attribute their household's native events"
  on public.native_event_profiles for insert to authenticated
  with check (household_id = public.current_household_id());

create policy "principals unattribute their household's native events"
  on public.native_event_profiles for delete to authenticated
  using (household_id = public.current_household_id());

-- ---- One atomic save: the event and its Profiles ----------------------------------------
-- Inserts (p_id null) or updates a Native Event and makes its Profiles exactly
-- `p_profile_ids`, in one transaction, so a refused Profile never leaves an event behind
-- attributed to the whole Household. security invoker: the policies and column grants above
-- stay the one authority on what the caller may write. Returns the event's id.
create or replace function public.save_native_event(
  p_id uuid,
  p_title text,
  p_location text,
  p_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_is_all_day boolean,
  p_profile_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_household_id uuid := public.current_household_id();
begin
  if v_household_id is null then
    raise exception 'not a principal of a household' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.native_events (household_id, title, location, notes, starts_at, ends_at, is_all_day)
    values (v_household_id, p_title, p_location, p_notes, p_starts_at, p_ends_at, p_is_all_day)
    returning id into v_id;
  else
    update public.native_events
    set title = p_title, location = p_location, notes = p_notes,
        starts_at = p_starts_at, ends_at = p_ends_at, is_all_day = p_is_all_day
    where id = v_id;
    if not found then
      raise exception 'unknown native event' using errcode = 'P0002';
    end if;
  end if;

  delete from public.native_event_profiles as j
  where j.native_event_id = v_id
    and not (j.profile_id = any (coalesce(p_profile_ids, '{}')));

  insert into public.native_event_profiles (native_event_id, profile_id, household_id)
  select v_id, p, v_household_id from unnest(coalesce(p_profile_ids, '{}')) as p
  on conflict do nothing;

  return v_id;
end;
$$;

revoke all on function public.save_native_event(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid[]) from public;
-- Supabase grants execute on new functions to anon directly; revoking from public does not remove it.
revoke execute on function public.save_native_event(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid[]) from anon;
grant execute on function public.save_native_event(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid[]) to authenticated;

-- ---- calendar_occurrences gains Native Events ------------------------------------------
-- Recreated, not replaced: it gains columns in the middle and calendar_id may now be null.
-- profile_ids and colors are the attribution of an occurrence in the Profiles' own order
-- (empty for the whole Household); profile_id and color stay the first of each, which is
-- all a Synced Event has. A Native Event's colours are its Profiles' own: with none, color is
-- null and the wall draws the neutral whole-Household colour, as for a Synced Event with none.
drop view public.calendar_occurrences;

create view public.calendar_occurrences
with (security_invoker = true)
as
select
  'synced'::text as source,
  e.id,
  e.household_id,
  e.mirrored_calendar_id as calendar_id,
  c.name as calendar_name,
  e.title,
  e.description,
  e.location,
  e.starts_at,
  e.ends_at,
  e.is_all_day,
  c.profile_id,
  coalesce(c.color, p.color) as color,
  case when c.profile_id is null then '{}'::uuid[] else array[c.profile_id] end as profile_ids,
  case when coalesce(c.color, p.color) is null then '{}'::text[] else array[coalesce(c.color, p.color)] end as colors
from public.synced_events as e
join public.mirrored_calendars as c on c.id = e.mirrored_calendar_id and c.selected
left join public.profiles as p on p.id = c.profile_id
union all
select
  'native'::text as source,
  n.id,
  n.household_id,
  null::uuid as calendar_id,
  'Nidus'::text as calendar_name,
  n.title,
  n.notes as description,
  n.location,
  n.starts_at,
  n.ends_at,
  n.is_all_day,
  a.profile_ids[1] as profile_id,
  a.colors[1] as color,
  coalesce(a.profile_ids, '{}'::uuid[]) as profile_ids,
  coalesce(a.colors, '{}'::text[]) as colors
from public.native_events as n
left join lateral (
  select
    array_agg(p.id order by p.sort_order, p.created_at, p.id) as profile_ids,
    array_agg(p.color order by p.sort_order, p.created_at, p.id) as colors
  from public.native_event_profiles as j
  join public.profiles as p on p.id = j.profile_id
  where j.native_event_id = n.id
) as a on true;

revoke all on public.calendar_occurrences from anon, authenticated;
grant select on public.calendar_occurrences to authenticated;
