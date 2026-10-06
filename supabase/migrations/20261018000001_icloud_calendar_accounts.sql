-- iPhone (iCloud) calendars (issue #116, spec 0005, ADR 0003). A Calendar Account now has a
-- provider: Google as before, or an iCloud calendar mirrored from its public link. The link is a
-- secret kept in Vault, exactly as a Google refresh token is, and is never readable by a client.
-- This adds; nothing is renamed, so every existing account is a Google account, unchanged.
--
-- Who writes what is unchanged: the calendar-connect Edge Function (service role) creates
-- accounts; the Household Account removes them and chooses among Mirrored Calendars; a Device
-- only reads. RLS and the existing grants stand; only `provider` joins the readable columns.

alter table public.calendar_accounts
  add column provider text not null default 'google' check (provider in ('google', 'icloud'));

-- An iCloud account has no Google email: required for google, null for icloud.
alter table public.calendar_accounts alter column google_email drop not null;
alter table public.calendar_accounts
  add constraint calendar_accounts_provider_identity check (
    (provider = 'google' and google_email is not null) or (provider = 'icloud' and google_email is null)
  );

-- SHA-256 (hex) of an iCloud account's normalised link, so the same link cannot be added to a
-- Household twice without ever comparing the secret itself. Null for Google. Not granted to any
-- client: the select grant below is a list, and this is not on it.
alter table public.calendar_accounts add column feed_key text check (feed_key ~ '^[0-9a-f]{64}$');
alter table public.calendar_accounts
  add constraint calendar_accounts_household_feed_key_key unique (household_id, feed_key);

grant select (provider) on public.calendar_accounts to authenticated;

comment on table public.calendar_accounts is 'An external calendar provider connection (Calendar Account): Google (a refresh token) or iCloud (a public feed link). The secret is a Vault secret.';
comment on column public.calendar_accounts.provider is 'google or icloud. Existing rows are google.';
comment on column public.calendar_accounts.vault_secret_id is 'The Vault secret: a Google refresh token, or an iCloud account''s normalised feed link. No client may read this column.';
comment on column public.calendar_accounts.feed_key is 'icloud only: SHA-256 hex of the normalised feed link, unique per Household. No client may read this column.';

comment on column public.mirrored_calendars.google_calendar_id is 'google: the Google calendar id. icloud: the literal ics (an iCloud account has exactly one Mirrored Calendar). The column keeps its name.';
comment on column public.mirrored_calendars.sync_token is 'google: the Google sync token. icloud: the feed''s validators as JSON, {"etag": ..., "lastModified": ...}, either null (null when the server sent neither). No client may read this column.';
comment on column public.synced_events.google_event_id is 'google: the Google event id. icloud: the event''s UID, a separator and the occurrence''s original start as a UTC instant (its RECURRENCE-ID for a moved occurrence). The column keeps its name.';

-- ---- Service-role only: storing an iCloud calendar -----------------------------------------
-- The link goes into Vault and the account and its one Mirrored Calendar (ics, selected, the
-- whole Household) are made, in one transaction: a failure leaves neither a secret with no
-- account nor an account with no calendar. A link already in the Household is refused with
-- unique_violation (23505), also when two adds race, because feed_key is unique per Household.
create or replace function public.store_icloud_calendar(
  p_household_id uuid,
  p_link text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := encode(sha256(convert_to(p_link, 'utf8')), 'hex');
  secret_id uuid;
  account_id uuid;
begin
  if exists (select 1 from public.calendar_accounts where household_id = p_household_id and feed_key = v_key) then
    raise exception 'that calendar is already in this household' using errcode = '23505';
  end if;

  secret_id := vault.create_secret(
    p_link,
    'calendar_account_' || gen_random_uuid()::text,
    'iPhone calendar link for a Calendar Account'
  );
  insert into public.calendar_accounts (household_id, provider, google_email, vault_secret_id, feed_key)
  values (p_household_id, 'icloud', null, secret_id, v_key)
  returning id into account_id;

  insert into public.mirrored_calendars (household_id, calendar_account_id, google_calendar_id, name, selected)
  values (
    p_household_id,
    account_id,
    'ics',
    left(coalesce(nullif(btrim(p_name), ''), 'iPhone calendar'), 500),
    true
  );
  return account_id;
end;
$$;

revoke all on function public.store_icloud_calendar(uuid, text, text) from public;
revoke execute on function public.store_icloud_calendar(uuid, text, text) from anon, authenticated;
grant execute on function public.store_icloud_calendar(uuid, text, text) to service_role;
