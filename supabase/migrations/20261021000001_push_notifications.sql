-- Notifications on the phone (docs/specs/0007-push-notifications.md, issue #134). A Household
-- Account that turns notifications on at Settings has a Push Subscription for that browser;
-- the push-notify Edge Function (service role) sends to them on the minute. This migration is
-- the data and the schedule: the subscriptions, the claim table that makes every send happen
-- at most once, who added a list item, and the cron job that wakes the sender.

-- ---- Push Subscriptions ---------------------------------------------------------------------
-- One browser on one phone, belonging to the Household Account signed in there. Removing the
-- Household Account removes its subscriptions with it.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references public.household_accounts (auth_user_id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://[^[:space:]]+$' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 200),
  event_reminders boolean not null default true,
  reminder_minutes smallint not null default 15 check (reminder_minutes in (5, 10, 15, 30, 60)),
  morning_summary boolean not null default true,
  routines_nudge boolean not null default true,
  list_additions boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is 'A Push Subscription: one browser on one phone, for the Household Account signed in there (docs/specs/0007). p256dh and auth are the push service keys and never reach a client.';

create index push_subscriptions_auth_user_id_idx on public.push_subscriptions (auth_user_id);

alter table public.push_subscriptions enable row level security;

-- A client reads its own subscriptions without the keys, changes only the five preferences and
-- deletes (turning notifications off). Rows are made by save_push_subscription, so no insert.
-- anon gets nothing, and a Device holds the same grants but passes no policy.
revoke all on public.push_subscriptions from anon, authenticated;
grant select (id, auth_user_id, endpoint, event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions, created_at)
  on public.push_subscriptions to authenticated;
grant update (event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions)
  on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;

create policy "household account reads its own subscriptions"
  on public.push_subscriptions
  for select
  to authenticated
  using (public.is_household_account() and auth_user_id = auth.uid());

create policy "household account changes its own subscriptions"
  on public.push_subscriptions
  for update
  to authenticated
  using (public.is_household_account() and auth_user_id = auth.uid())
  with check (public.is_household_account() and auth_user_id = auth.uid());

create policy "household account deletes its own subscriptions"
  on public.push_subscriptions
  for delete
  to authenticated
  using (public.is_household_account() and auth_user_id = auth.uid());

-- Saves the calling phone's subscription and returns its id. The same browser subscribing
-- again keeps its row and preferences (the keys are replaced). A browser now signed in as
-- another Household Account gets a fresh row for that account (default preferences, no old
-- deliveries); the previous account's row is deleted. At most 10 subscriptions per account:
-- the oldest beyond that go. The endpoint must be https on a known push service host.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub_id uuid;
begin
  if not public.is_household_account() then
    raise exception 'only a Household Account can turn on notifications' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://[^[:space:]]+$' or char_length(p_endpoint) > 2048 then
    raise exception 'the push endpoint must be an https address of at most 2048 characters' using errcode = '22023';
  end if;
  -- The host runs from after https:// to the first slash, so userinfo (a@b), a port, or a longer
  -- host that merely starts with a good one (fcm.googleapis.com.evil.example) never matches.
  if p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|[a-z0-9-]+\.google\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)/' then
    raise exception 'the push endpoint is not on a known push service' using errcode = '22023';
  end if;
  if p_p256dh is null or char_length(p_p256dh) not between 1 and 200
     or p_auth is null or char_length(p_auth) not between 1 and 200 then
    raise exception 'the push keys must be 1 to 200 characters' using errcode = '22023';
  end if;

  -- Another account's row for this browser goes (its deliveries cascade); this account gets its own.
  delete from public.push_subscriptions as s where s.endpoint = p_endpoint and s.auth_user_id <> auth.uid();

  insert into public.push_subscriptions as s (auth_user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth
    where s.auth_user_id = excluded.auth_user_id
  returning s.id into sub_id;
  if sub_id is null then
    -- Another account took the endpoint between the delete and the insert.
    raise exception 'this browser was subscribed by another account at the same moment, try again' using errcode = '40001';
  end if;

  -- At most 10 per account: the newest stay.
  delete from public.push_subscriptions as s
  where s.id in (
    select o.id from public.push_subscriptions as o
    where o.auth_user_id = auth.uid()
    order by o.created_at desc, o.id desc
    offset 10
  );

  return sub_id;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text) from public;
revoke execute on function public.save_push_subscription(text, text, text) from anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- ---- Deliveries -----------------------------------------------------------------------------
-- A notification's key, claimed before it is sent: the Edge Function (service role) inserts
-- with on conflict do nothing and sends only when the insert made a row. A claimed key is
-- never sent again, even if the send fails. No client touches this table.
create table public.push_deliveries (
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (subscription_id, key)
);

comment on table public.push_deliveries is 'Keys of notifications already claimed for a Push Subscription, so each is sent at most once. Service role only; pruned after 2 days.';

alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;

-- The nightly prune keeps what it had and sweeps deliveries too, and pg_cron's run log (a row per
-- run, so one a minute now) beyond a week. A key matters only while its
-- notification could still be sent (a day, at most), so two days is margin.
create or replace function public.prune_stale_rows()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.synced_events where ends_at < now() - interval '1 month';
  delete from public.pairing_requests where expires_at < now() - interval '1 hour';
  delete from public.push_deliveries where sent_at < now() - interval '2 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end;
$$;

-- ---- Who added a list item ------------------------------------------------------------------
-- The sender skips the Household Account that added an item. Added without a default first so
-- existing rows stay null, then defaulted. The insert grant on list_items names three columns,
-- so a client cannot write this one and it is always the inserter (a Household Account or a Device).
alter table public.list_items add column added_by uuid;
alter table public.list_items alter column added_by set default auth.uid();

comment on column public.list_items.added_by is 'The auth user that added the item (a Household Account or a Device); null for items from before notifications. No foreign key, and never client-writable.';

-- ---- The minute's schedule ------------------------------------------------------------------
-- As invoke_calendar_sync: pg_cron calls invoke_push_notify, which posts to the push-notify Edge
-- Function with a shared secret. The URL and the secret are Vault secrets (push_notify_url,
-- push_notify_secret); until both exist the job does nothing.
create or replace function public.invoke_push_notify()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_notify_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_notify_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.invoke_push_notify() from public;
revoke execute on function public.invoke_push_notify() from anon, authenticated;
grant execute on function public.invoke_push_notify() to service_role;

-- cron.schedule with a name replaces a job of that name, so re-running this is harmless.
select cron.schedule('push-notify', '* * * * *', 'select public.invoke_push_notify()');
