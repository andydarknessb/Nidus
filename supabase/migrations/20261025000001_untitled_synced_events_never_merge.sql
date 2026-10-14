-- An untitled Synced Event never merges (#244 follow-up). Both providers store an event with no title
-- as '(No title)' (google-adapter.ts, ics-expand.ts), and a calendar shared as free/busy only gives
-- every event that title, so two people's unrelated busy blocks at 9 met the same-event rule of
-- 20261024000001_merge_duplicate_synced_events.sql and read as one. A missing title says nothing about
-- being the same event: a copy whose title is empty or '(No title)' (in any case or spacing) is grouped
-- on its own id as well, so it comes out exactly as a single copy does. Everything else is as
-- 20261024000001 left it.
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
    case when lower(regexp_replace(btrim(e.title), '\s+', ' ', 'g')) in ('', '(no title)') then e.id end as untitled_id,
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
    row_number() over (partition by household_id, title_key, untitled_id, starts_at, ends_at, is_all_day, profile_id order by created_at, id) = 1 as first_of_profile
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
group by household_id, title_key, untitled_id, starts_at, ends_at, is_all_day
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
