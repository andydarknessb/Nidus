-- set_meal refuses an unknown or null slot (issue #68). A titled call already was, by the table's
-- check constraint (23514); a blank title took the clearing branch, deleted nothing and returned,
-- so a caller's typo read as success. The check now comes before both branches and raises the same
-- code. The no-Household refusal (42501) stays first. Same signature, so the grants carry over.

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

  -- A null slot is not "in" the list, so it is refused too.
  if p_slot is null or p_slot not in ('breakfast', 'lunch', 'dinner', 'snack') then
    raise exception 'unknown meal slot' using errcode = '23514';
  end if;

  if p_title is null or p_title !~ '\S' then
    delete from public.meals as m
    where m.household_id = v_household_id and m.meal_date = p_meal_date and m.slot = p_slot;
    return;
  end if;

  insert into public.meals (household_id, meal_date, slot, title)
  values (v_household_id, p_meal_date, p_slot, btrim(p_title, E' \t\n\r\f\x0b'))
  on conflict (household_id, meal_date, slot) do update set title = excluded.title;
end;
$$;
