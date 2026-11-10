-- The rule for a time that happens twice is named once in SQL (spec 0020, ticket #305). Its other half
-- is the Household clock (supabase/functions/_shared/zoned-time.ts, wallClockMs); tests/household-clock.test.ts
-- checks both against one table. A time the zone skips moves forward by the gap (Postgres's own: the offset
-- from before it). A time it passes twice is the first of the two: Postgres picks the later, so the instant
-- an hour or half an hour earlier that still reads the same wall clock wins.
create function public.wall_clock_instant(p_local timestamp, p_zone text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when ((w.x - interval '1 hour') at time zone p_zone) = p_local then w.x - interval '1 hour'
    when ((w.x - interval '30 minutes') at time zone p_zone) = p_local then w.x - interval '30 minutes'
    else w.x
  end
  from (select (p_local at time zone p_zone) as x) as w
$$;

-- The expansion runs as its caller, so the caller needs execute (as native_event_occurrences has it).
revoke all on function public.wall_clock_instant(timestamp, text) from public;
revoke execute on function public.wall_clock_instant(timestamp, text) from anon;
grant execute on function public.wall_clock_instant(timestamp, text) to authenticated;

-- The same wall clock in another zone (spec 0016, ticket #271), now through wall_clock_instant.
create or replace function public.reanchor_instant(p_instant timestamptz, p_from text, p_to text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select public.wall_clock_instant((p_instant at time zone p_from), p_to)
$$;

-- Same signature, the same view and grants: only the instant of a time of day comes from wall_clock_instant
-- now (it was inline here and in reanchor_instant). The two-year floor and the Repeat rules are as they were.
--
-- ponytail: expansion at read time, two years each way; write rows when a Household has hundreds of daily Repeats.
create or replace function public.native_event_occurrences(e public.native_events)
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
      (now() at time zone h.timezone)::date as today,
      least(e.repeat_until, ((now() at time zone h.timezone)::date + interval '2 years')::date) as last_day
    from public.households as h
    where h.id = e.household_id
  ),
  span as (
    select z.*, greatest(z.d0, (z.today - interval '2 years')::date) as floor_day
    from z
  ),
  days as (
    select s.tz, s.t0, s.d0, s.end_day, c.d
    from span as s
    cross join lateral (
      select s.d0 + g as d
      from generate_series(
        -- Rounded down to a whole number of intervals from the first day, so the days do not move.
        case when s.floor_day > s.d0
          then ((s.floor_day - s.d0) / e.repeat_interval) * e.repeat_interval
          else 0
        end,
        s.last_day - s.d0,
        e.repeat_interval::int
      ) as g
      where e.repeat_every = 'day'
      union all
      select s.d0 + g
      from generate_series(greatest(0, s.floor_day - s.d0), s.last_day - s.d0) as g
      where e.repeat_every = 'week'
        and ((1 << extract(dow from s.d0 + g)::int) & e.repeat_days::int) <> 0
        and (((s.d0 + g) - extract(dow from s.d0 + g)::int) - (s.d0 - extract(dow from s.d0)::int)) / 7 % e.repeat_interval = 0
      union all
      select (s.d0 + n * make_interval(months => e.repeat_interval))::date
      from generate_series(0, (s.last_day - s.d0) / 28 / e.repeat_interval + 1) as n
      where e.repeat_every = 'month'
        and extract(day from s.d0 + n * make_interval(months => e.repeat_interval)) = extract(day from s.d0)
      union all
      select (s.d0 + n * make_interval(years => e.repeat_interval))::date
      from generate_series(0, (s.last_day - s.d0) / 365 / e.repeat_interval + 1) as n
      where e.repeat_every = 'year'
        and extract(month from s.d0 + n * make_interval(years => e.repeat_interval)) = extract(month from s.d0)
        and extract(day from s.d0 + n * make_interval(years => e.repeat_interval)) = extract(day from s.d0)
    ) as c(d)
    where c.d <= s.last_day
      and not exists (
        select 1 from public.native_event_skips as k where k.native_event_id = e.id and k.skipped_on = c.d
      )
  ),
  instants as (
    select
      days.tz,
      days.d,
      days.end_day - days.d0 as whole_days,
      public.wall_clock_instant(days.d + days.t0, days.tz) as x
    from days
  )
  select
    case
      when e.is_all_day then i.d::timestamp at time zone i.tz
      else i.x
    end as starts_at,
    case
      when e.is_all_day then (i.d + i.whole_days)::timestamp at time zone i.tz
      else i.x + (e.ends_at - e.starts_at)
    end as ends_at
  from instants as i
  order by i.d
$$;

-- A replaced function keeps its grants, but say them again so this file reads on its own.
revoke all on function public.native_event_occurrences(public.native_events) from public;
revoke execute on function public.native_event_occurrences(public.native_events) from anon;
grant execute on function public.native_event_occurrences(public.native_events) to authenticated;
