-- Shared Lists (issue #12). Many named lists per Household, each holding text
-- items that stay struck through (crossed_at set) until "clear completed"
-- deletes them. The Household Account manages the lists; a Household Account or
-- a Device writes the items. One list is pinned to the wall's rail through
-- households.pinned_list_id.

create table public.shared_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- Lets households.pinned_list_id prove the pinned list is the Household's own.
  unique (id, household_id)
);

comment on table public.shared_lists is 'A named household-wide list of text items (Shared List).';

create index shared_lists_household_id_idx on public.shared_lists (household_id, sort_order);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shared_lists (id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 200),
  -- Set while the item is crossed off; null while it is open.
  crossed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.list_items is 'One text item on a Shared List. Crossed items stay visible until cleared.';

create index list_items_list_id_idx on public.list_items (list_id, sort_order, created_at);

-- The pinned list must belong to the same Household: a composite reference, so
-- a Household Account cannot pin another Household's list. Deleting the pinned
-- list leaves the Household with nothing pinned.
alter table public.households
  add constraint households_pinned_list_fkey
  foreign key (pinned_list_id, id)
  references public.shared_lists (id, household_id)
  on delete set null (pinned_list_id);

-- Every Household starts with a Groceries list, pinned. A trigger, so it holds
-- however the Household is created (ensure_household today, anything later).
create or replace function public.households_seed_groceries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  groceries uuid;
begin
  insert into public.shared_lists (household_id, name, sort_order)
  values (new.id, 'Groceries', 0)
  returning id into groceries;

  update public.households as h set pinned_list_id = groceries where h.id = new.id;
  return null;
end;
$$;

revoke all on function public.households_seed_groceries() from public;

create trigger households_seed_groceries
  after insert on public.households
  for each row execute function public.households_seed_groceries();

-- Households that exist already get the same starting point.
with seeded as (
  insert into public.shared_lists (household_id, name, sort_order)
  select h.id, 'Groceries', 0 from public.households as h where h.pinned_list_id is null
  returning id, household_id
)
update public.households as h
set pinned_list_id = seeded.id
from seeded
where h.id = seeded.household_id;

alter table public.shared_lists enable row level security;
alter table public.list_items enable row level security;

revoke all on public.shared_lists from anon, authenticated;
grant select, delete on public.shared_lists to authenticated;
grant insert (household_id, name, sort_order) on public.shared_lists to authenticated;
grant update (name, sort_order) on public.shared_lists to authenticated;

-- A Device may add, edit, cross, reorder and clear items; nothing else on the row moves.
revoke all on public.list_items from anon, authenticated;
grant select, delete on public.list_items to authenticated;
grant insert (list_id, text, sort_order) on public.list_items to authenticated;
grant update (text, crossed_at, sort_order) on public.list_items to authenticated;

create policy "principals read their household's lists"
  on public.shared_lists
  for select
  to authenticated
  using (household_id = public.current_household_id());

create policy "household account creates lists"
  on public.shared_lists
  for insert
  to authenticated
  with check (household_id = public.current_household_id() and public.is_household_account());

create policy "household account renames and reorders lists"
  on public.shared_lists
  for update
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account())
  with check (household_id = public.current_household_id() and public.is_household_account());

create policy "household account deletes lists"
  on public.shared_lists
  for delete
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account());

-- Items are reached through their list, so the Household check is the list's.
create policy "principals read their household's items"
  on public.list_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.shared_lists as l
      where l.id = list_items.list_id and l.household_id = public.current_household_id()
    )
  );

create policy "principals add items to their household's lists"
  on public.list_items
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.shared_lists as l
      where l.id = list_items.list_id and l.household_id = public.current_household_id()
    )
  );

create policy "principals update their household's items"
  on public.list_items
  for update
  to authenticated
  using (
    exists (
      select 1 from public.shared_lists as l
      where l.id = list_items.list_id and l.household_id = public.current_household_id()
    )
  )
  with check (
    exists (
      select 1 from public.shared_lists as l
      where l.id = list_items.list_id and l.household_id = public.current_household_id()
    )
  );

create policy "principals delete their household's items"
  on public.list_items
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.shared_lists as l
      where l.id = list_items.list_id and l.household_id = public.current_household_id()
    )
  );
