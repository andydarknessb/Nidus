-- Households and Household Accounts (CONTEXT.md), plus the one helper every
-- row-level security policy uses (PLAN.md, ADR 0001).

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  timezone text not null default 'UTC',
  -- References shared_lists once that table exists (ticket: Shared Lists).
  pinned_list_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.households is 'The tenant: one family, one wall display, one Household Timezone.';

create table public.household_accounts (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.household_accounts is 'The single sign-in identity that owns and administers a Household.';

create index household_accounts_household_id_idx on public.household_accounts (household_id);

-- Resolves the calling principal to its Household. A Household Account resolves
-- through household_accounts; Devices are added when pairing lands. Returns null
-- for anonymous callers, so every policy comparing against it denies them.
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ha.household_id
  from public.household_accounts as ha
  where ha.auth_user_id = auth.uid()
$$;

revoke all on function public.current_household_id() from public;
grant execute on function public.current_household_id() to anon, authenticated;

alter table public.households enable row level security;
alter table public.household_accounts enable row level security;

create policy "principals read their own household"
  on public.households
  for select
  to authenticated
  using (id = public.current_household_id());

create policy "household account updates its household"
  on public.households
  for update
  to authenticated
  using (id = public.current_household_id())
  with check (id = public.current_household_id());

create policy "household account reads its own link"
  on public.household_accounts
  for select
  to authenticated
  using (auth_user_id = auth.uid());
