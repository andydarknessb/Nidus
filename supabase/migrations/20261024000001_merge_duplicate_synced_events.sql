-- The same event in two Mirrored Calendars (an invite sent to Mom and Dad, a shared calendar,
-- two hand-typed copies) reads as one Occurrence naming everyone whose calendar holds a copy (#244).
-- Only the synced branch of calendar_occurrences changes; the native branch, the column list and
-- order, and the grants are as 20261023000001_native_event_repeats.sql left them.
--
-- Same event: the same Household, the same title (case-insensitive, trimmed, inner whitespace
-- collapsed), starts_at, ends_at and is_all_day. Native Events never merge, so they stay in the
-- other branch of the union.
--
-- The representative copy is the oldest one, by created_at then id. The sync's upserts never touch
-- created_at or id, so the merged id (and the reminder key built from it) holds while that copy exists,
-- and a copy that arrives later, whatever id it draws, never takes over. (Ordering by id alone would
-- let a late copy with a lower random uuid move it.) Its id, calendar, title, Profile and colour are the
-- Occurrence's; description and location are the first non-empty value in the same order, never joined.
-- profile_ids is the distinct Profiles sorted by id, and colors is one colour per Profile in that same
-- order (the first copy's of that Profile), none when the Occurrence is whole-Household. A single copy
-- comes out as it went in.
create or replace view public.calendar_occurrences
with (security_invoker = true)
as
with copies as (
  select
    e.id,
    e.created_at,
    e.household_id,
    e.mirrored_calendar_id,
    c.name as calendar_name,
    e.title,
    lower(regexp_replace(btrim(e.title), '\s+', ' ', 'g')) as title_key,
    e.description,
    e.location,
    e.starts_at,
    e.ends_at,
    e.is_all_day,
    c.profile_id,
    coalesce(c.color, p.color) as color
  from public.synced_events as e
  join public.mirrored_calendars as c on c.id = e.mirrored_calendar_id and c.selected
  left join public.profiles as p on p.id = c.profile_id
), ranked as (
  select
    copies.*,
    row_number() over (partition by household_id, title_key, starts_at, ends_at, is_all_day, profile_id order by created_at, id) = 1 as first_of_profile
  from copies
)
select
  'synced'::text as source,
  (array_agg(id order by created_at, id))[1] as id,
  household_id,
  (array_agg(mirrored_calendar_id order by created_at, id))[1] as calendar_id,
  string_agg(distinct calendar_name, ', ' order by calendar_name) as calendar_name,
  (array_agg(title order by created_at, id))[1] as title,
  coalesce(
    (array_agg(description order by created_at, id) filter (where nullif(btrim(description), '') is not null))[1],
    (array_agg(description order by created_at, id))[1]
  ) as description,
  coalesce(
    (array_agg(location order by created_at, id) filter (where nullif(btrim(location), '') is not null))[1],
    (array_agg(location order by created_at, id))[1]
  ) as location,
  starts_at,
  ends_at,
  is_all_day,
  case when bool_or(profile_id is null) then null else (array_agg(profile_id order by created_at, id))[1] end as profile_id,
  (array_agg(color order by created_at, id))[1] as color,
  case
    when bool_or(profile_id is null) then '{}'::uuid[]
    else array_agg(profile_id order by profile_id) filter (where first_of_profile)
  end as profile_ids,
  case
    -- Whole-Household: none for a merge; one copy keeps the colour its calendar gave it.
    when bool_or(profile_id is null) then
      case when count(*) = 1 then coalesce(array_agg(color) filter (where color is not null), '{}'::text[]) else '{}'::text[] end
    -- A Profile's colour is never null (profiles.color is not null), so this lines up with profile_ids.
    else array_agg(color order by profile_id) filter (where first_of_profile)
  end as colors,
  null::uuid as event_id,
  null::text as repeat_every,
  null::smallint as repeat_interval,
  null::smallint as repeat_days,
  null::date as repeat_until
from ranked
group by household_id, title_key, starts_at, ends_at, is_all_day
union all
select
  'native'::text as source,
  case when n.repeat_every is null then n.id else md5(n.id::text || to_char(o.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'))::uuid end as id,
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
  -- The guard keeps the function from being called at all for an event with no Repeat.
  select r.starts_at, r.ends_at from public.native_event_occurrences(n) as r where n.repeat_every is not null
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
