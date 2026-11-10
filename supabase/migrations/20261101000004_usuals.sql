-- Usuals (spec 0019, ticket 4): the product the Household buys for an item, by the item's name ("milk" is a gallon of Good & Gather 2%),
-- with a Target link when there is one. A Household Account writes them in the phone's Settings; every principal of the Household reads
-- them, and the shopper reads them on the server. Additive: nothing existing changes.

create table public.usuals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60 and name ~ '\S'),
  product text not null check (char_length(product) between 1 and 200 and product ~ '\S'),
  target_link text check (target_link is null or (char_length(target_link) <= 500 and starts_with(target_link, 'https://www.target.com/p/'))),
  created_at timestamptz not null default now()
);

comment on table public.usuals is 'The product the Household buys for an item, with a Target link when there is one (Usual). Written by a Household Account; read by the Household.';

-- One Usual per name in a Household, ignoring case and runs of spaces: the write is refused, never a second row for the same item.
create unique index usuals_household_name_idx on public.usuals (household_id, (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))));

alter table public.usuals enable row level security;

-- Column grants keep household_id and created_at immutable. A Device runs as authenticated too, so it holds these grants; the
-- is_household_account() clause in the write policies below is what refuses it.
revoke all on public.usuals from anon, authenticated;
grant select, delete on public.usuals to authenticated;
grant insert (household_id, name, product, target_link) on public.usuals to authenticated;
grant update (name, product, target_link) on public.usuals to authenticated;

create policy "principals read their household's usuals"
  on public.usuals for select to authenticated
  using (household_id = public.current_household_id());

create policy "household account adds usuals"
  on public.usuals for insert to authenticated
  with check (household_id = public.current_household_id() and public.is_household_account());

create policy "household account changes usuals"
  on public.usuals for update to authenticated
  using (household_id = public.current_household_id() and public.is_household_account())
  with check (household_id = public.current_household_id() and public.is_household_account());

create policy "household account deletes usuals"
  on public.usuals for delete to authenticated
  using (household_id = public.current_household_id() and public.is_household_account());

-- Realtime, as for every Household table: the Settings card and the Send to Target sheet read again when a Usual changes.
alter publication supabase_realtime add table public.usuals;
