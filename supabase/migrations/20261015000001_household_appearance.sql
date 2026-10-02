-- The Household's Appearance (issue #73, spec 0003). How the Household wants the Wall to look: auto (light from
-- sunrise to sunset, dark otherwise), light or dark. A screen's own switch overrides it on that screen until the next
-- sunrise or sunset, and that override is kept on the screen, never here.
--
-- Who writes what: unchanged. The Household Account sets it from the phone's settings; a Device (the wall) reads it. No
-- grant or policy changes are needed: `authenticated` already holds table-level select and update on households, and its
-- update policy already requires is_household_account(), so a Device reads the column and cannot change it, and another
-- Household's principals can neither read nor change it. The table is already on the Realtime publication, so a second
-- screen hears the change.
--
-- Additive: a Household inserted without it is auto, so nothing that inserts Households today has to change, and the
-- build that is live, which reads households with an explicit column list, never sees the column.

alter table public.households
  add column appearance text not null default 'auto' check (appearance in ('auto', 'light', 'dark'));

comment on column public.households.appearance is 'How the Household wants the Wall to look: auto (light from sunrise to sunset, dark otherwise), light or dark.';
