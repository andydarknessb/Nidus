-- The shopper (spec 0019, ticket 3): a run is one ask of Claude for a Household's groceries. A run counts once Nidus has asked Claude,
-- whatever the answer, and ten a Household Date is the limit (the shopper Edge Function counts them from Household midnight). Only the
-- service role reads or writes them: no client has any grant, so the table is closed to every principal.

create table public.shopper_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  ran_at timestamptz not null default now()
);

comment on table public.shopper_runs is 'One ask of Claude for a Household''s groceries (the shopper). Counted for the daily limit; read and written by the service role only.';

create index shopper_runs_household_id_ran_at_idx on public.shopper_runs (household_id, ran_at);

alter table public.shopper_runs enable row level security;
revoke all on public.shopper_runs from anon, authenticated;

-- Replaces a list's waiting suggestions with the shopper's answer, in one transaction. The row lock on the list makes two runs for one
-- list at once queue: the second waits, then replaces the first's set, so the list never holds two. It is a FOR NO KEY UPDATE lock, not
-- FOR UPDATE: add_list_suggestions takes the foreign-key KEY SHARE lock on the same row, which FOR UPDATE would deadlock with, and
-- NO KEY UPDATE does not conflict with it. p_items is the checked answer as [{ "text": ..., "for_meals": ... | null }, ...] in the
-- order to show it. Returns how many it inserted.
create or replace function public.replace_list_suggestions(p_list_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.shared_lists as l where l.id = p_list_id for no key update;
  delete from public.list_suggestions as s where s.list_id = p_list_id;
  insert into public.list_suggestions (list_id, text, for_meals, sort_order)
  select p_list_id, e.value->>'text', e.value->>'for_meals', (e.ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as e(value, ord);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_list_suggestions(uuid, jsonb) from public;
-- Supabase grants execute on new functions to anon and authenticated directly; revoking from public does not remove those.
revoke execute on function public.replace_list_suggestions(uuid, jsonb) from anon, authenticated;
grant execute on function public.replace_list_suggestions(uuid, jsonb) to service_role;

-- The daily limit, judged and taken in one transaction: a run is recorded only while the Household has fewer than p_limit runs since
-- p_since (its Household midnight). The Household's row is locked, so asks at once queue here and the second counts the first's run:
-- no more than the limit pass, and a refused ask records nothing. The lock is FOR NO KEY UPDATE, as on the list in
-- replace_list_suggestions: a Meal or a Profile inserted for the Household meanwhile takes a foreign-key KEY SHARE lock on that row,
-- which FOR UPDATE would block. Returns whether the run was taken.
create or replace function public.claim_shopper_run(p_household_id uuid, p_since timestamptz, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.households as h where h.id = p_household_id for no key update;
  if (select count(*) from public.shopper_runs as r where r.household_id = p_household_id and r.ran_at >= p_since) >= p_limit then
    return false;
  end if;
  insert into public.shopper_runs (household_id) values (p_household_id);
  return true;
end;
$$;

revoke all on function public.claim_shopper_run(uuid, timestamptz, integer) from public;
revoke execute on function public.claim_shopper_run(uuid, timestamptz, integer) from anon, authenticated;
grant execute on function public.claim_shopper_run(uuid, timestamptz, integer) to service_role;

-- The nightly prune (20261101000002 is the last redefinition) also sweeps a run more than thirty days old, and keeps the seven-day sweep
-- of suggestions. A run is kept that long so the daily limit can never count one that has aged out.
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
  delete from public.list_suggestions where created_at < now() - interval '7 days';
  delete from public.shopper_runs where ran_at < now() - interval '30 days';
end;
$$;
