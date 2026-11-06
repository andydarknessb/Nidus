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
-- list at once queue: the second waits, then replaces the first's set, so the list never holds two. p_items is the checked answer as
-- [{ "text": ..., "for_meals": ... | null }, ...] in the order to show it. Returns how many it inserted.
create or replace function public.replace_list_suggestions(p_list_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.shared_lists as l where l.id = p_list_id for update;
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
