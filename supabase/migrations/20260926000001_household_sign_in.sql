-- Google sign-in creates a Household (issue #3). The Household Timezone is an
-- IANA name, validated in the database; the first sign-in provisions the
-- Household and its Household Account link through one idempotent function.

create or replace function public.is_iana_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names as n where n.name = tz)
$$;

alter table public.households
  add constraint households_timezone_is_iana check (public.is_iana_timezone(timezone));

-- Called by the app right after sign-in. Returns the caller's Household id,
-- creating the Household and the household_accounts link on first call only.
create or replace function public.ensure_household(display_name text, browser_timezone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then
    raise exception 'ensure_household requires a signed-in Household Account' using errcode = '28000';
  end if;

  -- Serialise concurrent first sign-ins of the same account (two tabs).
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select ha.household_id into hid from public.household_accounts as ha where ha.auth_user_id = uid;
  if hid is not null then
    return hid;
  end if;

  insert into public.households (name, timezone)
  values (
    coalesce(nullif(left(btrim(display_name), 100), ''), 'My Household'),
    browser_timezone
  )
  returning id into hid;

  insert into public.household_accounts (auth_user_id, household_id) values (uid, hid);
  return hid;
end;
$$;

revoke all on function public.ensure_household(text, text) from public;
grant execute on function public.ensure_household(text, text) to authenticated;
