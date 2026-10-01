-- Cross-device sync: every Household table the wall or the phone reads is published to
-- Supabase Realtime. The frontend refetches the affected queries on any change (no
-- surgical cache edits), so only the fact of a change matters, never its payload.
--
-- Realtime applies each table's row-level security to inserts and updates, so a Household
-- Account or a Device hears only its own Household's rows. A delete is the exception:
-- Realtime applies no policy to it and sends the row's primary key to every subscriber of
-- the table, in any Household. What leaks is an opaque id and the moment of the delete (a
-- Routine unticked, a Device revoked, a sync pruning events), never a column. The frontend
-- treats a delete as a prompt to refetch and reads nothing from it. Closing this entirely
-- would mean Broadcast from the database on private per-Household topics instead of
-- postgres_changes; with one Household per install that is not worth its cost in v1.
--
-- calendar_occurrences is a view and cannot be published; the tables it unions can:
-- synced_events, native_events and native_event_profiles for the events, mirrored_calendars
-- and profiles for the colour each inherits.

alter publication supabase_realtime add table
  public.households,
  public.profiles,
  public.devices,
  public.calendar_accounts,
  public.mirrored_calendars,
  public.synced_events,
  public.native_events,
  public.native_event_profiles,
  public.routines,
  public.routine_completions,
  public.shared_lists,
  public.list_items;
