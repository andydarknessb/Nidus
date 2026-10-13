-- Repeats (spec 0013, ticket #237; ADR 0005). A Native Event can repeat: every N days, every N
-- weeks on chosen weekdays, every N months on the same date, every N years on the same date,
-- until a Household Date or forever. The Repeat is four columns on the Native Event, and the
-- calendar_occurrences view expands it into Occurrences as it is read, from the event's first
-- day to the earlier of repeat_until and two years after the Household's clock today. No job
-- runs and no row is written for a day that has not come, so every reader of the view (the Wall,
-- the phone, the push reminders) sees the same Occurrences without knowing a Repeat exists.
--
-- A day a person deleted, or changed on its own, is a row in native_event_skips that the view
-- leaves out. Deleting the event deletes its skips. A Device writes skips as it writes Native
-- Events (CONTEXT.md: Device); both principals are held to their own Household.
--
-- Nothing here touches synced_events: the mirror stays read-only (ADR 0002) and a Repeat is
-- columns with four shapes, not an RRULE.

alter table public.native_events
  add column repeat_every text check (repeat_every in ('day', 'week', 'month', 'year')),
  add column repeat_interval smallint not null default 1 check (repeat_interval between 1 and 99),
  -- Weekday bitmask as on a Routine, Sunday = bit 0; required for a week and null otherwise.
  add column repeat_days smallint check (repeat_days between 1 and 127),
  -- A Household Date: the last day an Occurrence may land on. Null for forever.
  add column repeat_until date,
  -- "is not distinct from" so a null repeat_every still forbids days.
  add constraint native_events_repeat_shape check (
    (repeat_every is not distinct from 'week') = (repeat_days is not null)
    and (repeat_every is not null or (repeat_interval = 1 and repeat_until is null))
  );

comment on column public.native_events.repeat_every is 'The Repeat''s shape (day, week, month, year); null when the event does not repeat.';

grant insert (repeat_every, repeat_interval, repeat_days, repeat_until) on public.native_events to authenticated;
grant update (repeat_every, repeat_interval, repeat_days, repeat_until) on public.native_events to authenticated;

create table public.native_event_skips (
  native_event_id uuid not null,
  household_id uuid not null,
  -- The Household Date of the Occurrence left out.
  skipped_on date not null,
  primary key (native_event_id, skipped_on),
  -- A composite reference, as native_event_profiles has: a skip cannot cross Households.
  foreign key (native_event_id, household_id) references public.native_events (id, household_id) on delete cascade
);

comment on table public.native_event_skips is 'A day of a Repeat that is not an Occurrence: deleted, or changed on its own.';

alter table public.native_event_skips enable row level security;

revoke all on public.native_event_skips from anon, authenticated;
grant select, delete on public.native_event_skips to authenticated;
grant insert (native_event_id, household_id, skipped_on) on public.native_event_skips to authenticated;

create policy "principals read their household's native event skips"
  on public.native_event_skips for select to authenticated
  using (household_id = public.current_household_id());

create policy "principals skip days of their household's native events"
  on public.native_event_skips for insert to authenticated
  with check (household_id = public.current_household_id());

create policy "principals unskip days of their household's native events"
  on public.native_event_skips for delete to authenticated
  using (household_id = public.current_household_id());

alter publication supabase_realtime add table public.native_event_skips;

-- ---- One atomic save: the event, its Repeat, its Profiles and, optionally, a skip ----------
-- As before, plus the Repeat and `p_skip_event`/`p_skip_on`: when a skip is asked for it is
-- inserted (the event must be the caller's Household's) before the write, in the same
-- transaction, so "this one" never leaves a day both skipped and unsaved, or saved twice.
drop function public.save_native_event(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid[]);

create function public.save_native_event(
  p_id uuid,
  p_title text,
  p_location text,
  p_notes text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_is_all_day boolean,
  p_profile_ids uuid[],
  p_repeat_every text default null,
  p_repeat_interval smallint default 1,
  p_repeat_days smallint default null,
  p_repeat_until date default null,
  p_skip_event uuid default null,
  p_skip_on date default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_household_id uuid := public.current_household_id();
  v_timezone text;
begin
  if v_household_id is null then
    raise exception 'not a principal of a household' using errcode = '42501';
  end if;

  select h.timezone into v_timezone from public.households as h where h.id = v_household_id;

  if p_repeat_every = 'week' and p_repeat_days is null then
    raise exception 'a weekly repeat needs at least one day' using errcode = '23514';
  end if;
  if p_repeat_until is not null and p_repeat_until < (p_starts_at at time zone v_timezone)::date then
    raise exception 'the repeat ends before it starts' using errcode = '23514';
  end if;

  if p_skip_event is not null then
    if p_skip_on is null or not exists (
      select 1 from public.native_events as n where n.id = p_skip_event and n.household_id = v_household_id
    ) then
      raise exception 'unknown native event' using errcode = 'P0002';
    end if;
    insert into public.native_event_skips (native_event_id, household_id, skipped_on)
    values (p_skip_event, v_household_id, p_skip_on)
    on conflict do nothing;
  end if;

  if v_id is null then
    insert into public.native_events (
      household_id, title, location, notes, starts_at, ends_at, is_all_day,
      repeat_every, repeat_interval, repeat_days, repeat_until
    )
    values (
      v_household_id, p_title, p_location, p_notes, p_starts_at, p_ends_at, p_is_all_day,
      p_repeat_every, coalesce(p_repeat_interval, 1), p_repeat_days, p_repeat_until
    )
    returning id into v_id;
  else
    update public.native_events
    set title = p_title, location = p_location, notes = p_notes,
        starts_at = p_starts_at, ends_at = p_ends_at, is_all_day = p_is_all_day,
        repeat_every = p_repeat_every, repeat_interval = coalesce(p_repeat_interval, 1),
        repeat_days = p_repeat_days, repeat_until = p_repeat_until
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

revoke all on function public.save_native_event(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid[], text, smallint, smallint, date, uuid, date) from public;
-- Supabase grants execute on new functions to anon directly; revoking from public does not remove it.
revoke execute on function public.save_native_event(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid[], text, smallint, smallint, date, uuid, date) from anon;
grant execute on function public.save_native_event(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid[], text, smallint, smallint, date, uuid, date) to authenticated;

-- ---- The Occurrences of a Repeat ---------------------------------------------------------
-- One row per day the Repeat lands on, from the event's first Household Date to the earlier of
-- repeat_until and two years after the Household's clock today, less the skipped days. The time
-- of day is the event's start read in the Household Timezone, the length is ends_at - starts_at
-- in instants (an all-day event keeps whole days). Weeks start on Sunday and the interval counts
-- weeks from the first day's week. A month or a year without the date (the 31st, Feb 29) is
-- skipped, not moved. A time the clocks skip moves forward by the gap (Postgres's own) and a
-- time that happens twice is the first of the two: Postgres picks the second, so the instant an
-- hour earlier that still reads the same wall clock wins. Nothing here reads the machine's zone.
-- ponytail: expansion at read time; write rows when a Household has hundreds of daily Repeats.
create function public.native_event_occurrences(e public.native_events)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with z as (
    select
      h.timezone as tz,
      (e.starts_at at time zone h.timezone)::date as d0,
      (e.starts_at at time zone h.timezone)::time as t0,
      (e.ends_at at time zone h.timezone)::date as end_day,
      least(e.repeat_until, ((now() at time zone h.timezone)::date + interval '2 years')::date) as last_day
    from public.households as h
    where h.id = e.household_id
  ),
  days as (
    select z.tz, z.t0, z.d0, z.end_day, c.d
    from z
    cross join lateral (
      select z.d0 + g as d
      from generate_series(0, z.last_day - z.d0, e.repeat_interval::int) as g
      where e.repeat_every = 'day'
      union all
      select z.d0 + g
      from generate_series(0, z.last_day - z.d0) as g
      where e.repeat_every = 'week'
        and ((1 << extract(dow from z.d0 + g)::int) & e.repeat_days::int) <> 0
        and (((z.d0 + g) - extract(dow from z.d0 + g)::int) - (z.d0 - extract(dow from z.d0)::int)) / 7 % e.repeat_interval = 0
      union all
      select (z.d0 + n * make_interval(months => e.repeat_interval))::date
      from generate_series(0, (z.last_day - z.d0) / 28 / e.repeat_interval + 1) as n
      where e.repeat_every = 'month'
        and extract(day from z.d0 + n * make_interval(months => e.repeat_interval)) = extract(day from z.d0)
      union all
      select (z.d0 + n * make_interval(years => e.repeat_interval))::date
      from generate_series(0, (z.last_day - z.d0) / 365 / e.repeat_interval + 1) as n
      where e.repeat_every = 'year'
        and extract(month from z.d0 + n * make_interval(years => e.repeat_interval)) = extract(month from z.d0)
        and extract(day from z.d0 + n * make_interval(years => e.repeat_interval)) = extract(day from z.d0)
    ) as c(d)
    where c.d <= z.last_day
      and not exists (
        select 1 from public.native_event_skips as s where s.native_event_id = e.id and s.skipped_on = c.d
      )
  ),
  instants as (
    select
      days.tz,
      days.d,
      days.end_day - days.d0 as whole_days,
      (days.d + days.t0) at time zone days.tz as x,
      days.d + days.t0 as local
    from days
  )
  select
    case
      when e.is_all_day then i.d::timestamp at time zone i.tz
      when ((i.x - interval '1 hour') at time zone i.tz) = i.local then i.x - interval '1 hour'
      else i.x
    end as starts_at,
    case
      when e.is_all_day then (i.d + i.whole_days)::timestamp at time zone i.tz
      when ((i.x - interval '1 hour') at time zone i.tz) = i.local then i.x - interval '1 hour' + (e.ends_at - e.starts_at)
      else i.x + (e.ends_at - e.starts_at)
    end as ends_at
  from instants as i
  order by i.d
$$;

-- ---- calendar_occurrences: one row per Occurrence -----------------------------------------
-- Recreated, not replaced: it gains columns. `event_id` is a Native Event's own id (null for a
-- Synced Event); an event with no Repeat keeps id = event_id, an Occurrence of a Repeat has an
-- id of its own, the same on every read (the start is taken in UTC so no session setting moves
-- it). Code that edits or deletes a Native Event uses event_id, never id.
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
  case when coalesce(c.color, p.color) is null then '{}'::text[] else array[coalesce(c.color, p.color)] end as colors,
  null::uuid as event_id,
  null::text as repeat_every,
  null::smallint as repeat_interval,
  null::smallint as repeat_days,
  null::date as repeat_until
from public.synced_events as e
join public.mirrored_calendars as c on c.id = e.mirrored_calendar_id and c.selected
left join public.profiles as p on p.id = c.profile_id
union all
select
  'native'::text as source,
  case when n.repeat_every is null then n.id else md5(n.id::text || (o.starts_at at time zone 'UTC')::text)::uuid end as id,
  n.household_id,
  null::uuid as calendar_id,
  'Nidus'::text as calendar_name,
  n.title,
  n.notes as description,
  n.location,
  o.starts_at,
  o.ends_at,
  n.is_all_day,
  a.profile_ids[1] as profile_id,
  a.colors[1] as color,
  coalesce(a.profile_ids, '{}'::uuid[]) as profile_ids,
  coalesce(a.colors, '{}'::text[]) as colors,
  n.id as event_id,
  n.repeat_every,
  n.repeat_interval,
  n.repeat_days,
  n.repeat_until
from public.native_events as n
cross join lateral (
  select n.starts_at, n.ends_at where n.repeat_every is null
  union all
  select r.starts_at, r.ends_at from public.native_event_occurrences(n) as r
) as o
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
