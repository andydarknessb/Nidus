-- Limit failed Pairing Code claims (#21).
--
-- claim_pairing_code (#5) rejected an unknown, expired or used code by raising,
-- and a raise rolls back everything the function wrote, so nothing could count
-- the failures. A Household Account could guess codes without bound. The
-- rejection now returns null instead, so the failure row commits, and the
-- caller is refused once it has failed too often. The limit is per Household
-- Account (auth.uid()), not per IP: the browser calls the database directly,
-- so no edge rule sees the request.

create table public.pairing_claim_failures (
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  failed_at timestamptz not null default now()
);

create index pairing_claim_failures_user_time_idx
  on public.pairing_claim_failures (auth_user_id, failed_at);

-- Only claim_pairing_code (security definer) and the service role touch this.
alter table public.pairing_claim_failures enable row level security;
revoke all on public.pairing_claim_failures from anon, authenticated;

-- Returns the new Device id, or null when the code is unknown, expired or
-- already used (one answer for all three, so a guess learns nothing). Raises
-- P0429 once this caller has failed 5 times in the last 15 minutes.
create or replace function public.claim_pairing_code(pairing_code text, device_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  cleaned text := upper(btrim(pairing_code));
  trimmed_name text := btrim(device_name);
  request public.pairing_requests;
  new_device uuid;
  recent_failures integer;
begin
  if not public.is_household_account() then
    raise exception 'only a Household Account can pair a Device' using errcode = '42501';
  end if;
  hid := public.current_household_id();

  -- One claim at a time per caller, so a burst of parallel claims cannot all
  -- read the same count and slip past the limit.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select count(*) into recent_failures
  from public.pairing_claim_failures as f
  where f.auth_user_id = uid and f.failed_at > now() - interval '15 minutes';
  if recent_failures >= 5 then
    -- Nothing is recorded here: a refusal must not extend the lockout.
    raise exception 'Too many attempts. Wait 15 minutes and try again.' using errcode = 'P0429';
  end if;

  if trimmed_name is null or char_length(trimmed_name) not between 1 and 100 then
    raise exception 'a Device needs a name of 1 to 100 characters' using errcode = '22023';
  end if;

  select * into request from public.pairing_requests as r where r.code = cleaned for update;
  if not found or request.claimed_at is not null or request.expires_at <= now() then
    delete from public.pairing_claim_failures as f
    where f.auth_user_id = uid and f.failed_at <= now() - interval '15 minutes';
    insert into public.pairing_claim_failures (auth_user_id) values (uid);
    return null;
  end if;

  insert into public.devices (household_id, auth_user_id, name)
  values (hid, request.device_auth_user_id, trimmed_name)
  returning id into new_device;

  update public.pairing_requests as r set claimed_at = now() where r.code = request.code;
  delete from public.pairing_claim_failures as f where f.auth_user_id = uid;
  return new_device;
end;
$$;

revoke all on function public.claim_pairing_code(text, text) from public;
revoke execute on function public.claim_pairing_code(text, text) from anon;
grant execute on function public.claim_pairing_code(text, text) to authenticated;
