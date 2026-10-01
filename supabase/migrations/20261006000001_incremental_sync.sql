-- Incremental sync and failure handling (issue #8). The mirror stays correct over time:
-- the sync applies Google's changes since the last sync token instead of re-reading a whole
-- calendar, and un-selecting a Mirrored Calendar takes its events away in the same statement.
--
-- Who writes what is unchanged: only the calendar-sync Edge Function (service role) writes
-- synced_events, through replace_synced_events (a full replace) and apply_synced_event_changes
-- (a delta). The Household Account's un-select reaches synced_events only through the trigger.

-- When the calendar was last read in full. Google's delta only reports changed events, so an
-- occurrence of a recurring event that slides into the six-month window never arrives in one:
-- the sync reads each calendar in full once a day to pick those up. Not granted to clients.
alter table public.mirrored_calendars add column last_full_sync_at timestamptz;

-- ---- Un-selecting removes the events at once --------------------------------------------
-- Before the update commits: drop the calendar's Synced Events and forget its sync token and
-- full-sync time, so selecting it again is a full sync on the next run (a stale token would
-- otherwise resume a delta over rows that are no longer there). Runs for every writer.
create or replace function public.mirrored_calendar_selection_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.selected and not new.selected then
    delete from public.synced_events where mirrored_calendar_id = new.id;
  end if;
  new.sync_token := null;
  new.last_full_sync_at := null;
  return new;
end;
$$;

revoke all on function public.mirrored_calendar_selection_changed() from public;

create trigger mirrored_calendars_selection_changed
  before update of selected on public.mirrored_calendars
  for each row
  when (old.selected is distinct from new.selected)
  execute function public.mirrored_calendar_selection_changed();

-- Calendars un-selected before this migration may still hold events and a token.
delete from public.synced_events as s
using public.mirrored_calendars as c
where c.id = s.mirrored_calendar_id and not c.selected;
update public.mirrored_calendars set sync_token = null where not selected and sync_token is not null;

-- ---- Full replace, now recording when it happened ----------------------------------------
drop function public.replace_synced_events(uuid, jsonb, text);

-- Makes a Mirrored Calendar's rows exactly `p_events`, and stores the sync token and the time
-- of the full read, in one transaction: a failure (or a 410 that sends the sync back to a full
-- read) never shows the wall a partly emptied calendar. The calendar row is locked first, so a
-- sync that began before an un-select cannot write its events after it: for a calendar that is
-- no longer selected only an empty array is applied.
create or replace function public.replace_synced_events(
  p_mirrored_calendar_id uuid,
  p_events jsonb,
  p_sync_token text,
  p_synced_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_selected boolean;
  v_count integer := 0;
begin
  select household_id, selected into v_household_id, v_selected
  from public.mirrored_calendars where id = p_mirrored_calendar_id for update;
  if not found then
    raise exception 'unknown mirrored calendar' using errcode = 'P0002';
  end if;
  if not v_selected and jsonb_array_length(p_events) > 0 then
    return 0;
  end if;

  insert into public.synced_events
    (household_id, mirrored_calendar_id, google_event_id, title, description, location, starts_at, ends_at, is_all_day)
  select v_household_id, p_mirrored_calendar_id, e.google_event_id, e.title, e.description, e.location, e.starts_at, e.ends_at, e.is_all_day
  from jsonb_to_recordset(p_events) as e (
    google_event_id text, title text, description text, location text,
    starts_at timestamptz, ends_at timestamptz, is_all_day boolean
  )
  on conflict (mirrored_calendar_id, google_event_id) do update
    set title = excluded.title,
        description = excluded.description,
        location = excluded.location,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        is_all_day = excluded.is_all_day;
  get diagnostics v_count = row_count;

  delete from public.synced_events as s
  where s.mirrored_calendar_id = p_mirrored_calendar_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_events) as e (google_event_id text)
      where e.google_event_id = s.google_event_id
    );

  update public.mirrored_calendars
  set sync_token = p_sync_token,
      last_full_sync_at = case when p_sync_token is null then null else p_synced_at end
  where id = p_mirrored_calendar_id;
  return v_count;
end;
$$;

revoke all on function public.replace_synced_events(uuid, jsonb, text, timestamptz) from public;
revoke execute on function public.replace_synced_events(uuid, jsonb, text, timestamptz) from anon, authenticated;
grant execute on function public.replace_synced_events(uuid, jsonb, text, timestamptz) to service_role;

-- ---- Incremental: apply Google's changes since the sync token ------------------------------
-- Upserts the occurrences that changed or arrived, deletes the ones that were cancelled (or
-- moved out of the window), and stores the new sync token, in one transaction. Same lock and
-- same un-select guard as the full replace: nothing is written to a calendar that is no
-- longer selected.
create or replace function public.apply_synced_event_changes(
  p_mirrored_calendar_id uuid,
  p_upserts jsonb,
  p_deleted_ids text[],
  p_sync_token text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_selected boolean;
  v_count integer := 0;
begin
  select household_id, selected into v_household_id, v_selected
  from public.mirrored_calendars where id = p_mirrored_calendar_id for update;
  if not found then
    raise exception 'unknown mirrored calendar' using errcode = 'P0002';
  end if;
  if not v_selected then
    return 0;
  end if;

  insert into public.synced_events
    (household_id, mirrored_calendar_id, google_event_id, title, description, location, starts_at, ends_at, is_all_day)
  select v_household_id, p_mirrored_calendar_id, e.google_event_id, e.title, e.description, e.location, e.starts_at, e.ends_at, e.is_all_day
  from jsonb_to_recordset(p_upserts) as e (
    google_event_id text, title text, description text, location text,
    starts_at timestamptz, ends_at timestamptz, is_all_day boolean
  )
  on conflict (mirrored_calendar_id, google_event_id) do update
    set title = excluded.title,
        description = excluded.description,
        location = excluded.location,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        is_all_day = excluded.is_all_day;
  get diagnostics v_count = row_count;

  delete from public.synced_events
  where mirrored_calendar_id = p_mirrored_calendar_id
    and google_event_id = any (p_deleted_ids);

  update public.mirrored_calendars set sync_token = p_sync_token where id = p_mirrored_calendar_id;
  return v_count;
end;
$$;

revoke all on function public.apply_synced_event_changes(uuid, jsonb, text[], text) from public;
revoke execute on function public.apply_synced_event_changes(uuid, jsonb, text[], text) from anon, authenticated;
grant execute on function public.apply_synced_event_changes(uuid, jsonb, text[], text) to service_role;
