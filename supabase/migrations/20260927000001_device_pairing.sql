-- Device pairing (issue #5). A tablet signs in anonymously, asks for a short
-- Pairing Code, and a Household Account claims it from a phone. The claim
-- creates the devices row; revoking deletes it. current_household_id() now
-- resolves either principal, so every existing policy works for both.

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- The tablet's anonymous Supabase session. One session is one Device.
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz
);

comment on table public.devices is 'A tablet paired to a Household. Never administers it; a Device is not a Profile.';

create index devices_household_id_idx on public.devices (household_id);

create table public.pairing_requests (
  -- Six characters from an alphabet without 0/O, 1/I/L, so it reads cleanly across a room.
  code text primary key check (code ~ '^[A-HJ-KM-NP-Z2-9]{6}$'),
  device_auth_user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.pairing_requests is 'A short-lived Pairing Code an unpaired tablet shows so a parent can claim it.';

create index pairing_requests_device_auth_user_id_idx on public.pairing_requests (device_auth_user_id);

-- True for a signed-in Household Account, false for a Device or a visitor.
-- Policies that only the Household Account may pass combine it with
-- current_household_id().
create or replace function public.is_household_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_accounts as ha where ha.auth_user_id = auth.uid()
  )
$$;

revoke all on function public.is_household_account() from public;
revoke execute on function public.is_household_account() from anon;
grant execute on function public.is_household_account() to authenticated;

-- Resolves the calling principal to its Household: a Household Account through
-- household_accounts, a Device through its devices row. Returns null for anyone
-- else (including a revoked Device), so every policy comparing against it denies them.
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ha.household_id from public.household_accounts as ha where ha.auth_user_id = auth.uid()),
    (select d.household_id from public.devices as d where d.auth_user_id = auth.uid())
  )
$$;

-- A Device now passes "id = current_household_id()", so administration writes
-- must also name the Household Account explicitly.
drop policy "household account updates its household" on public.households;

create policy "household account updates its household"
  on public.households
  for update
  to authenticated
  using (id = public.current_household_id() and public.is_household_account())
  with check (id = public.current_household_id() and public.is_household_account());

alter table public.devices enable row level security;
alter table public.pairing_requests enable row level security;

-- Devices are created only by claim_pairing_code and last_seen_at moves only
-- through touch_device, so clients get no insert and only name among the columns.
revoke all on public.devices from anon, authenticated;
grant select on public.devices to authenticated;
grant update (name) on public.devices to authenticated;
grant delete on public.devices to authenticated;

revoke all on public.pairing_requests from anon, authenticated;
grant select on public.pairing_requests to authenticated;

create policy "principals read their household's devices"
  on public.devices
  for select
  to authenticated
  using (household_id = public.current_household_id());

create policy "household account renames its devices"
  on public.devices
  for update
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account())
  with check (household_id = public.current_household_id() and public.is_household_account());

create policy "household account revokes its devices"
  on public.devices
  for delete
  to authenticated
  using (household_id = public.current_household_id() and public.is_household_account());

create policy "a tablet reads its own pairing request"
  on public.pairing_requests
  for select
  to authenticated
  using (device_auth_user_id = auth.uid());

-- Called by an unpaired tablet. Replaces any earlier code the tablet held and
-- returns a fresh one that expires in 10 minutes.
create or replace function public.create_pairing_request()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  random_byte int;
  attempts int := 0;
  expiry timestamptz := now() + interval '10 minutes';
begin
  if uid is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'only an unpaired tablet session can ask for a pairing code' using errcode = '42501';
  end if;
  -- Its earlier unclaimed codes are void, and so is anything long expired (until the
  -- nightly prune exists). This delete comes first on purpose: if a claim of one of
  -- those codes is still in flight it waits for that claim to commit, so the
  -- "already paired" check below sees the new Device.
  delete from public.pairing_requests as r
  where (r.device_auth_user_id = uid and r.claimed_at is null) or r.expires_at < now() - interval '1 hour';

  if exists (select 1 from public.devices as d where d.auth_user_id = uid) then
    raise exception 'this tablet is already paired' using errcode = '42501';
  end if;

  loop
    attempts := attempts + 1;
    candidate := '';
    while char_length(candidate) < 6 loop
      random_byte := get_byte(extensions.gen_random_bytes(1), 0);
      -- 248 = 31 * 8: dropping the tail keeps every character equally likely.
      if random_byte < 248 then
        candidate := candidate || substr(alphabet, (random_byte % 31) + 1, 1);
      end if;
    end loop;

    begin
      insert into public.pairing_requests (code, device_auth_user_id, expires_at)
      values (candidate, uid, expiry);
      exit;
    exception when unique_violation then
      if attempts >= 10 then
        raise;
      end if;
    end;
  end loop;

  return query select candidate, expiry;
end;
$$;

revoke all on function public.create_pairing_request() from public;
revoke execute on function public.create_pairing_request() from anon;
grant execute on function public.create_pairing_request() to authenticated;

-- Called by the Household Account from a phone. One message for a code that
-- is unknown, expired or already used, so a guess learns nothing.
create or replace function public.claim_pairing_code(pairing_code text, device_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  cleaned text := upper(btrim(pairing_code));
  trimmed_name text := btrim(device_name);
  request public.pairing_requests;
  new_device uuid;
begin
  if not public.is_household_account() then
    raise exception 'only a Household Account can pair a Device' using errcode = '42501';
  end if;
  hid := public.current_household_id();

  if trimmed_name is null or char_length(trimmed_name) not between 1 and 100 then
    raise exception 'a Device needs a name of 1 to 100 characters' using errcode = '22023';
  end if;

  select * into request from public.pairing_requests as r where r.code = cleaned for update;
  if not found or request.claimed_at is not null or request.expires_at <= now() then
    raise exception 'That code is not valid. It may have expired or already been used.' using errcode = '22023';
  end if;

  insert into public.devices (household_id, auth_user_id, name)
  values (hid, request.device_auth_user_id, trimmed_name)
  returning id into new_device;

  update public.pairing_requests as r set claimed_at = now() where r.code = request.code;
  return new_device;
end;
$$;

revoke all on function public.claim_pairing_code(text, text) from public;
revoke execute on function public.claim_pairing_code(text, text) from anon;
grant execute on function public.claim_pairing_code(text, text) to authenticated;

-- The Device heartbeat. Returns whether the caller is (still) a Device, so the
-- same call that records last_seen_at tells a tablet it was paired or revoked.
create or replace function public.touch_device()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.devices as d set last_seen_at = now() where d.auth_user_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.touch_device() from public;
revoke execute on function public.touch_device() from anon;
grant execute on function public.touch_device() to authenticated;
