-- Joining from an empty Household (issue #126, docs/specs/0006-household-invites.md). Opening Settings
-- before tapping Join makes ensure_household give the person a Household of their own, and
-- accept_household_invite then refused them as "another Household's account", for good. A Household
-- with nothing in it holds nothing of theirs, so it is given up: joining deletes it, spends the invite
-- and makes the caller a Household Account of the inviting Household, in one transaction. A Household
-- with anything in it is refused with PT409 exactly as before; nothing moves or merges.
--
-- "Empty" means every one of: no other Household Account, no Device, no Profile, no Calendar Account
-- (any provider), no Native Event, no Routine, no Meal, no Household Invite, at most one Shared List
-- (the Groceries list every Household is seeded with, which may have been renamed) and no list item.
-- The rest of what hangs off a Household is reached only through those, so it is empty when they are:
-- Mirrored Calendars and Synced Events through a Calendar Account, Routine Completions through a
-- Routine, and the Native Event / Profile links through those two. The Household's own settings (name,
-- time zone, Appearance, weather place) do not count and go with it. The Routine check is defence in
-- depth: a Routine always has a Profile, so a Household with one is already refused for the Profile. A Pairing Code and the pairing
-- failure log are keyed to an auth user, not a Household, so they are not the Household's to keep.

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
  is_empty boolean;
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
    raise exception 'This invite link no longer works.' using errcode = 'PT410';
  end if;
  token_digest := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select ha.household_id into own_hid from public.household_accounts as ha where ha.auth_user_id = uid;

  if own_hid is not null then
    -- A dead link is dead for everyone, and changes nothing.
    select i.household_id into invite_hid
    from public.household_invites as i
    where i.token_hash = token_digest and i.expires_at > now();
    if invite_hid is null then
      raise exception 'This invite link no longer works.' using errcode = 'PT410';
    end if;
    -- Already a Household Account of the inviting Household: nothing is spent.
    if invite_hid = own_hid then
      return own_hid;
    end if;

    -- Another Household. Lock both Households' rows, lowest id first, so two joins that cross
    -- cannot deadlock. A row lock holds off anything that would add a row whose foreign key
    -- points at the locked row (every table with a household_id), so what is counted below stays
    -- true until this transaction ends. A list item points at its list, not at the Household, so
    -- the caller's lists are locked too (households first, then lists; nothing locks them the
    -- other way). remove_household_account locks the same households row.
    perform 1 from public.households as h where h.id in (own_hid, invite_hid) order by h.id for update;
    perform 1 from public.shared_lists as l where l.household_id = own_hid for update;

    select
      exists (select 1 from public.household_accounts as ha where ha.auth_user_id = uid and ha.household_id = own_hid)
      and not exists (select 1 from public.household_accounts as ha where ha.household_id = own_hid and ha.auth_user_id <> uid)
      and not exists (select 1 from public.devices as d where d.household_id = own_hid)
      and not exists (select 1 from public.profiles as p where p.household_id = own_hid)
      and not exists (select 1 from public.calendar_accounts as c where c.household_id = own_hid)
      and not exists (select 1 from public.native_events as n where n.household_id = own_hid)
      and not exists (select 1 from public.routines as r where r.household_id = own_hid)
      and not exists (select 1 from public.meals as m where m.household_id = own_hid)
      and not exists (select 1 from public.household_invites as i where i.household_id = own_hid)
      and (select count(*) from public.shared_lists as l where l.household_id = own_hid) <= 1
      and not exists (
        select 1 from public.list_items as li join public.shared_lists as l on l.id = li.list_id where l.household_id = own_hid
      )
    into is_empty;
    if not is_empty then
      raise exception 'This Google account already has its own household.' using errcode = 'PT409';
    end if;

    -- The invite was read before the locks; spend it now, for good. A link spent or cancelled
    -- in the meantime ends here and the transaction rolls back whole.
    delete from public.household_invites as i
    where i.household_id = invite_hid and i.token_hash = token_digest and i.expires_at > now();
    if not found then
      raise exception 'This invite link no longer works.' using errcode = 'PT410';
    end if;

    -- Move the link first, so the delete below cascades over no Household Account.
    update public.household_accounts as ha set household_id = invite_hid where ha.auth_user_id = uid;
    delete from public.households as h where h.id = own_hid;
    return invite_hid;
  end if;

  -- No Household yet: spend the invite and make the link in one go. Two people racing one link:
  -- the second delete waits for the first to commit, then finds no row.
  delete from public.household_invites as i
  where i.token_hash = token_digest and i.expires_at > now()
  returning i.household_id into invite_hid;
  if invite_hid is null then
    raise exception 'This invite link no longer works.' using errcode = 'PT410';
  end if;

  insert into public.household_accounts (auth_user_id, household_id) values (uid, invite_hid);
  return invite_hid;
end;
$$;

revoke all on function public.accept_household_invite(text) from public;
revoke execute on function public.accept_household_invite(text) from anon;
grant execute on function public.accept_household_invite(text) to authenticated;
