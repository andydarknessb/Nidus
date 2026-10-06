-- Household Invites (docs/specs/0006-household-invites.md, issue #121). A
-- Household Account makes a single-use link; another grown-up signs in with
-- their own Google account and becomes a Household Account of the same
-- Household. Every Household Account has the same rights, and any of them may
-- remove another (never itself, so a Household always keeps one).

create table public.household_invites (
  -- One invite at a time: making a new one replaces the row.
  household_id uuid primary key references public.households (id) on delete cascade,
  -- SHA-256 hex of the token. The token itself is returned once and never stored.
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.household_invites is 'The one single-use link a Household Account made so another grown-up can join. Only the token''s hash is stored.';

alter table public.household_invites enable row level security;

-- The RPCs write. A client reads when the invite expires, never the hash.
revoke all on public.household_invites from anon, authenticated;
grant select (household_id, created_at, expires_at) on public.household_invites to authenticated;

create policy "household account reads its invite"
  on public.household_invites
  for select
  to authenticated
  using (public.is_household_account() and household_id = public.current_household_id());

-- Removing a Household Account. A delete with a WHERE clause also needs the row
-- to pass a select policy, and the one policy so far shows a caller only their
-- own link, so a Household Account also reads its Household's links.
create policy "household account reads its household's accounts"
  on public.household_accounts
  for select
  to authenticated
  using (public.is_household_account() and household_id = public.current_household_id());

create policy "household account removes another of its household"
  on public.household_accounts
  for delete
  to authenticated
  using (
    public.is_household_account()
    and household_id = public.current_household_id()
    and auth_user_id <> auth.uid()
  );

-- authenticated held every default grant here, refused only by row-level
-- security. Say what is meant: read and delete (the policies above), never
-- insert or update. Accounts are made by ensure_household and
-- accept_household_invite, which are security definer. Defence in depth, as
-- 20261011000001 did for households.
revoke all on public.household_accounts from authenticated;
grant select, delete on public.household_accounts to authenticated;

-- Makes (or replaces) the Household's invite and returns the plain token, once.
create or replace function public.create_household_invite()
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  hid uuid;
  new_token text := encode(extensions.gen_random_bytes(32), 'hex');
  expiry timestamptz := now() + interval '7 days';
begin
  if not public.is_household_account() then
    raise exception 'only a Household Account can make a Household Invite' using errcode = '42501';
  end if;
  hid := public.current_household_id();

  insert into public.household_invites as i (household_id, token_hash, created_at, expires_at)
  values (hid, encode(extensions.digest(new_token, 'sha256'), 'hex'), now(), expiry)
  on conflict (household_id) do update
    set token_hash = excluded.token_hash, created_at = excluded.created_at, expires_at = excluded.expires_at;

  return query select new_token, expiry;
end;
$$;

revoke all on function public.create_household_invite() from public;
revoke execute on function public.create_household_invite() from anon;
grant execute on function public.create_household_invite() to authenticated;

-- Ends the Household's invite. Having none is not an error.
create or replace function public.cancel_household_invite()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_household_account() then
    raise exception 'only a Household Account can cancel a Household Invite' using errcode = '42501';
  end if;
  delete from public.household_invites as i where i.household_id = public.current_household_id();
end;
$$;

revoke all on function public.cancel_household_invite() from public;
revoke execute on function public.cancel_household_invite() from anon;
grant execute on function public.cancel_household_invite() to authenticated;

-- Called by the person invited, signed in with their own Google account.
-- Returns the Household. One refusal, P0410, for every link that does not work
-- (malformed, unknown, expired, replaced, cancelled or spent), so a guess learns
-- nothing; P0409 for a caller who already belongs to another Household.
create or replace function public.accept_household_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  own_hid uuid;
  invite_hid uuid;
  token_digest text;
begin
  if uid is null then
    raise exception 'joining a household requires a signed-in Google account' using errcode = '28000';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'a tablet session cannot join a household' using errcode = '42501';
  end if;

  -- Serialise this caller's joins with each other and with ensure_household.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'This invite link no longer works.' using errcode = 'P0410';
  end if;
  token_digest := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select ha.household_id into own_hid from public.household_accounts as ha where ha.auth_user_id = uid;

  if own_hid is not null then
    -- Already a Household Account: nothing is spent. The same Household gets its
    -- id back; another Household is refused. A dead link is dead for everyone.
    select i.household_id into invite_hid
    from public.household_invites as i
    where i.token_hash = token_digest and i.expires_at > now();
    if invite_hid is null then
      raise exception 'This invite link no longer works.' using errcode = 'P0410';
    end if;
    if invite_hid <> own_hid then
      raise exception 'This Google account already has its own household.' using errcode = 'P0409';
    end if;
    return own_hid;
  end if;

  -- Spend the invite and make the link in one go. Two people racing one link:
  -- the second delete waits for the first to commit, then finds no row.
  delete from public.household_invites as i
  where i.token_hash = token_digest and i.expires_at > now()
  returning i.household_id into invite_hid;
  if invite_hid is null then
    raise exception 'This invite link no longer works.' using errcode = 'P0410';
  end if;

  insert into public.household_accounts (auth_user_id, household_id) values (uid, invite_hid);
  return invite_hid;
end;
$$;

revoke all on function public.accept_household_invite(text) from public;
revoke execute on function public.accept_household_invite(text) from anon;
grant execute on function public.accept_household_invite(text) to authenticated;

-- Everyone who can sign in to the caller's Household, oldest first, with the
-- email from auth.users (which a client cannot read).
create or replace function public.household_account_list()
returns table (auth_user_id uuid, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_household_account() then
    raise exception 'only a Household Account can list who can sign in' using errcode = '42501';
  end if;
  return query
    select ha.auth_user_id, coalesce(u.email, '')::text, ha.created_at
    from public.household_accounts as ha
    join auth.users as u on u.id = ha.auth_user_id
    where ha.household_id = public.current_household_id()
    order by ha.created_at, ha.auth_user_id;
end;
$$;

revoke all on function public.household_account_list() from public;
revoke execute on function public.household_account_list() from anon;
grant execute on function public.household_account_list() to authenticated;
