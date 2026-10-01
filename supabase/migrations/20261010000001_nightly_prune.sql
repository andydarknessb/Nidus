-- The nightly prune (issue #14). Two tables only ever grow: synced_events (the sync keeps
-- a window of one month back, so anything that ended longer ago than that is dead weight)
-- and pairing_requests (a Pairing Code is good for ten minutes; the pairing-code request
-- already sweeps codes expired more than an hour ago inline, and this is the sweep that
-- comment waits for). Same one-hour margin here as there, so a claim in flight is never
-- pruned from under it.
--
-- Who runs it: pg_cron, as the database owner. No client can call it; only the service
-- role (tests, a human in the SQL editor) can.

create or replace function public.prune_stale_rows()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.synced_events where ends_at < now() - interval '1 month';
  delete from public.pairing_requests where expires_at < now() - interval '1 hour';
end;
$$;

revoke all on function public.prune_stale_rows() from public;
revoke execute on function public.prune_stale_rows() from anon, authenticated;
grant execute on function public.prune_stale_rows() to service_role;

-- 03:00 UTC every day. cron.schedule with a name replaces a job of that name, so
-- re-running this is harmless.
select cron.schedule('nightly-prune', '0 3 * * *', 'select public.prune_stale_rows()');
