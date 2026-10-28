-- A time zone change re-anchors Native Events (spec 0016, ticket #271). A Native Event stores
-- instants, so changing the Household Timezone used to keep its instants and move its date and
-- clock time (an all-day event on two days, a yearly Repeat a day early, 9:00 AM at 6:00 AM).
-- Now the change rewrites starts_at and ends_at to the same wall-clock date and time in the new
-- zone: read on the old zone's clock, placed on the new zone's. It is a trigger so every writer
-- gets it in the same transaction (Settings, the service role, the SQL editor).
--
-- Skipped days, repeat_until and the Profile links are dates and rows, not instants: they stay.
-- Mirrored Calendars forget their last full read, so the next sync run reads each one in full in
-- the new zone. Nothing here writes synced_events: the mirror stays read-only (ADR 0002).

-- The same wall clock in another zone. A time the new zone skips moves forward by the gap
-- (Postgres's own); a time it passes twice is the first of the two: Postgres picks the second, so
-- the instant an hour earlier that still reads the same wall clock wins, as in
-- native_event_occurrences.
create function public.reanchor_instant(p_instant timestamptz, p_from text, p_to text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when ((w.x - interval '1 hour') at time zone p_to) = w.local then w.x - interval '1 hour'
    else w.x
  end
  from (select (p_instant at time zone p_from) as local, ((p_instant at time zone p_from) at time zone p_to) as x) as w
$$;

-- Only the trigger below calls it.
revoke all on function public.reanchor_instant(timestamptz, text, text) from public, anon, authenticated;

create function public.households_timezone_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.native_events as n
  set starts_at = public.reanchor_instant(n.starts_at, old.timezone, new.timezone),
      -- greatest(): a start moved forward out of a skipped hour must not pass its end (native_events' ends_at >= starts_at).
      ends_at = greatest(
        public.reanchor_instant(n.ends_at, old.timezone, new.timezone),
        public.reanchor_instant(n.starts_at, old.timezone, new.timezone)
      )
  where n.household_id = new.id;

  update public.mirrored_calendars as c set last_full_sync_at = null where c.household_id = new.id;
  return null;
end;
$$;

revoke all on function public.households_timezone_changed() from public, anon, authenticated;

create trigger households_timezone_changed
  after update of timezone on public.households
  for each row
  when (old.timezone is distinct from new.timezone)
  execute function public.households_timezone_changed();
