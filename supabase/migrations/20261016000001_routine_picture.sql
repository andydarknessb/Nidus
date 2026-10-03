-- Routine picture (issue #76). A Routine may be given a picture from the app's fixed set, so a child who cannot read
-- yet can tell one Routine from another. The column holds the picture's key; the app maps keys to pictures and draws a
-- plain circle for a key it does not know, so the database keeps no list of them and checks only the length. Null means
-- no picture, which is what every existing Routine stays.
--
-- Who writes what: unchanged. The Household Account sets it from the phone, when it creates a Routine and when it edits
-- one in place; the existing create and edit policies already keep both to the Household Account, so there is no policy
-- change. A Device reads the column (select is table-wide) and writes nothing here.
--
-- Additive: no existing row, policy or other grant changes.

alter table public.routines
  add column picture text check (char_length(picture) between 1 and 32);

comment on column public.routines.picture is 'The key of the Routine''s picture in the app''s fixed set (docs/look.md), 1 to 32 characters. Null means no picture. The app draws a plain circle for a key it does not know.';

-- Column grants keep household_id and profile_id immutable, so the new column joins each list by name.
grant insert (picture) on public.routines to authenticated;
grant update (picture) on public.routines to authenticated;
