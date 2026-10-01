-- Meals (issue #59). What the Household plans to eat for one slot (breakfast, lunch, dinner or
-- snack) on one Household date: free text, at most one per slot per day. The wall shows a week of
-- them by slot and lists today's on the home screen. Additive: nothing existing changes.
--
-- Who writes what: a Household Account or a Device may set, change and clear a Meal. It is free text
-- on the wall, the same trust as a list item or a Native Event, so both principals are held to their
-- own Household by current_household_id() and there is deliberately no is_household_account()
-- clause. meal_date is a Household date: the client names it, as it does for a Routine Completion,
-- so the database never reads a clock or a timezone to decide which day a Meal is for.

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  meal_date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  title text not null check (char_length(title) between 1 and 200 and title ~ '\S'),
  created_at timestamptz not null default now(),
  -- One Meal per slot per day. set_meal's upsert depends on it, and its index (household first,
  -- then date) is also what a week's read walks.
  unique (household_id, meal_date, slot)
);

comment on table public.meals is 'What the Household plans to eat in one slot on one Household date (Meal). Written by a Household Account or a Device.';

alter table public.meals enable row level security;

-- Column grants keep household_id, meal_date and slot immutable: a Meal is only ever retitled, and
-- moving one is a clear and a set. set_meal below is the way the app writes.
revoke all on public.meals from anon, authenticated;
grant select, delete on public.meals to authenticated;
grant insert (household_id, meal_date, slot, title) on public.meals to authenticated;
grant update (title) on public.meals to authenticated;

create policy "principals read their household's meals"
  on public.meals for select to authenticated
  using (household_id = public.current_household_id());

create policy "principals plan meals in their household"
  on public.meals for insert to authenticated
  with check (household_id = public.current_household_id());

create policy "principals change their household's meals"
  on public.meals for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy "principals clear their household's meals"
  on public.meals for delete to authenticated
  using (household_id = public.current_household_id());

-- ---- One call to plan or clear a slot ----------------------------------------------------
-- A blank (null, empty or whitespace-only) title clears the Household's Meal for the date and
-- slot; anything else plans it, replacing the title if the slot already holds one. One statement
-- either way, so two screens saving the same slot at once leave one Meal and never a duplicate.
-- security invoker: the policies and column grants above stay the one authority on what the
-- caller may write. Raises 42501 for a caller of no Household (an unpaired tablet) before it
-- looks at the title, so a blank title from one is refused and never a quiet no-op.
create or replace function public.set_meal(p_meal_date date, p_slot text, p_title text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household_id uuid := public.current_household_id();
begin
  if v_household_id is null then
    raise exception 'not a principal of a household' using errcode = '42501';
  end if;

  if p_title is null or p_title !~ '\S' then
    delete from public.meals as m
    where m.household_id = v_household_id and m.meal_date = p_meal_date and m.slot = p_slot;
    return;
  end if;

  insert into public.meals (household_id, meal_date, slot, title)
  values (v_household_id, p_meal_date, p_slot, btrim(p_title))
  on conflict (household_id, meal_date, slot) do update set title = excluded.title;
end;
$$;

revoke all on function public.set_meal(date, text, text) from public;
-- Supabase grants execute on new functions to anon directly; revoking from public does not remove it.
revoke execute on function public.set_meal(date, text, text) from anon;
grant execute on function public.set_meal(date, text, text) to authenticated;

-- Realtime, as for every Household table. id stays the only primary key (date and slot are a
-- unique key, not the identity) and the replica identity stays the default, never full, so a
-- delete reaches subscribers as the id alone and no Meal's title leaves its Household.
-- 20261008000001_realtime.sql says what a delete leaks.
alter publication supabase_realtime add table public.meals;
