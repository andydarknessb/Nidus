-- Routine time of day (issue #55). A Routine may belong to the morning, the afternoon or the
-- evening, so the Wall can list a Profile's Routines in the order the day happens. Null means
-- any time, which is what every existing Routine stays.
--
-- Who writes what: unchanged. The Household Account sets it from the phone, when it creates a
-- Routine and when it edits one in place; the existing create and edit policies already keep
-- both to the Household Account, so there is no policy change. A Device reads the column
-- (select is table-wide) and writes nothing here.
--
-- Additive: no existing row, policy or other grant changes.

alter table public.routines
  add column time_of_day text check (time_of_day in ('morning', 'afternoon', 'evening'));

comment on column public.routines.time_of_day is 'When in the day the Routine belongs: morning, afternoon or evening. Null means any time.';

-- Column grants keep household_id and profile_id immutable, so the new column joins each list by name.
grant insert (time_of_day) on public.routines to authenticated;
grant update (time_of_day) on public.routines to authenticated;
