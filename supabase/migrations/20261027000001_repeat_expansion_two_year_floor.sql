-- A day or week Repeat now expands from at most two years back as well as two years ahead
-- (spec 0016, ticket #273). A daily Repeat whose year was mistyped as 0202 used to expand from
-- its first day on every read: about 670,000 rows, 2.2 s for a one-week read on the local stack.
-- The series now starts at the later of the Repeat's first day and two years before the
-- Household's today, the same today its two years ahead are counted from: a day series rounded
-- down to a whole number of intervals from the first day, a week series tested day by day against
-- its weekdays and its interval counted in weeks from the first day's week, so its days never
-- move. Month and year Repeats step cheaply whatever their age and keep their first day.
--
-- Same signature and the same view: only the function body changes. The time of day, the clocks
-- that skip or strike twice, and the skipped days are as they were (spec 0013, ADR 0005).
--
-- ponytail: expansion at read time, two years each way; write rows when a Household has hundreds
-- of daily Repeats.
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

-- A replaced function keeps its grants, but say them again so this file reads on its own.
revoke all on function public.native_event_occurrences(public.native_events) from public;
revoke execute on function public.native_event_occurrences(public.native_events) from anon;
grant execute on function public.native_event_occurrences(public.native_events) to authenticated;
