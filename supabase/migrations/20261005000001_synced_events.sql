-- Synced Events, the occurrences view and the five-minute sync schedule (issue #7).
-- A Synced Event is one occurrence mirrored read-only from a Mirrored Calendar: recurring
-- events arrive already expanded, all-day events carry Household-Timezone midnights.
--
-- Who writes what: only the calendar-sync Edge Function (service role), through
-- replace_synced_events, ever writes this table. Every client (Household Account, Device)
-- can only read it, and only its own Household's rows.

-- The composite key the foreign key below points at.
alter table public.mirrored_calendars add constraint mirrored_calendars_id_household_key unique (id, household_id);

create table public.synced_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  mirrored_calendar_id uuid not null,
  google_event_id text not null check (char_length(google_event_id) between 1 and 1024),
  title text not null,
  description text,
  location text,
  starts_at timestamptz not null,
  -- For an all-day event, the midnight after its last day.
  ends_at timestamptz not null check (ends_at >= starts_at),
  is_all_day boolean not null default false,
  created_at timestamptz not null default now(),
  unique (mirrored_calendar_id, google_event_id),
  -- A Synced Event can only sit in a Mirrored Calendar of its own Household.
  foreign key (mirrored_calendar_id, household_id)
    references public.mirrored_calendars (id, household_id) on delete cascade
);

comment on table public.synced_events is 'One occurrence mirrored read-only from a Mirrored Calendar (Synced Event). Written only by the sync function.';

create index synced_events_household_starts_idx on public.synced_events (household_id, starts_at);

alter table public.synced_events enable row level security;

-- Read-only for every client: no insert, update or delete grant exists for anon or authenticated.
revoke all on public.synced_events from anon, authenticated;
grant select on public.synced_events to authenticated;

create policy "principals read their household's synced events"
  on public.synced_events
  for select
  to authenticated
  using (household_id = public.current_household_id());

-- ---- calendar_occurrences ------------------------------------------------------------
-- What the wall reads: every occurrence with its source, the name of its calendar and the
-- attribution it inherits. Only selected Mirrored Calendars show, so un-selecting one takes
-- its events off the wall at once. Colour is the calendar's own override, else its Profile's;
-- both null means a whole-Household event. Native Events will union in here with source 'native'.
-- security_invoker: the caller's RLS on the underlying tables applies, so a Household Account
-- or Device sees only its own Household.
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
  coalesce(c.color, p.color) as color
from public.synced_events as e
join public.mirrored_calendars as c on c.id = e.mirrored_calendar_id and c.selected
left join public.profiles as p on p.id = c.profile_id;

revoke all on public.calendar_occurrences from anon, authenticated;
grant select on public.calendar_occurrences to authenticated;

-- ---- Service-role only: the sync's one write ------------------------------------------
-- Makes a Mirrored Calendar's rows exactly `p_events` and stores the sync token, in one
-- transaction: a failure leaves the previous mirror untouched, and an occurrence that has
-- gone (cancelled, moved out of the window) is deleted with the rest. An empty array clears
-- the calendar, which is how un-selecting one removes its events.
create or replace function public.replace_synced_events(
  p_mirrored_calendar_id uuid,
  p_events jsonb,
  p_sync_token text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_count integer;
begin
  select household_id into v_household_id from public.mirrored_calendars where id = p_mirrored_calendar_id;
  if not found then
    raise exception 'unknown mirrored calendar' using errcode = 'P0002';
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

  update public.mirrored_calendars set sync_token = p_sync_token where id = p_mirrored_calendar_id;
  return v_count;
end;
$$;

revoke all on function public.replace_synced_events(uuid, jsonb, text) from public;
revoke execute on function public.replace_synced_events(uuid, jsonb, text) from anon, authenticated;
grant execute on function public.replace_synced_events(uuid, jsonb, text) to service_role;

-- ---- The five-minute schedule ---------------------------------------------------------
-- pg_cron calls invoke_calendar_sync, which posts to the calendar-sync Edge Function with a
-- shared secret. The function's URL and that secret are Vault secrets (calendar_sync_url,
-- calendar_sync_secret), set per environment (docs/calendar-sync.md); until both exist the
-- job does nothing, so a fresh local stack is not broken by the schedule.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.invoke_calendar_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'calendar_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'calendar_sync_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.invoke_calendar_sync() from public;
revoke execute on function public.invoke_calendar_sync() from anon, authenticated;

-- cron.schedule with a name replaces a job of that name, so re-running this is harmless.
select cron.schedule('calendar-sync', '*/5 * * * *', 'select public.invoke_calendar_sync()');
