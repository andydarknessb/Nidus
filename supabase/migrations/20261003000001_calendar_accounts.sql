-- Calendar Accounts and Mirrored Calendars (issue #6). A Calendar Account is a Google
-- connection belonging to the Household; its refresh token lives in Supabase Vault and
-- never leaves the server. A Mirrored Calendar is one calendar inside it that Nidus
-- mirrors, with the Profile (or whole-Household) attribution its Synced Events inherit.
--
-- Who writes what: the calendar-connect Edge Function (service role) creates accounts and
-- lists their Google calendars; the Household Account chooses which calendars are
-- mirrored, whose they are, and their colour, and can remove an account; a Device only reads.

create extension if not exists supabase_vault;

create table public.calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  google_email text not null check (char_length(google_email) between 3 and 320 and google_email = lower(google_email)),
  -- The Vault secret holding the refresh token. No client may read this column.
  vault_secret_id uuid not null,
  status text not null default 'active' check (status in ('active', 'needs_reauth')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (household_id, google_email)
);

comment on table public.calendar_accounts is 'An external calendar provider connection (Calendar Account). v1: Google only. The refresh token is a Vault secret.';

alter table public.calendar_accounts enable row level security;

-- vault_secret_id is left out of the select grant, so no client can read it (a client
-- naming it, or selecting *, is refused). Clients never insert or update accounts; the
-- Edge Function does, as the service role.
revoke all on public.calendar_accounts from anon, authenticated;
grant select (id, household_id, google_email, status, last_synced_at, last_error, created_at)
  on public.calendar_accounts to authenticated;
grant delete on public.calendar_accounts to authenticated;

create policy "principals read their household's calendar accounts"
  on public.calendar_accounts
  for select
  to authenticated
  using (household_id = public.current_household_id());

create policy "household account removes calendar accounts"
  on public.calendar_accounts
  for delete
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account());

-- Removing an account (or its Household) removes its Vault secret with it.
create or replace function public.delete_calendar_account_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$$;

revoke all on function public.delete_calendar_account_secret() from public;

create trigger calendar_accounts_delete_secret
  after delete on public.calendar_accounts
  for each row execute function public.delete_calendar_account_secret();

create table public.mirrored_calendars (
  id uuid primary key default gen_random_uuid(),
  -- Denormalised from the account so the policies read like every other table's.
  household_id uuid not null references public.households (id) on delete cascade,
  calendar_account_id uuid not null references public.calendar_accounts (id) on delete cascade,
  google_calendar_id text not null check (char_length(google_calendar_id) between 1 and 1024),
  name text not null check (char_length(name) between 1 and 500),
  -- Optional colour override (#rrggbb). Null: the calendar shows in its Profile's colour.
  color text check (color is null or color ~ '^#[0-9a-f]{6}$'),
  -- Null: the whole Household.
  profile_id uuid references public.profiles (id) on delete set null,
  selected boolean not null default false,
  sync_token text,
  created_at timestamptz not null default now(),
  unique (calendar_account_id, google_calendar_id)
);

comment on table public.mirrored_calendars is 'One calendar within a Calendar Account that Nidus mirrors (Mirrored Calendar), with its Profile attribution and colour.';

create index mirrored_calendars_household_id_idx on public.mirrored_calendars (household_id);

alter table public.mirrored_calendars enable row level security;

-- The Household Account may change only the three choices; sync_token is the sync's own.
revoke all on public.mirrored_calendars from anon, authenticated;
grant select (id, household_id, calendar_account_id, google_calendar_id, name, color, profile_id, selected, created_at)
  on public.mirrored_calendars to authenticated;
grant update (selected, color, profile_id) on public.mirrored_calendars to authenticated;

create policy "principals read their household's mirrored calendars"
  on public.mirrored_calendars
  for select
  to authenticated
  using (household_id = public.current_household_id());

create policy "household account chooses mirrored calendars"
  on public.mirrored_calendars
  for update
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account())
  with check (household_id = public.current_household_id() and public.is_household_account());

-- A Mirrored Calendar can only be attributed to a Profile of its own Household, and can
-- only sit in an account of its own Household. (A foreign key alone cannot say either.)
create or replace function public.check_mirrored_calendar_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.calendar_accounts a
    where a.id = new.calendar_account_id and a.household_id = new.household_id
  ) then
    raise exception 'mirrored calendar and its calendar account belong to different households' using errcode = '23514';
  end if;
  if new.profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.profile_id and p.household_id = new.household_id
  ) then
    raise exception 'mirrored calendar is assigned to a profile of another household' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.check_mirrored_calendar_household() from public;

create trigger mirrored_calendars_check_household
  before insert or update on public.mirrored_calendars
  for each row execute function public.check_mirrored_calendar_household();

-- ---- Service-role only: the Edge Function's door to Vault ------------------------------
-- Vault is not exposed through the API, so these security definer functions are the only
-- way in, and only the service role may run them.

-- Stores (or, for an account already connected, replaces) the refresh token and upserts
-- the Calendar Account for a Household. One statement's worth of work, so a failure leaves
-- neither a secret with no account nor an account with no secret.
create or replace function public.store_calendar_account(
  p_household_id uuid,
  p_google_email text,
  p_refresh_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.calendar_accounts%rowtype;
  secret_id uuid;
  account_id uuid;
begin
  select * into existing
  from public.calendar_accounts
  where household_id = p_household_id and google_email = lower(p_google_email);

  if found then
    perform vault.update_secret(existing.vault_secret_id, p_refresh_token);
    update public.calendar_accounts
    set status = 'active', last_error = null
    where id = existing.id;
    return existing.id;
  end if;

  secret_id := vault.create_secret(
    p_refresh_token,
    'calendar_account_' || gen_random_uuid()::text,
    'Google refresh token for a Calendar Account'
  );
  insert into public.calendar_accounts (household_id, google_email, vault_secret_id)
  values (p_household_id, lower(p_google_email), secret_id)
  returning id into account_id;
  return account_id;
end;
$$;

-- Reads a Calendar Account's refresh token (the sync's use). Null once the secret is gone.
create or replace function public.read_calendar_secret(p_secret_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  -- Only a secret a Calendar Account points at; the rest of Vault stays out of reach.
  select s.decrypted_secret
  from vault.decrypted_secrets as s
  where s.id = p_secret_id
    and exists (select 1 from public.calendar_accounts a where a.vault_secret_id = s.id);
$$;

revoke all on function public.store_calendar_account(uuid, text, text) from public;
revoke execute on function public.store_calendar_account(uuid, text, text) from anon, authenticated;
grant execute on function public.store_calendar_account(uuid, text, text) to service_role;

-- Whether a Vault secret still exists, by id alone (no account row needed, nothing decrypted).
-- Lets the tests see that removing an account or a Household really removed its secret.
create or replace function public.calendar_secret_exists(p_secret_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $
  select exists (select 1 from vault.secrets where id = p_secret_id);
$;

revoke all on function public.calendar_secret_exists(uuid) from public;
revoke execute on function public.calendar_secret_exists(uuid) from anon, authenticated;
grant execute on function public.calendar_secret_exists(uuid) to service_role;

revoke all on function public.read_calendar_secret(uuid) from public;
revoke execute on function public.read_calendar_secret(uuid) from anon, authenticated;
grant execute on function public.read_calendar_secret(uuid) to service_role;
