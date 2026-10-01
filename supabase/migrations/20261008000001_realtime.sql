-- Cross-device sync: every Household table the wall or the phone reads is published to
-- Supabase Realtime. The frontend refetches the affected queries on any change (no
-- surgical cache edits), so only the fact of a change matters, never its payload.
--
-- Realtime applies each table's row-level security to inserts and updates, so a Household
-- Account or a Device hears only its own Household's rows. A delete carries just the key
-- and no Household, so Realtime cannot filter it by policy; the frontend treats it as a
-- prompt to refetch and learns nothing from it.
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
