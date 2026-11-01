-- List Suggestions (spec 0019, ticket 2): items the shopper suggests for a Shared List, waiting on it until someone adds or
-- dismisses them. A suggestion is not an item: it is never counted, notified, sent or cleared. Only the service role writes
-- them (the shopper, ticket 3); a principal reads and dismisses them. Adding one makes a list item (add_list_suggestions).

create table public.list_suggestions (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shared_lists (id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 200 and text ~ '\S'),
  -- The Meals the item is for ("Tacos, Chili"), or none.
  for_meals text check (for_meals is null or char_length(btrim(for_meals)) between 1 and 120),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.list_suggestions is 'An item the shopper suggests for a Shared List (List Suggestion). Not an item until added; gone after seven days.';

create index list_suggestions_list_id_idx on public.list_suggestions (list_id, sort_order, created_at);

alter table public.list_suggestions enable row level security;

-- No client creates or edits a suggestion: no insert or update grant, and no policy for either.
revoke all on public.list_suggestions from anon, authenticated;
grant select, delete on public.list_suggestions to authenticated;

-- Reached through their list, as list_items are.
create policy "principals read their household's suggestions"
  on public.list_suggestions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.shared_lists as l
      where l.id = list_suggestions.list_id and l.household_id = public.current_household_id()
    )
  );

create policy "principals dismiss their household's suggestions"
  on public.list_suggestions
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.shared_lists as l
      where l.id = list_suggestions.list_id and l.household_id = public.current_household_id()
    )
  );

-- Adding: deletes the given suggestions the caller may see and inserts a list item for each one deleted, after the list's last item,
-- in the suggestions' own order. A suggestion another screen added or dismissed first is not there to delete, so two taps make one
-- item. security invoker: the row-level security above and on list_items stays the one authority. added_by is the caller by its default.
create or replace function public.add_list_suggestions(p_ids uuid[])
returns setof public.list_items
language sql
security invoker
set search_path = ''
as $$
  with taken as (
    delete from public.list_suggestions as s
    where s.id = any (p_ids)
    returning s.list_id, s.text, s.sort_order, s.created_at, s.id
  ),
  placed as (
    select t.list_id, t.text, row_number() over (partition by t.list_id order by t.sort_order, t.created_at, t.id) as position
    from taken as t
  ),
  next_position as (
    select p.list_id, coalesce(max(i.sort_order) + 1, 0) as first
    from (select distinct list_id from taken) as p
    left join public.list_items as i on i.list_id = p.list_id
    group by p.list_id
  ),
  inserted as (
    insert into public.list_items (list_id, text, sort_order)
    select p.list_id, p.text, n.first + p.position - 1
    from placed as p
    join next_position as n on n.list_id = p.list_id
    returning *
  )
  select * from inserted;
$$;

revoke all on function public.add_list_suggestions(uuid[]) from public;
-- Supabase grants execute on new functions to anon directly; revoking from public does not remove it.
revoke execute on function public.add_list_suggestions(uuid[]) from anon;
grant execute on function public.add_list_suggestions(uuid[]) to authenticated;

-- Realtime: the list card refetches on its changes, as it does for list_items.
alter publication supabase_realtime add table public.list_suggestions;

-- The nightly prune (migration 20261021000001 is the last redefinition) also sweeps a suggestion more than seven days old.
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
end;
$$;
