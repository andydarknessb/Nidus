-- Shared Lists: refuse whitespace-only names and item text (issue #31).
-- The original checks used one-argument btrim, which strips only spaces, so
-- '\t\n' passed with a trimmed length of 2. The app's helpers JS-trim first,
-- so only a direct PostgREST write could get one through. Keep the length
-- bounds and add a "has a non-whitespace character" test.

alter table public.shared_lists drop constraint shared_lists_name_check;
alter table public.shared_lists
  add constraint shared_lists_name_check
  check (char_length(btrim(name)) between 1 and 100 and name ~ '\S');

alter table public.list_items drop constraint list_items_text_check;
alter table public.list_items
  add constraint list_items_text_check
  check (char_length(btrim(text)) between 1 and 200 and text ~ '\S');
