-- Anonymous sign-ins are on (device pairing, issue #5), so any visitor can hold
-- an authenticated session. Only a real sign-in may own a Household; a tablet's
-- anonymous session becomes a Device through pairing instead.

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
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'a tablet session cannot own a Household' using errcode = '42501';
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
